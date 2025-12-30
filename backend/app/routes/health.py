from __future__ import annotations

from fastapi import APIRouter, Depends

from ..config_registry import get_active_config_path
from ..docker_runner import check_container, docker_socket_enabled
from ..settings import Settings, get_settings

router = APIRouter()


@router.get("/health")
def health(settings: Settings = Depends(get_settings)) -> dict:
    socket_enabled = docker_socket_enabled(settings)
    container_ok = False
    if socket_enabled:
        container_ok, _ = check_container(settings)
    config_path = get_active_config_path(settings)
    return {
        "ok": True,
        "docker_socket": socket_enabled,
        "kometa_container_found": container_ok,
        "config_exists": config_path.exists(),
        "config_path": str(config_path),
        "config_root": str(settings.config_dir),
        "log_dir": str(settings.log_dir),
    }
