from __future__ import annotations

import json
import threading
import uuid

from backend.app.errors import ConflictError, ValidationError
from backend.app.repository import RegistryRepository
from backend.app.security import timestamp
from backend.app.service import RegistryService
from backend.app.validation import validate_payload


class ProposalService:
    def __init__(self, repository: RegistryRepository, registry: RegistryService) -> None:
        self.repository = repository
        self.registry = registry
        self._lock = threading.Lock()

    def submit(self, body: dict, author_user_id: str) -> dict:
        allowed = {"action", "slug", "base_version", "name", "description", "files"}
        if not isinstance(body, dict) or not set(body).issubset(allowed):
            raise ValidationError("Submission fields do not match the declared schema.")
        action = body.get("action")
        if action not in {"create", "update"}:
            raise ValidationError("Action must be create or update.")
        payload = validate_payload(body)
        base_version = body.get("base_version")
        with self._lock:
            self._validate_base(action, payload.slug, base_version)
            now = timestamp()
            return self.repository.create_proposal(
                {
                    "id": uuid.uuid4().hex,
                    "action": action,
                    "slug": payload.slug,
                    "base_version": base_version,
                    "name": payload.name,
                    "description": payload.description,
                    "files_json": json.dumps(payload.files, sort_keys=True),
                    "author_user_id": author_user_id,
                    "created_at": now,
                    "updated_at": now,
                }
            )

    def edit(self, proposal_id: str, body: dict, editor_user_id: str) -> dict:
        revision = _revision(body)
        current = self.repository.get_proposal(proposal_id)
        payload = validate_payload({**body, "slug": current["slug"]})
        return self.repository.edit_proposal(
            proposal_id, revision, payload, editor_user_id, timestamp()
        )

    def decide(
        self,
        proposal_id: str,
        body: dict,
        reviewer_user_id: str,
        *,
        approve: bool,
    ) -> dict:
        revision = _revision(body)
        reason = body.get("reason")
        if not isinstance(reason, str) or not reason.strip() or len(reason) > 1000:
            raise ValidationError("A decision reason of at most 1000 characters is required.")
        with self._lock:
            proposal, version_id = self.repository.decide_proposal(
                proposal_id,
                revision,
                reviewer_user_id,
                reason.strip(),
                timestamp(),
                approve,
            )
            if version_id is not None:
                self.registry.export_version(version_id)
            return proposal

    def _validate_base(self, action: str, slug: str, base_version: object) -> None:
        if action == "create":
            if base_version is not None:
                raise ValidationError("Create proposals require base_version null.")
            try:
                self.repository.get_skill(slug)
            except Exception as error:
                if getattr(error, "code", None) == "NOT_FOUND":
                    return
                raise
            raise ConflictError(f"Skill already exists: {slug}")
        if not isinstance(base_version, int) or isinstance(base_version, bool) or base_version < 1:
            raise ValidationError("Update proposals require a positive base_version.")
        skill = self.repository.get_skill(slug)
        if skill["latest_version"] != base_version:
            raise ConflictError("base_version is not the current published version.")


def _revision(body: dict) -> int:
    revision = body.get("revision")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        raise ValidationError("A positive proposal revision is required.")
    return revision
