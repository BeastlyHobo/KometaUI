from __future__ import annotations

from fastapi import APIRouter, Depends

from ..docker_runner import check_container, docker_socket_enabled
from ..settings import Settings, get_settings

router = APIRouter()


@router.get("/health")
def health(settings: Settings = Depends(get_settings)) -> dict:
    socket_enabled = docker_socket_enabled(settings)
    container_ok = False
    if socket_enabled:
        container_ok, _ = check_container(settings)
    return {
        "ok": True,
        "docker_socket": socket_enabled,
        "kometa_container_found": container_ok,
        "config_exists": settings.config_file.exists(),
        "config_path": str(settings.config_file),
        "log_dir": str(settings.log_dir),
    }
