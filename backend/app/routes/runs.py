from __future__ import annotations

import threading
import time
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from starlette.responses import FileResponse

from ..config_registry import get_active_config_path
from ..db import get_run, insert_run, list_runs, update_run
from ..docker_runner import run_kometa
from ..log_utils import tail_lines
from ..run_lock import acquire_lock, release_lock
from ..settings import Settings, get_settings

router = APIRouter()


class RunCreate(BaseModel):
    trigger: str = "manual"


def _run_task(
    settings: Settings,
    run_id: str,
    started_at: int,
    log_file: str,
    config_path: Path,
) -> None:
    log_path = settings.log_dir / log_file
    status = "failed"
    error = None
    exit_code = None
    try:
        exit_code = run_kometa(settings, log_path, config_path)
        status = "success" if exit_code == 0 else "failed"
    except Exception as exc:  # noqa: BLE001
        error = str(exc)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("ab") as handle:
            handle.write(f"\n[kometa-ui] {error}\n".encode("utf-8"))
    finally:
        finished_at = int(time.time())
        duration_sec = max(0, finished_at - started_at)
        update_run(settings, run_id, finished_at, status, duration_sec, exit_code, error)
        release_lock(settings.lock_path)


@router.post("/runs")
def create_run(payload: RunCreate, settings: Settings = Depends(get_settings)) -> dict:
    run_id = str(uuid4())
    if not acquire_lock(settings.lock_path, run_id):
        raise HTTPException(status_code=409, detail="A run is already in progress.")

    started_at = int(time.time())
    log_file = time.strftime("ui-run-%Y%m%d-%H%M%S.log", time.localtime(started_at))

    insert_run(settings, run_id, started_at, "running", payload.trigger, log_file)
    config_path = get_active_config_path(settings)

    thread = threading.Thread(
        target=_run_task,
        args=(settings, run_id, started_at, log_file, config_path),
        daemon=True,
    )
    thread.start()

    return {"run_id": run_id}


@router.get("/runs")
def get_runs(settings: Settings = Depends(get_settings)) -> list[dict]:
    return list_runs(settings)


@router.get("/runs/{run_id}")
def get_run_detail(run_id: str, settings: Settings = Depends(get_settings)) -> dict:
    run = get_run(settings, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@router.get("/runs/{run_id}/logs")
def get_run_logs(run_id: str, tail: int = 500, settings: Settings = Depends(get_settings)) -> dict:
    run = get_run(settings, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    log_file = run.get("log_file")
    if not log_file:
        raise HTTPException(status_code=404, detail="Log file not available")
    log_path = settings.log_dir / Path(log_file)
    try:
        lines, has_more = tail_lines(log_path, tail)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Log file not found")
    return {"lines": lines, "has_more": has_more}


@router.get("/runs/{run_id}/download")
def download_run_log(run_id: str, settings: Settings = Depends(get_settings)) -> FileResponse:
    run = get_run(settings, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    log_file = run.get("log_file")
    if not log_file:
        raise HTTPException(status_code=404, detail="Log file not available")
    log_path = settings.log_dir / Path(log_file)
    if not log_path.exists():
        raise HTTPException(status_code=404, detail="Log file not found")
    return FileResponse(log_path, filename=log_path.name)
