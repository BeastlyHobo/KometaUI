from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .file_store import normalize_rel_path, resolve_config_path
from .settings import Settings


def _registry_path(settings: Settings) -> Path:
    return settings.data_dir / "config_registry.json"


def _default_registry(settings: Settings) -> dict[str, Any]:
    default_rel = None
    try:
        default_rel = (
            settings.config_file.resolve()
            .relative_to(settings.config_dir.resolve())
            .as_posix()
        )
    except ValueError:
        default_rel = settings.config_file.name
    configs = [default_rel] if default_rel else []
    return {"active": default_rel, "configs": configs}


def _load_registry(settings: Settings) -> dict[str, Any]:
    path = _registry_path(settings)
    if not path.exists():
        return _default_registry(settings)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return _default_registry(settings)
    configs = data.get("configs", [])
    if not isinstance(configs, list):
        configs = []
    active = data.get("active")
    return {"active": active, "configs": configs}


def _save_registry(settings: Settings, registry: dict[str, Any]) -> None:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    path = _registry_path(settings)
    path.write_text(json.dumps(registry, indent=2), encoding="utf-8")


def ensure_registry(settings: Settings) -> dict[str, Any]:
    registry = _load_registry(settings)
    configs: list[str] = []
    for item in registry.get("configs", []):
        try:
            configs.append(normalize_rel_path(settings.config_dir, str(item)))
        except ValueError:
            continue
    registry["configs"] = list(dict.fromkeys(configs))

    active = registry.get("active")
    if active:
        try:
            active = normalize_rel_path(settings.config_dir, str(active))
        except ValueError:
            active = None
    if not active and registry["configs"]:
        active = registry["configs"][0]
    elif active and active not in registry["configs"]:
        registry["configs"].insert(0, active)
    registry["active"] = active

    _save_registry(settings, registry)
    return registry


def list_configs(settings: Settings) -> dict[str, Any]:
    registry = ensure_registry(settings)
    configs = []
    for rel_path in registry["configs"]:
        path = resolve_config_path(settings.config_dir, rel_path)
        exists = path.exists()
        mtime = int(path.stat().st_mtime) if exists else None
        configs.append({"path": rel_path, "exists": exists, "last_modified": mtime})
    return {"active": registry.get("active"), "configs": configs}


def add_config(settings: Settings, rel_path: str) -> dict[str, Any]:
    registry = ensure_registry(settings)
    rel_path = normalize_rel_path(settings.config_dir, rel_path)
    if rel_path not in registry["configs"]:
        registry["configs"].append(rel_path)
    _save_registry(settings, registry)
    return registry


def set_active_config(settings: Settings, rel_path: str) -> dict[str, Any]:
    registry = ensure_registry(settings)
    rel_path = normalize_rel_path(settings.config_dir, rel_path)
    if rel_path not in registry["configs"]:
        registry["configs"].append(rel_path)
    registry["active"] = rel_path
    _save_registry(settings, registry)
    return registry


def get_active_config_path(settings: Settings) -> Path:
    registry = ensure_registry(settings)
    rel_path = registry.get("active")
    if not rel_path:
        return settings.config_file
    return resolve_config_path(settings.config_dir, rel_path)
