from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from starlette.responses import FileResponse

from ..log_utils import find_latest_log, tail_lines
from ..settings import Settings, get_settings

router = APIRouter()


@router.get("/logs/latest")
def get_latest_logs(tail: int = 500, settings: Settings = Depends(get_settings)) -> dict:
    latest = find_latest_log(settings.log_dir)
    if not latest:
        raise HTTPException(status_code=404, detail="No logs found")
    lines, has_more = tail_lines(latest, tail)
    return {"lines": lines, "has_more": has_more, "file": latest.name}


@router.get("/logs/latest/download")
def download_latest_logs(settings: Settings = Depends(get_settings)) -> FileResponse:
    latest = find_latest_log(settings.log_dir)
    if not latest:
        raise HTTPException(status_code=404, detail="No logs found")
    return FileResponse(latest, filename=latest.name)
