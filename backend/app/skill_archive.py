from __future__ import annotations

import io
import json
import re
import stat
import zipfile
from dataclasses import dataclass
from typing import BinaryIO

from backend.app.errors import ConflictError, NotFoundError, ValidationError
from backend.app.proposals import ProposalService
from backend.app.repository import RegistryRepository
from backend.app.service import RegistryService
from backend.app.validation import (
    FileContent,
    MAX_CONTENT_BYTES,
    MAX_FILES,
    MAX_PATH_BYTES,
    binary_file_content,
    file_content_bytes,
)


MAX_RAW_ENTRIES = 1_024
MAX_SKILL_FILES = MAX_FILES
MAX_CATALOGUE_SKILLS = 1_000
MAX_CATALOGUE_BYTES = 100_000_000
MAX_FRONTMATTER_BYTES = 16_000
SKILL_ID = re.compile(r"registry:([a-z0-9]+(?:-[a-z0-9]+)*):v([1-9][0-9]*)\Z")
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")


@dataclass(frozen=True)
class ParsedArchive:
    slug: str
    description: str
    files: dict[str, FileContent]
    base_version: int | None


class SkillArchiveService:
    def __init__(
        self,
        repository: RegistryRepository,
        registry: RegistryService,
        proposals: ProposalService,
    ) -> None:
        self.repository = repository
        self.registry = registry
        self.proposals = proposals

    def catalogue_zip(self) -> io.BytesIO:
        versions = self.repository.current_versions()
        if len(versions) > MAX_CATALOGUE_SKILLS:
            raise ValidationError("Catalogue ZIP exceeds the 1000-skill limit.")
        total = sum(
            len(file_content_bytes(path, content))
            for version in versions
            for path, content in version["files"].items()
            if path != ".skill_id"
        )
        total += sum(
            len(f"registry:{version['slug']}:v{version['version']}".encode("utf-8"))
            for version in versions
        )
        if total > MAX_CATALOGUE_BYTES:
            raise ValidationError("Catalogue ZIP exceeds the 100 MB content limit.")
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            for version in versions:
                root = version["slug"]
                for path, content in version["files"].items():
                    if path == ".skill_id":
                        continue
                    archive.writestr(
                        f"{root}/{path}", file_content_bytes(path, content)
                    )
                archive.writestr(
                    f"{root}/.skill_id",
                    f"registry:{version['slug']}:v{version['version']}",
                )
        output.seek(0)
        return output

    def upload(
        self,
        stream: BinaryIO,
        *,
        auth_mode: str,
        principal: dict,
    ) -> dict:
        parsed = parse_skill_archive(stream)
        body = {
            "slug": parsed.slug,
            "name": parsed.slug,
            "description": parsed.description,
            "files": parsed.files,
        }
        if parsed.base_version is None:
            try:
                self.repository.get_skill(parsed.slug)
            except NotFoundError:
                pass
            else:
                raise ConflictError(
                    "This skill already exists. Upload a Registry download containing .skill_id."
                )
            if auth_mode == "none":
                result = self.registry.create_skill(body)
                return {"outcome": "published", "skill": result}
            proposal = self.proposals.submit(
                {**body, "action": "create", "base_version": None},
                principal["user_id"],
            )
            return {"outcome": "submitted", "proposal": proposal}

        try:
            current = self.repository.get_skill(parsed.slug)
        except NotFoundError as error:
            raise ConflictError(
                "The .skill_id refers to a skill that is not registered here."
            ) from error
        if current["latest_version"] != parsed.base_version:
            raise ConflictError(
                f"This bundle is based on version {parsed.base_version}; "
                f"download version {current['latest_version']} before updating."
            )
        if auth_mode == "none":
            result = self.registry.update_skill(
                parsed.slug, body, expected_version=parsed.base_version
            )
            return {"outcome": "published", "skill": result}
        proposal = self.proposals.submit(
            {
                **body,
                "action": "update",
                "base_version": parsed.base_version,
            },
            principal["user_id"],
        )
        return {"outcome": "submitted", "proposal": proposal}


