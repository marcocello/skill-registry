from __future__ import annotations

import json
import re
from typing import Any


INTERFACE_PATTERN = re.compile(r"^interface\s*:\s*(?:#.*)?$")
SINGLE_QUOTED_PATTERN = re.compile(r"^'((?:[^']|'')*)'\s*(?:#.*)?$")
INVALID_PLAIN_SCALARS = {"", "~", "null", "true", "false"}


def openai_display_name(files: dict[str, Any]) -> str | None:
    content = files.get("agents/openai.yaml")
    if not isinstance(content, str):
        return None

    interface_indent: int | None = None
    child_indent: int | None = None
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(line) - len(line.lstrip(" "))

        if interface_indent is None:
            if indent == 0 and INTERFACE_PATTERN.fullmatch(stripped):
                interface_indent = indent
            continue
        if indent <= interface_indent:
            break
        if child_indent is None:
            child_indent = indent
        if indent != child_indent:
            continue

        key, separator, value = stripped.partition(":")
        if separator and key.strip() == "display_name":
            return _display_name_scalar(value)
    return None


def _display_name_scalar(value: str) -> str | None:
    value = value.strip()
    if value.startswith('"'):
        try:
            parsed, position = json.JSONDecoder().raw_decode(value)
        except json.JSONDecodeError:
            return None
        remainder = value[position:].strip()
        if remainder and not remainder.startswith("#"):
            return None
        return _normalized_display_name(parsed)

    match = SINGLE_QUOTED_PATTERN.fullmatch(value)
    if match:
        return _normalized_display_name(match.group(1).replace("''", "'"))

    plain = re.split(r"\s+#", value, maxsplit=1)[0].strip()
    if plain.lower() in INVALID_PLAIN_SCALARS or plain[:1] in "[{|>&*!":
        return None
    return _normalized_display_name(plain)


def _normalized_display_name(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value or len(value) > 100 or any(ord(character) < 32 for character in value):
        return None
    return value
