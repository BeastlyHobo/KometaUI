from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..config_registry import add_config, get_active_config_path, list_configs, set_active_config
from ..config_store import atomic_write, load_config, validate_yaml
from ..file_store import normalize_rel_path, resolve_config_path
from ..settings import Settings, get_settings

router = APIRouter()
DEFAULT_CONFIG_TEMPLATE = """plex:
  url:
  token:
tmdb:
  apikey:
libraries: {}
"""


class ConfigPayload(BaseModel):
    yaml: str


class ConfigCreatePayload(BaseModel):
    path: str
    create: bool = False
    content: str | None = None
    set_active: bool = False


class ConfigSelectPayload(BaseModel):
    path: str


@router.get("/configs")
def get_configs(settings: Settings = Depends(get_settings)) -> dict:
    data = list_configs(settings)
    return {
        "active": data.get("active"),
        "configs": data.get("configs", []),
        "root": str(settings.config_dir),
    }


@router.post("/configs")
def add_config_path(payload: ConfigCreatePayload, settings: Settings = Depends(get_settings)) -> dict:
    try:
        rel_path = normalize_rel_path(settings.config_dir, payload.path)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid config path")
    full_path = resolve_config_path(settings.config_dir, rel_path)
    if full_path.suffix.lower() not in {".yml", ".yaml"}:
        raise HTTPException(status_code=400, detail="Config path must be a YAML file")

    if payload.create:
        if full_path.exists():
            raise HTTPException(status_code=409, detail="Config file already exists")
        content = payload.content or DEFAULT_CONFIG_TEMPLATE
        ok, details = validate_yaml(content)
        if not ok:
            return {"ok": False, **details}
        mtime = atomic_write(full_path, content)
    else:
        if not full_path.exists():
            raise HTTPException(status_code=404, detail="Config file not found")
        mtime = int(full_path.stat().st_mtime)

    add_config(settings, rel_path)
    if payload.set_active:
        set_active_config(settings, rel_path)
    return {"ok": True, "path": rel_path, "last_modified": mtime}


@router.post("/configs/active")
def set_active(payload: ConfigSelectPayload, settings: Settings = Depends(get_settings)) -> dict:
    try:
        rel_path = normalize_rel_path(settings.config_dir, payload.path)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid config path")
    full_path = resolve_config_path(settings.config_dir, rel_path)
    if full_path.suffix.lower() not in {".yml", ".yaml"}:
        raise HTTPException(status_code=400, detail="Config path must be a YAML file")
    if not full_path.exists():
        raise HTTPException(status_code=404, detail="Config file not found")
    set_active_config(settings, rel_path)
    return {"ok": True, "path": rel_path}


@router.get("/config")
def get_config(settings: Settings = Depends(get_settings)) -> dict:
    config_path = get_active_config_path(settings)
    try:
        content, mtime = load_config(config_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Config file not found")
    return {
        "path": str(config_path),
        "yaml": content,
        "last_modified": mtime,
    }


@router.post("/config/validate")
def validate_config(payload: ConfigPayload) -> dict:
    ok, details = validate_yaml(payload.yaml)
    if ok:
        return {"ok": True}
    return {"ok": False, **details}


@router.post("/config")
def save_config(payload: ConfigPayload, settings: Settings = Depends(get_settings)) -> dict:
    config_path = get_active_config_path(settings)
    ok, details = validate_yaml(payload.yaml)
    if not ok:
        return {"ok": False, **details}
    mtime = atomic_write(config_path, payload.yaml)
    return {"ok": True, "last_modified": mtime}