def parse_skill_archive(stream: BinaryIO) -> ParsedArchive:
    try:
        archive = zipfile.ZipFile(stream)
    except (zipfile.BadZipFile, OSError) as error:
        raise ValidationError("Upload a valid ZIP archive.") from error
    with archive:
        entries = archive.infolist()
        if len(entries) > MAX_RAW_ENTRIES:
            raise ValidationError(
                f"ZIP contains more than {MAX_RAW_ENTRIES} raw entries."
            )
        inspected = [_inspect_entry(entry) for entry in entries]
        file_entries = [item for item in inspected if not item[1] and not _ignored(item[0])]
        if not file_entries:
            raise ValidationError("ZIP does not contain a skill bundle.")
        prefix = _common_root(
            [path for path, _is_dir, _entry in inspected if not _ignored(path)]
        )
        files: dict[str, FileContent] = {}
        directories: set[str] = set()
        seen_paths: set[str] = set()
        total = 0
        for raw_path, is_directory, entry in inspected:
            normalized = _strip_root(raw_path, prefix)
            if not normalized or _ignored(normalized):
                continue
            canonical = normalized.rstrip("/") if is_directory else normalized
            if canonical in seen_paths:
                raise ValidationError(f"ZIP contains duplicate path: {canonical}")
            seen_paths.add(canonical)
            if is_directory:
                directories.add(canonical)
                continue
            if len(files) >= MAX_SKILL_FILES + 1:
                raise ValidationError(
                    f"ZIP contains more than {MAX_SKILL_FILES} skill files plus .skill_id."
                )
            try:
                content_bytes = archive.read(entry)
            except (zipfile.BadZipFile, RuntimeError, OSError) as error:
                raise ValidationError(f"ZIP entry is corrupt: {raw_path}") from error
            if len(content_bytes) != entry.file_size:
                raise ValidationError(f"ZIP entry size is inconsistent: {raw_path}")
            if normalized != ".skill_id":
                total += len(content_bytes)
                if total > MAX_CONTENT_BYTES:
                    raise ValidationError(
                        f"Combined skill content exceeds {MAX_CONTENT_BYTES} bytes."
                    )
            try:
                files[normalized] = content_bytes.decode("utf-8", errors="strict")
            except UnicodeDecodeError:
                files[normalized] = binary_file_content(content_bytes)
        published_paths = {path for path in files if path != ".skill_id"}
        if len(published_paths) > MAX_SKILL_FILES:
            raise ValidationError(
                f"ZIP contains more than {MAX_SKILL_FILES} published skill files."
            )
        _validate_collisions(published_paths, directories)
        skill_markdown = files.get("SKILL.md")
        if skill_markdown is None:
            raise ValidationError("SKILL.md is required at the bundle root.")
        if not isinstance(skill_markdown, str):
            raise ValidationError("SKILL.md must be valid UTF-8 text.")
        name, description = _frontmatter(skill_markdown)
        skill_id = files.pop(".skill_id", None)
        base_version = None
        if skill_id is not None:
            if not isinstance(skill_id, str):
                raise ValidationError(".skill_id must be valid UTF-8 text.")
            match = SKILL_ID.fullmatch(skill_id.strip())
            if not match:
                raise ValidationError(".skill_id must use registry:<slug>:v<positive-integer>.")
            identifier_slug, version = match.groups()
            if identifier_slug != name:
                raise ValidationError(".skill_id slug must match SKILL.md name.")
            base_version = int(version)
        return ParsedArchive(name, description, dict(sorted(files.items())), base_version)


def _inspect_entry(entry: zipfile.ZipInfo) -> tuple[str, bool, zipfile.ZipInfo]:
    path = entry.orig_filename
    if (
        not path
        or path.startswith("/")
        or re.match(r"^[A-Za-z]:", path)
        or "\\" in path
        or "\x00" in path
    ):
        raise ValidationError(f"Unsafe ZIP path: {path!r}")
    parts = path.rstrip("/").split("/")
    if any(part in ("", ".", "..", ".git") for part in parts):
        raise ValidationError(f"Unsafe ZIP path: {path}")
    if len(path.encode("utf-8")) > MAX_PATH_BYTES:
        raise ValidationError(
            f"ZIP path exceeds {MAX_PATH_BYTES} UTF-8 bytes: {path}"
        )
    if entry.flag_bits & 0x1:
        raise ValidationError(f"Encrypted ZIP entries are not supported: {path}")
    is_directory = entry.is_dir()
    mode = entry.external_attr >> 16
    kind = stat.S_IFMT(mode)
    if kind and not (
        (is_directory and kind == stat.S_IFDIR)
        or (not is_directory and kind == stat.S_IFREG)
    ):
        raise ValidationError(f"ZIP contains a non-regular entry: {path}")
    if entry.file_size > MAX_CONTENT_BYTES:
        raise ValidationError(f"ZIP entry exceeds {MAX_CONTENT_BYTES} bytes: {path}")
    return path, is_directory, entry


