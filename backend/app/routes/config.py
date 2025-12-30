from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..config_store import atomic_write, load_config, validate_yaml
from ..settings import Settings, get_settings

router = APIRouter()


class ConfigPayload(BaseModel):
    yaml: str


@router.get("/config")
def get_config(settings: Settings = Depends(get_settings)) -> dict:
    try:
        content, mtime = load_config(settings.config_file)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Config file not found")
    return {"path": str(settings.config_file), "yaml": content, "last_modified": mtime}


@router.post("/config/validate")
def validate_config(payload: ConfigPayload) -> dict:
    ok, details = validate_yaml(payload.yaml)
    if ok:
        return {"ok": True}
    return {"ok": False, **details}


@router.post("/config")
def save_config(payload: ConfigPayload, settings: Settings = Depends(get_settings)) -> dict:
    ok, details = validate_yaml(payload.yaml)
    if not ok:
        return {"ok": False, **details}
    mtime = atomic_write(settings.config_file, payload.yaml)
    return {"ok": True, "last_modified": mtime}
