from __future__ import annotations

import json
from typing import Any, Callable

from backend.app.errors import RegistryError, ValidationError
from backend.app.proposals import ProposalService
from backend.app.repository import RegistryRepository
from backend.app.service import RegistryService


PROTOCOL_VERSION = "2025-03-26"


def _tools(principal: dict) -> list[dict]:
    if principal.get("auth_mode") == "none":
        return [
            _simple_tool("skills.list", "List the published skills in the registry.", {}),
            _simple_tool("skills.get", "Read a published skill and all immutable versions.", {"slug": {"type": "string"}}, ["slug"]),
            {"name": "skills.create", "description": "Publish a new skill directly.", "inputSchema": _write_schema(include_slug=True)},
            {"name": "skills.update", "description": "Publish a new immutable version directly.", "inputSchema": _write_schema(include_slug=True)},
        ]
    tools = []
    if "skills.read" in principal["scopes"]:
        tools.extend(
            [
                {
            "name": "skills.list",
            "description": "List the published skills in the registry.",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
                },
                {
            "name": "skills.get",
            "description": "Read a published skill and all immutable versions.",
            "inputSchema": {
                "type": "object",
                "properties": {"slug": {"type": "string"}},
                "required": ["slug"],
                "additionalProperties": False,
            },
                },
            ]
        )
    if "skills.submit" in principal["scopes"]:
        tools.append({
            "name": "skills.submit",
            "description": "Submit a complete create or update bundle for administrator review.",
            "inputSchema": _submission_schema(),
        })
    if principal["role"] == "admin" and "skills.review" in principal["scopes"]:
        tools.extend(
            [
                _simple_tool("proposals.list", "List reviewed and pending proposals.", {}),
                _simple_tool("proposals.get", "Read one proposal.", {"id": {"type": "string"}}, ["id"]),
                _simple_tool("proposals.update", "Edit a pending proposal bundle.", _review_edit_properties(), ["id", "revision", "name", "files"]),
                _simple_tool("proposals.approve", "Approve and publish a pending proposal.", _decision_properties(), ["id", "revision", "reason"]),
                _simple_tool("proposals.reject", "Reject a pending proposal.", _decision_properties(), ["id", "revision", "reason"]),
            ]
        )
    return tools


