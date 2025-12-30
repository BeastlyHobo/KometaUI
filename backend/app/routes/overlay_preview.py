from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from starlette.responses import FileResponse

from ..docker_runner import exec_in_container
from ..file_store import list_files, normalize_rel_path, resolve_config_path
from ..poster_store import get_sample_poster_path
from ..settings import Settings, get_settings

router = APIRouter()

PREVIEW_SCRIPT = """#!/usr/bin/env python3
import json
import os
import re
import sys
from pathlib import Path

import requests
from PIL import Image, ImageFilter

sys.path.append("/app/kometa")
from modules import overlay as overlay_mod  # noqa: E402


class DummyGitHub:
    configs_url = "https://raw.githubusercontent.com/Kometa-Team/Kometa-Configs/master/"


class DummyConfig:
    Requests = requests
    Cache = None
    GitHub = DummyGitHub()
    custom_repo = ""


class DummyLibrary:
    def __init__(self, overlay_folder):
        self.overlay_folder = overlay_folder
        self.image_table_name = "preview"
        self.name = "Preview"


class DummyOverlayFile:
    def __init__(self, queue_names):
        self.queue_names = queue_names
        self.file_num = 1


def substitute_special_text(text):
    def replacement(token):
        lowered = token.lower()
        if "rating" in lowered or "score" in lowered:
            return "8.7"
        if "runtime" in lowered:
            return "120"
        if "episode" in lowered:
            return "01"
        if "season" in lowered:
            return "01"
        if "title" in lowered:
            return "Sample Title"
        if "content_rating" in lowered:
            return "PG-13"
        return "Sample"

    return re.sub(r"<<([^>]+)>>", lambda match: replacement(match.group(1)), text)


def build_overlay_data(entry):
    if not isinstance(entry, dict):
        return {"name": str(entry)}
    overlay_block = entry.get("overlay")
    data = {}
    if isinstance(overlay_block, dict):
        data.update(overlay_block)
    for key, value in entry.items():
        if key != "overlay":
            data[key] = value
    return data


def parse_queue_positions(queues):
    queue_map = {}
    if not isinstance(queues, dict):
        return queue_map
    for name, positions in queues.items():
        if not isinstance(positions, list):
            continue
        normalized = []
        last = {}
        for pos in positions:
            if not isinstance(pos, dict):
                pos = {}
            merged = {**last, **pos}
            last = merged
            normalized.append(merged)
        queue_map[name] = normalized
    return queue_map


def main():
    if len(sys.argv) < 2:
        print("Usage: preview_renderer.py <request.json>", file=sys.stderr)
        sys.exit(1)
    request_path = Path(sys.argv[1])
    data = json.loads(request_path.read_text())

    poster_path = data["poster_path"]
    output_path = data["output_path"]
    overlays_map = data.get("overlays", {})
    queues = data.get("queues", {})
    overlay_order = data.get("overlay_order") or list(overlays_map.keys())
    overlay_folder = data.get("overlay_folder", "/config/overlays")

    config = DummyConfig()
    library = DummyLibrary(overlay_folder)
    overlay_file = DummyOverlayFile(queue_names=queues)

    overlay_objs = []
    blur_amount = 0
    for name in overlay_order:
        entry = overlays_map.get(name)
        if entry is None:
            continue
        overlay_data = build_overlay_data(entry)
        level = entry.get("builder_level", "movie") if isinstance(entry, dict) else "movie"
        obj = overlay_mod.Overlay(config, library, overlay_file, name, overlay_data, suppress=[], level=level)
        if obj.backdrop_text:
            obj.backdrop_text = substitute_special_text(obj.backdrop_text)
        overlay_objs.append((name, obj))
        if obj.name.startswith("blur"):
            match = re.search(r"\\(([^)]+)\\)", obj.name)
            if match:
                blur_amount = max(blur_amount, int(match.group(1)))

    base = Image.open(poster_path).convert("RGBA")
    base = base.resize(overlay_mod.portrait_dim, Image.Resampling.LANCZOS)
    if blur_amount > 0:
        base = base.filter(ImageFilter.GaussianBlur(blur_amount))

    queue_positions = parse_queue_positions(queues)
    queue_assignments = {}
    queue_members = {}
    for name, obj in overlay_objs:
        if obj.queue_name:
            queue_members.setdefault(obj.queue_name, []).append((name, obj))

    for queue_name, members in queue_members.items():
        members_sorted = sorted(members, key=lambda item: item[1].weight or 0, reverse=True)
        positions = queue_positions.get(queue_name, [])
        for idx, (name, obj) in enumerate(members_sorted):
            pos = positions[idx] if idx < len(positions) else (positions[-1] if positions else {})
            queue_assignments[name] = (
                pos.get("horizontal_offset"),
                pos.get("horizontal_align"),
                pos.get("vertical_offset"),
                pos.get("vertical_align"),
            )

    for name, obj in overlay_objs:
        if obj.name.startswith("blur"):
            continue
        new_cords = queue_assignments.get(name)
        canvas_size = base.size
        if obj.name.startswith("backdrop"):
            overlay_img, _ = obj.get_backdrop(
                canvas_size, box=obj.backdrop_box, text=obj.backdrop_text, new_cords=new_cords
            )
            if overlay_img:
                base = Image.alpha_composite(base, overlay_img)
            continue
        if obj.name.startswith("text") or obj.backdrop_text:
            overlay_img, coords = obj.get_backdrop(
                canvas_size, box=obj.backdrop_box, text=obj.backdrop_text, new_cords=new_cords
            )
            if overlay_img:
                base = Image.alpha_composite(base, overlay_img)
            if obj.image:
                base.alpha_composite(obj.image, dest=coords)
            continue
        if obj.image:
            coords = obj.get_coordinates(canvas_size, obj.image.size, new_cords=new_cords)
            base.alpha_composite(obj.image, dest=coords)

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    base.convert("RGB").save(output_path, "PNG")


if __name__ == "__main__":
    main()
"""


