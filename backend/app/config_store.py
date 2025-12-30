from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


def load_config(path: Path) -> tuple[str, int]:
    if not path.exists():
        raise FileNotFoundError(str(path))
    content = path.read_text(encoding="utf-8")
    mtime = int(path.stat().st_mtime)
    return content, mtime


def validate_yaml(text: str) -> tuple[bool, dict[str, Any]]:
    try:
        parsed = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        error = "Invalid YAML"
        line = None
        column = None
        if hasattr(exc, "problem") and exc.problem:
            error = str(exc.problem)
        if hasattr(exc, "problem_mark") and exc.problem_mark:
            line = exc.problem_mark.line + 1
            column = exc.problem_mark.column + 1
        return False, {"error": error, "line": line, "column": column}

    if parsed is None:
        return False, {"error": "YAML is empty", "line": None, "column": None}
    if not isinstance(parsed, dict):
        return False, {"error": "YAML root must be a mapping", "line": None, "column": None}
    return True, {}


def atomic_write(path: Path, text: str) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.parent / f".{path.name}.tmp"
    with tmp_path.open("w", encoding="utf-8") as handle:
        handle.write(text)
        handle.flush()
        try:
            import os

            os.fsync(handle.fileno())
        except OSError:
            pass
    tmp_path.replace(path)
    return int(path.stat().st_mtime)