class McpServer:
    def __init__(self, repository: RegistryRepository, proposals: ProposalService, registry: RegistryService) -> None:
        self.repository = repository
        self.proposals = proposals
        self.registry = registry
        self._tool_handlers: dict[str, Callable[[dict, dict], dict]] = {
            "skills.list": self._list_skills,
            "skills.get": self._get_skill,
            "skills.submit": self._submit,
            "skills.create": self._create,
            "skills.update": self._update,
            "proposals.list": self._list_proposals,
            "proposals.get": self._get_proposal,
            "proposals.update": self._update_proposal,
            "proposals.approve": self._approve_proposal,
            "proposals.reject": self._reject_proposal,
        }

    def handle(self, body: object, principal: dict) -> dict | None:
        if not isinstance(body, dict):
            return _error(None, -32600, "Invalid Request")
        if "id" in body and not _valid_request_id(body["id"]):
            return _error(None, -32600, "Invalid Request")
        request_id = body.get("id")
        if body.get("jsonrpc") != "2.0" or not isinstance(body.get("method"), str):
            return _error(request_id, -32600, "Invalid Request")
        method = body["method"]
        params = body.get("params", {})
        if not isinstance(params, dict) or not _valid_method_params(method, params):
            return _error(request_id, -32602, "Invalid params")
        if method == "notifications/initialized":
            return None
        if method == "initialize":
            return _result(request_id, self._initialize(principal))
        if method == "tools/list":
            return _result(request_id, {"tools": _tools(principal)})
        if method == "tools/call":
            return _result(request_id, self._call_tool(body.get("params"), principal))
        return _error(request_id, -32601, "Method not found")

    def _initialize(self, principal: dict) -> dict:
        return {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "skills-registry", "version": "0.1.0"},
            "instructions": _server_instructions(principal),
        }

    def _call_tool(self, params: object, principal: dict) -> dict:
        if not isinstance(params, dict):
            return _tool_error("INVALID_ARGUMENTS", "Tool parameters must be an object.")
        name = params.get("name")
        arguments = params.get("arguments", {})
        if not isinstance(name, str) or not isinstance(arguments, dict):
            return _tool_error("INVALID_ARGUMENTS", "Tool name and arguments are required.")
        handler = self._tool_handlers.get(name)
        declared = {tool["name"] for tool in _tools(principal)}
        if handler is None or name not in declared:
            return _tool_error("UNKNOWN_TOOL", f"Unknown tool: {name}")
        try:
            return _tool_result(handler(arguments, principal))
        except RegistryError as error:
            return _tool_error(error.code, str(error))

    def _list_skills(self, arguments: dict, _principal: dict) -> dict:
        _require_keys(arguments, set())
        return {"skills": self.repository.list_skills()}

    def _get_skill(self, arguments: dict, _principal: dict) -> dict:
        _require_keys(arguments, {"slug"})
        slug = arguments.get("slug")
        if not isinstance(slug, str):
            raise ValidationError("Slug is required.")
        return self.repository.get_skill(slug)

    def _submit(self, arguments: dict, principal: dict) -> dict:
        _require_keys(arguments, {"action", "slug", "base_version", "name", "description", "files"}, optional={"description"})
        return self.proposals.submit(arguments, principal["user_id"])

    def _create(self, arguments: dict, _principal: dict) -> dict:
        _require_keys(arguments, {"slug", "name", "description", "files"}, optional={"description"})
        return self.registry.create_skill(arguments)

    def _update(self, arguments: dict, _principal: dict) -> dict:
        _require_keys(arguments, {"slug", "name", "description", "files"}, optional={"description"})
        return self.registry.update_skill(str(arguments["slug"]), arguments)

    def _list_proposals(self, arguments: dict, _principal: dict) -> dict:
        _require_keys(arguments, set())
        return {"proposals": self.repository.list_proposals()}

    def _get_proposal(self, arguments: dict, _principal: dict) -> dict:
        _require_keys(arguments, {"id"})
        return self.repository.get_proposal(str(arguments["id"]))

    def _update_proposal(self, arguments: dict, principal: dict) -> dict:
        _require_keys(arguments, {"id", "revision", "name", "description", "files"}, optional={"description"})
        return self.proposals.edit(str(arguments["id"]), arguments, principal["user_id"])

    def _approve_proposal(self, arguments: dict, principal: dict) -> dict:
        return self._decide(arguments, principal, True)

    def _reject_proposal(self, arguments: dict, principal: dict) -> dict:
        return self._decide(arguments, principal, False)

    def _decide(self, arguments: dict, principal: dict, approve: bool) -> dict:
        _require_keys(arguments, {"id", "revision", "reason"})
        return self.proposals.decide(str(arguments["id"]), arguments, principal["user_id"], approve=approve)


def _write_schema(*, include_slug: bool) -> dict:
    properties: dict[str, Any] = {
        "name": {"type": "string"},
        "description": {"type": "string"},
        "files": {
            "type": "object",
            "propertyNames": {"type": "string", "maxLength": 1024},
            "additionalProperties": _file_value_schema(),
        },
    }
    required = ["name", "files"]
    if include_slug:
        properties = {"slug": {"type": "string"}, **properties}
        required.insert(0, "slug")
    return {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": False,
    }


def _server_instructions(principal: dict) -> str:
    names = {tool["name"] for tool in _tools(principal)}
    guide = ["Skill Registry is the source of truth for reusable agent skills."]
    if "skills.list" in names:
        guide.append("Search with skills.list before creating.")
    if "skills.get" in names:
        guide.append("Inspect a candidate and its immutable versions with skills.get.")
    write_tools = names.intersection({"skills.create", "skills.update", "skills.submit"})
    if write_tools:
        guide.append(
            "Send the complete bundle, including SKILL.md and every supporting file; never "
            "invent omitted files or credentials."
        )
        guide.append(
            "Portal writes do not install, remove, or reconfigure local Codex skills and "
            "never modify skills.toml."
        )
    if "skills.create" in names:
        guide.append("Use skills.create only for a new slug; it publishes immediately.")
    if "skills.update" in names:
        guide.append(
            "Use skills.update only for a new immutable version of an existing slug; it "
            "publishes immediately."
        )
    if "skills.submit" in names:
        guide.append(
            "Use skills.submit for a create or update. A submission stays pending until an "
            "administrator reviews it; never claim publication from submission alone."
        )
    if "proposals.get" in names:
        guide.append("Inspect the proposal with proposals.get before deciding.")
    if "proposals.update" in names:
        guide.append("proposals.update requires the current revision and a complete bundle.")
    if {"proposals.approve", "proposals.reject"}.issubset(names):
        guide.append(
            "proposals.approve and proposals.reject require the current revision and a "
            "required reason. Confirm published read-back after approval."
        )
    guide.append("Confirm the returned record before reporting success.")
    return " ".join(guide)


