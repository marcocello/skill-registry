from __future__ import annotations

import base64
import binascii
import re
from dataclasses import dataclass
from typing import Any

from backend.app.errors import ValidationError


SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
MAX_FILES = 1_000
MAX_CONTENT_BYTES = 20_000_000
MAX_PATH_BYTES = 1_024
FileContent = str | dict[str, str]


@dataclass(frozen=True)
class SkillPayload:
    slug: str
    name: str
    description: str
    files: dict[str, FileContent]


def validate_payload(body: Any, *, route_slug: str | None = None) -> SkillPayload:
    if not isinstance(body, dict):
        raise ValidationError("Request JSON must be an object.")
    slug = route_slug or body.get("slug")
    if route_slug and body.get("slug") not in (None, route_slug):
        raise ValidationError("Payload slug must match the route slug.")
    _validate_slug(slug)
    name = body.get("name")
    description = body.get("description", "")
    files = body.get("files")
    if not isinstance(name, str) or not name.strip() or len(name) > 100:
        raise ValidationError("Name must be a non-empty string of at most 100 characters.")
    if not isinstance(description, str) or len(description) > 1_000:
        raise ValidationError("Description must be a string of at most 1000 characters.")
    validated_files = _validate_files(files)
    return SkillPayload(
        slug=slug,
        name=name.strip(),
        description=description.strip(),
        files=validated_files,
    )


def _validate_slug(slug: Any) -> None:
    if not isinstance(slug, str) or not SLUG_PATTERN.fullmatch(slug):
        raise ValidationError("Slug must use lowercase letters, numbers, and single hyphens.")


def _validate_files(files: Any) -> dict[str, FileContent]:
    if not isinstance(files, dict) or not files or len(files) > MAX_FILES:
        raise ValidationError(f"Files must be a non-empty object with at most {MAX_FILES} entries.")
    if "SKILL.md" not in files:
        raise ValidationError("SKILL.md is required.")
    validated: dict[str, FileContent] = {}
    total_bytes = 0
    for path, content in files.items():
        _validate_path(path)
        normalized, raw = normalize_file_content(path, content)
        total_bytes += len(raw)
        validated[path] = normalized
    _validate_file_collisions(set(validated))
    if not isinstance(validated["SKILL.md"], str):
        raise ValidationError("SKILL.md must be valid UTF-8 text.")
    if total_bytes > MAX_CONTENT_BYTES:
        raise ValidationError(
            f"Combined file content exceeds {MAX_CONTENT_BYTES} bytes."
        )
    return dict(sorted(validated.items()))


def _validate_path(path: Any) -> None:
    if not isinstance(path, str) or not path:
        raise ValidationError("Every file path must be a non-empty string.")
    if path.startswith("/") or "\\" in path or "\x00" in path:
        raise ValidationError(f"Unsafe file path: {path}")
    parts = path.split("/")
    if any(part in ("", ".", "..", ".git") for part in parts):
        raise ValidationError(f"Unsafe file path: {path}")
    try:
        path_bytes = path.encode("utf-8")
    except UnicodeEncodeError as error:
        raise ValidationError("File path must be valid UTF-8 text.") from error
    if len(path_bytes) > MAX_PATH_BYTES:
        raise ValidationError(f"File path exceeds {MAX_PATH_BYTES} UTF-8 bytes: {path}")


def _validate_file_collisions(paths: set[str]) -> None:
    for path in paths:
        parts = path.split("/")
        for index in range(1, len(parts)):
            ancestor = "/".join(parts[:index])
            if ancestor in paths:
                raise ValidationError(f"File blocks a nested path: {path}")


def normalize_file_content(path: str, content: Any) -> tuple[FileContent, bytes]:
    if isinstance(content, str):
        try:
            return content, content.encode("utf-8")
        except UnicodeEncodeError as error:
            raise ValidationError(f"File content must be valid UTF-8 text: {path}") from error
    if not isinstance(content, dict) or set(content) != {"encoding", "data"}:
        raise ValidationError(
            f"File content must be UTF-8 text or an exact base64 object: {path}"
        )
    if content.get("encoding") != "base64" or not isinstance(content.get("data"), str):
        raise ValidationError(f"Binary file content must use base64 encoding: {path}")
    try:
        raw = base64.b64decode(content["data"], validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValidationError(f"Binary file content is not valid base64: {path}") from error
    normalized = {"encoding": "base64", "data": base64.b64encode(raw).decode("ascii")}
    return normalized, raw


def file_content_bytes(path: str, content: FileContent) -> bytes:
    return normalize_file_content(path, content)[1]


def binary_file_content(content: bytes) -> dict[str, str]:
    return {"encoding": "base64", "data": base64.b64encode(content).decode("ascii")}