class OverlayPreviewRequest(BaseModel):
    overlays: dict[str, dict] = Field(default_factory=dict)
    queues: dict | None = None
    overlay_order: list[str] | None = None
    poster_mode: Literal["sample", "asset"] = "sample"
    poster_id: str = "movie"
    poster_path: str | None = None


class OverlayPreviewResponse(BaseModel):
    ok: bool
    id: str | None = None
    url: str | None = None
    error: str | None = None


def _preview_dir(settings: Settings) -> Path:
    return settings.config_dir / ".kometa-ui" / "previews"


def _preview_script_path(settings: Settings) -> Path:
    return settings.config_dir / ".kometa-ui" / "preview_renderer.py"


def _ensure_preview_script(settings: Settings) -> Path:
    script_path = _preview_script_path(settings)
    script_path.parent.mkdir(parents=True, exist_ok=True)
    if not script_path.exists() or script_path.read_text(encoding="utf-8") != PREVIEW_SCRIPT:
        script_path.write_text(PREVIEW_SCRIPT, encoding="utf-8")
        script_path.chmod(0o755)
    return script_path


def _sync_default_overlays(settings: Settings) -> None:
    target = settings.config_dir / ".kometa-ui" / "defaults" / "overlays"
    if target.exists():
        return
    cmd = [
        "sh",
        "-lc",
        "mkdir -p /config/.kometa-ui/defaults && cp -R /app/kometa/defaults/overlays /config/.kometa-ui/defaults/"
    ]
    code, output = exec_in_container(settings, cmd)
    if code != 0:
        raise RuntimeError(output or "Failed to sync default overlays")


@router.post("/overlays/preview", response_model=OverlayPreviewResponse)
def preview_overlay(
    payload: OverlayPreviewRequest,
    settings: Settings = Depends(get_settings),
) -> OverlayPreviewResponse:
    if not payload.overlays:
        return OverlayPreviewResponse(ok=False, error="No overlays provided")

    _ensure_preview_script(settings)
    preview_dir = _preview_dir(settings)
    preview_dir.mkdir(parents=True, exist_ok=True)

    if payload.poster_mode == "asset":
        if not payload.poster_path:
            return OverlayPreviewResponse(ok=False, error="Poster path is required for asset mode")
        try:
            rel_path = normalize_rel_path(settings.config_dir, payload.poster_path)
        except ValueError:
            return OverlayPreviewResponse(ok=False, error="Invalid poster path")
        poster_path = resolve_config_path(settings.config_dir, rel_path)
        if not poster_path.exists():
            return OverlayPreviewResponse(ok=False, error="Poster image not found")
    else:
        sample_path = get_sample_poster_path(settings, payload.poster_id)
        if not sample_path:
            return OverlayPreviewResponse(ok=False, error="Sample poster not found")
        poster_path = preview_dir / sample_path.name
        if not poster_path.exists():
            shutil.copyfile(sample_path, poster_path)

    preview_id = uuid.uuid4().hex
    output_path = preview_dir / f"{preview_id}.png"
    request_path = preview_dir / f"{preview_id}.json"

    request_payload = {
        "poster_path": poster_path.as_posix(),
        "output_path": output_path.as_posix(),
        "overlays": payload.overlays,
        "queues": payload.queues or {},
        "overlay_order": payload.overlay_order or list(payload.overlays.keys()),
        "overlay_folder": (settings.config_dir / "overlays").as_posix(),
    }
    request_path.write_text(json.dumps(request_payload), encoding="utf-8")

    cmd = ["python", _preview_script_path(settings).as_posix(), request_path.as_posix()]
    code, output = exec_in_container(settings, cmd)
    if code != 0:
        return OverlayPreviewResponse(ok=False, error=output or "Kometa preview failed")
    if not output_path.exists():
        return OverlayPreviewResponse(ok=False, error="Preview image not created")

    cache_dir = settings.data_dir / "previews"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cached = cache_dir / output_path.name
    shutil.copyfile(output_path, cached)

    return OverlayPreviewResponse(ok=True, id=preview_id, url=f"/api/overlays/previews/{preview_id}")


@router.get("/overlays/previews/{preview_id}")
def get_preview_image(preview_id: str, settings: Settings = Depends(get_settings)) -> FileResponse:
    cache_dir = settings.data_dir / "previews"
    target = cache_dir / f"{preview_id}.png"
    if not target.exists():
        raise HTTPException(status_code=404, detail="Preview not found")
    return FileResponse(target, filename=target.name)


@router.get("/overlays/defaults")
def list_default_overlays(settings: Settings = Depends(get_settings)) -> list[dict]:
    try:
        _sync_default_overlays(settings)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    prefix = ".kometa-ui/defaults/overlays/images"
    return list_files(settings.config_dir, prefix=prefix, extensions=["png"])


@router.post("/overlays/defaults/sync")
def sync_default_overlays(settings: Settings = Depends(get_settings)) -> dict:
    try:
        _sync_default_overlays(settings)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"ok": True}