def _submission_schema() -> dict:
    schema = _write_schema(include_slug=True)
    schema["properties"] = {
        "action": {"type": "string", "enum": ["create", "update"]},
        "base_version": {"type": ["integer", "null"], "minimum": 1},
        **schema["properties"],
    }
    schema["required"] = ["action", "slug", "base_version", "name", "files"]
    return schema


def _simple_tool(name: str, description: str, properties: dict, required: list[str] | None = None) -> dict:
    return {
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": properties,
            "required": required or [],
            "additionalProperties": False,
        },
    }


def _file_value_schema() -> dict:
    return {
        "oneOf": [
            {"type": "string", "description": "UTF-8 text file content."},
            {
                "type": "object",
                "description": "Binary file content encoded as base64.",
                "properties": {
                    "encoding": {"type": "string", "const": "base64"},
                    "data": {"type": "string", "contentEncoding": "base64"},
                },
                "required": ["encoding", "data"],
                "additionalProperties": False,
            },
        ]
    }


def _review_edit_properties() -> dict:
    return {
        "id": {"type": "string"},
        "revision": {"type": "integer", "minimum": 1},
        "name": {"type": "string"},
        "description": {"type": "string"},
        "files": {
            "type": "object",
            "propertyNames": {"type": "string", "maxLength": 1024},
            "additionalProperties": _file_value_schema(),
        },
    }


def _decision_properties() -> dict:
    return {
        "id": {"type": "string"},
        "revision": {"type": "integer", "minimum": 1},
        "reason": {"type": "string"},
    }


def _valid_request_id(value: object) -> bool:
    return value is None or isinstance(value, str) or (
        isinstance(value, (int, float)) and not isinstance(value, bool)
    )


def _valid_method_params(method: str, params: dict) -> bool:
    semantic_params = _without_request_metadata(params)
    if semantic_params is None:
        return False
    params = semantic_params
    if method == "initialize":
        client = params.get("clientInfo")
        return (
            isinstance(params.get("protocolVersion"), str)
            and isinstance(params.get("capabilities"), dict)
            and isinstance(client, dict)
            and isinstance(client.get("name"), str)
            and isinstance(client.get("version"), str)
        )
    if method == "notifications/initialized":
        return not params
    if method == "tools/list":
        return set(params).issubset({"cursor"}) and (
            "cursor" not in params
            or params["cursor"] is None
            or isinstance(params["cursor"], str)
        )
    if method == "tools/call":
        return (
            set(params).issubset({"name", "arguments"})
            and isinstance(params.get("name"), str)
            and isinstance(params.get("arguments", {}), dict)
        )
    return True


def _without_request_metadata(params: dict) -> dict | None:
    if "_meta" in params and not isinstance(params["_meta"], dict):
        return None
    return {key: value for key, value in params.items() if key != "_meta"}


def _require_keys(
    arguments: dict,
    allowed: set[str],
    *,
    optional: set[str] | None = None,
) -> None:
    optional = optional or set()
    required = allowed - optional
    if not required.issubset(arguments) or not set(arguments).issubset(allowed):
        raise ValidationError("Tool arguments do not match the declared schema.")


def _tool_result(payload: dict) -> dict:
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(payload, ensure_ascii=False, sort_keys=True),
            }
        ],
        "structuredContent": payload,
        "isError": False,
    }


def _tool_error(code: str, message: str) -> dict:
    payload = {"code": code, "message": message}
    return {
        "content": [{"type": "text", "text": json.dumps(payload, sort_keys=True)}],
        "structuredContent": payload,
        "isError": True,
    }


def _result(request_id: object, result: dict) -> dict:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _error(request_id: object, code: int, message: str) -> dict:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": code, "message": message},
    }
