from __future__ import annotations

import threading
from collections.abc import Callable

from backend.app.git_export import GitExporter
from backend.app.repository import RegistryRepository
from backend.app.validation import validate_payload


class RegistryService:
    def __init__(self, repository: RegistryRepository, exporter: GitExporter) -> None:
        self.repository = repository
        self.exporter = exporter
        self._operation_lock = threading.RLock()
        self.remote_pusher = None

    def create_skill(self, body: object) -> dict:
        payload = validate_payload(body)
        with self._operation_lock:
            version = self.repository.create_skill(payload)
            return self._export_after_write(version)

    def update_skill(
        self, slug: str, body: object, *, expected_version: int | None = None
    ) -> dict:
        payload = validate_payload(body, route_slug=slug)
        with self._operation_lock:
            version = self.repository.update_skill(
                payload, expected_version=expected_version
            )
            return self._export_after_write(version)

    def delete_skill(self, slug: str) -> dict:
        with self._operation_lock:
            deletion = self.repository.delete_skill(slug)
            try:
                commit_sha = self.exporter.export(
                    self.repository.export_snapshot(),
                    message=f"feat(skill): delete {slug}",
                )
                self.repository.mark_exported(commit_sha)
            except Exception as error:
                self.repository.mark_deletion_export_failed(slug, str(error))
                return {
                    **deletion,
                    "git_export": {
                        "status": "pending",
                        "commit_sha": None,
                        "error": str(error)[:500],
                    },
                }
            if self.remote_pusher is not None:
                try:
                    self.remote_pusher()
                except Exception:
                    pass
            return {
                **deletion,
                "git_export": {
                    "status": "exported",
                    "commit_sha": commit_sha,
                    "error": None,
                },
            }

    def synchronize_git(self) -> dict:
        with self._operation_lock:
            pending_before = self.repository.pending_export_count()
            versions = self.repository.export_snapshot()
            commit_sha = self.exporter.export(versions, message="chore(registry): sync database snapshot")
            self.repository.mark_exported(commit_sha)
            return {
                "exported": pending_before,
                "pending": self.repository.pending_export_count(),
                "commit_sha": commit_sha,
            }

    def synchronize_git_and_push(self, pusher: Callable[[], dict]) -> dict:
        with self._operation_lock:
            self.synchronize_git()
            return pusher()

    def reconcile_git_history(self) -> None:
        with self._operation_lock:
            missing = [
                version["id"]
                for version in self.repository.exported_versions()
                if not self.exporter.has_commit(version["git_commit_sha"])
            ]
            self.repository.mark_exports_missing(missing)
            if self.repository.pending_export_count() == 0:
                return
            commit_sha = self.exporter.export(
                self.repository.export_snapshot(),
                message="chore(registry): reconcile database snapshot",
            )
            self.repository.mark_exported(commit_sha)

    def _export_after_write(self, version: dict) -> dict:
        try:
            message = f"feat(skill): publish {version['slug']} v{version['version']}"
            if (
                self.repository.pending_export_count() == 1
                and self.exporter.generated_content_is_clean()
            ):
                commit_sha = self.exporter.export_version(
                    version, self.repository.registry_snapshot(), message=message
                )
                self.repository.mark_version_exported(version["id"], commit_sha)
            else:
                commit_sha = self.exporter.export(
                    self.repository.export_snapshot(), message=message
                )
                self.repository.mark_exported(commit_sha)
        except Exception as error:
            self.repository.mark_export_failed(version["id"], str(error))
        else:
            if self.remote_pusher is not None:
                try:
                    self.remote_pusher()
                except Exception:
                    pass
        refreshed = self.repository.get_version(version["id"])
        refreshed.pop("id", None)
        return refreshed

    def export_version(self, version_id: int) -> dict:
        with self._operation_lock:
            return self._export_after_write(self.repository.get_version(version_id))
