from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from starlette.responses import FileResponse

from ..config_store import atomic_write, validate_yaml
from ..file_store import list_files, normalize_rel_path, resolve_config_path
from ..settings import Settings, get_settings

router = APIRouter()

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
YAML_EXTENSIONS = {".yml", ".yaml"}


class FilePayload(BaseModel):
    path: str
    yaml: str


@router.get("/files")
def get_files(
    prefix: str | None = None,
    extensions: str | None = None,
    settings: Settings = Depends(get_settings),
) -> list[dict]:
    exts = None
    if extensions:
        exts = [ext.strip() for ext in extensions.split(",") if ext.strip()]
    else:
        exts = [ext.lstrip(".") for ext in YAML_EXTENSIONS]
    try:
        return list_files(settings.config_dir, prefix=prefix, extensions=exts)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid path")


@router.get("/files/content")
def get_file_content(path: str, settings: Settings = Depends(get_settings)) -> dict:
    try:
        rel_path = normalize_rel_path(settings.config_dir, path)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid path")
    full_path = resolve_config_path(settings.config_dir, rel_path)
    if not full_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if full_path.suffix.lower() not in YAML_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only YAML files are supported")
    content = full_path.read_text(encoding="utf-8")
    mtime = int(full_path.stat().st_mtime)
    return {"path": rel_path, "yaml": content, "last_modified": mtime}


@router.post("/files")
def save_file(payload: FilePayload, settings: Settings = Depends(get_settings)) -> dict:
    try:
        rel_path = normalize_rel_path(settings.config_dir, payload.path)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid path")
    full_path = resolve_config_path(settings.config_dir, rel_path)
    if full_path.suffix.lower() not in YAML_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only YAML files are supported")
    ok, details = validate_yaml(payload.yaml)
    if not ok:
        return {"ok": False, **details}
    mtime = atomic_write(full_path, payload.yaml)
    return {"ok": True, "path": rel_path, "last_modified": mtime}


@router.get("/files/raw")
def get_raw_file(path: str, settings: Settings = Depends(get_settings)) -> FileResponse:
    try:
        rel_path = normalize_rel_path(settings.config_dir, path)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid path")
    full_path = resolve_config_path(settings.config_dir, rel_path)
    if not full_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if full_path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only image files are supported")
    return FileResponse(full_path, filename=full_path.name)
