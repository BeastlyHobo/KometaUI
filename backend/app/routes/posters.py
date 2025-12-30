from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from starlette.responses import FileResponse

from ..poster_store import get_sample_poster_path, list_sample_posters
from ..settings import Settings, get_settings

router = APIRouter()


@router.get("/posters/samples")
def get_sample_posters(settings: Settings = Depends(get_settings)) -> list[dict]:
    try:
        return list_sample_posters(settings)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/posters/raw/{poster_id}")
def get_sample_poster(poster_id: str, settings: Settings = Depends(get_settings)) -> FileResponse:
    path = get_sample_poster_path(settings, poster_id)
    if not path:
        raise HTTPException(status_code=404, detail="Poster not found")
    if not path.exists():
        raise HTTPException(status_code=404, detail="Poster not found")
    return FileResponse(path, filename=path.name)
