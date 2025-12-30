from __future__ import annotations

from pathlib import Path
from typing import Iterable


def resolve_config_path(base: Path, rel_path: str) -> Path:
    if not rel_path or not rel_path.strip():
        raise ValueError("Path is required")
    candidate = Path(rel_path)
    if candidate.is_absolute():
        raise ValueError("Path must be relative")
    base_resolved = base.resolve()
    full_path = (base / candidate).resolve()
    try:
        full_path.relative_to(base_resolved)
    except ValueError as exc:
        raise ValueError("Path escapes config root") from exc
    return full_path


def normalize_rel_path(base: Path, rel_path: str) -> str:
    return resolve_config_path(base, rel_path).relative_to(base.resolve()).as_posix()


def list_files(
    base: Path,
    prefix: str | None = None,
    extensions: Iterable[str] | None = None,
) -> list[dict]:
    root = resolve_config_path(base, prefix) if prefix else base.resolve()
    if not root.exists():
        return []

    extension_set = None
    if extensions is not None:
        extension_set = {f".{ext.lstrip('.').lower()}" for ext in extensions if ext}

    if root.is_file():
        candidates = [root]
    else:
        candidates = [path for path in root.rglob("*") if path.is_file()]

    files = []
    for path in candidates:
        if extension_set and path.suffix.lower() not in extension_set:
            continue
        stat = path.stat()
        files.append(
            {
                "path": path.relative_to(base.resolve()).as_posix(),
                "last_modified": int(stat.st_mtime),
                "size": stat.st_size,
            }
        )
    files.sort(key=lambda item: item["path"])
    return files