def _common_root(paths: list[str]) -> str | None:
    split = [path.split("/") for path in paths]
    if all(len(parts) > 1 for parts in split) and len({parts[0] for parts in split}) == 1:
        return split[0][0]
    return None


def _strip_root(path: str, prefix: str | None) -> str:
    if prefix and path == f"{prefix}/":
        return ""
    if prefix and path.startswith(f"{prefix}/"):
        return path[len(prefix) + 1 :]
    return path


def _ignored(path: str) -> bool:
    parts = path.rstrip("/").split("/")
    return "__MACOSX" in parts or parts[-1] == ".DS_Store"


def _validate_collisions(files: set[str], directories: set[str]) -> None:
    for path in files:
        if path in directories:
            raise ValidationError(f"ZIP path is both a file and directory: {path}")
        parts = path.split("/")
        for index in range(1, len(parts)):
            if "/".join(parts[:index]) in files:
                raise ValidationError(f"ZIP file blocks a nested path: {path}")
    for path in directories:
        parts = path.split("/")
        for index in range(1, len(parts) + 1):
            if "/".join(parts[:index]) in files:
                raise ValidationError(f"ZIP file blocks a nested directory: {path}")


def _frontmatter(content: str) -> tuple[str, str]:
    encoded = content.encode("utf-8")
    if len(encoded) < 8 or not encoded.startswith(b"---\n"):
        raise ValidationError("SKILL.md must begin with an exact --- frontmatter line.")
    boundary = encoded.find(b"\n---\n", 4)
    if boundary < 0 or boundary + len(b"\n---\n") > MAX_FRONTMATTER_BYTES:
        raise ValidationError("SKILL.md frontmatter must close within 16000 bytes.")
    lines = encoded[4:boundary].decode("utf-8").splitlines()
    values: dict[str, str] = {}
    index = 0
    while index < len(lines):
        line = lines[index]
        match = re.match(r"^(name|description):(?:[ ](.*))?$", line)
        if not match:
            index += 1
            continue
        key, raw = match.groups()
        if key in values:
            raise ValidationError(f"SKILL.md frontmatter contains duplicate {key}.")
        raw = raw or ""
        if raw in (">", "|"):
            if key != "description":
                raise ValidationError("SKILL.md name must use a scalar value.")
            block: list[str] = []
            index += 1
            while index < len(lines) and (not lines[index] or lines[index][0].isspace()):
                block.append(lines[index].lstrip())
                index += 1
            values[key] = (" " if raw == ">" else "\n").join(block).strip()
            continue
        values[key] = _scalar(raw, key)
        index += 1
    name = values.get("name")
    if not name or len(name) > 100 or not SLUG.fullmatch(name):
        raise ValidationError("SKILL.md name must be one valid Registry slug of at most 100 characters.")
    description = values.get("description", "")
    if len(description) > 1_000:
        raise ValidationError("SKILL.md description must be at most 1000 characters.")
    return name, description


def _scalar(raw: str, key: str) -> str:
    if not raw or raw[0] in "!&*[{>|":
        raise ValidationError(f"SKILL.md {key} uses an unsupported scalar form.")
    if raw.startswith('"'):
        try:
            value = json.loads(raw)
        except (json.JSONDecodeError, TypeError) as error:
            raise ValidationError(f"SKILL.md {key} has malformed double quotes.") from error
        if not isinstance(value, str):
            raise ValidationError(f"SKILL.md {key} must be a string.")
        return value
    if raw.startswith("'"):
        if len(raw) < 2 or not raw.endswith("'"):
            raise ValidationError(f"SKILL.md {key} has malformed single quotes.")
        inner = raw[1:-1]
        if not re.fullmatch(r"(?:[^']|'')*", inner):
            raise ValidationError(f"SKILL.md {key} has malformed single quotes.")
        return inner.replace("''", "'")
    if any(marker in raw for marker in (" #", " &", " *", " !")):
        raise ValidationError(f"SKILL.md {key} uses unsupported YAML metadata.")
    return raw.strip()
