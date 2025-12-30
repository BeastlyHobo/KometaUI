from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, case_sensitive=False)

    port: int = 6161
    data_dir: Path = Path("/data")
    config_file: Path = Path("/config/config.yml")
    log_dir: Path = Path("/logs")

    auth_mode: Literal["none", "basic", "token"] = "none"
    basic_user: str | None = None
    basic_pass: str | None = None
    api_token: str | None = None

    allow_docker_socket: bool = False
    docker_socket_path: Path = Path("/var/run/docker.sock")

    kometa_container_name: str = "kometa"
    kometa_run_cmd: str = "python kometa.py -c /config/config.yml"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "app.db"

    @property
    def lock_path(self) -> Path:
        return self.data_dir / "run.lock"

    def validate(self) -> None:
        if self.auth_mode == "basic":
            if not self.basic_user or not self.basic_pass:
                raise ValueError("AUTH_MODE=basic requires BASIC_USER and BASIC_PASS")
        if self.auth_mode == "token":
            if not self.api_token:
                raise ValueError("AUTH_MODE=token requires API_TOKEN")

        if self.docker_socket_path.exists() and not self.allow_docker_socket:
            raise RuntimeError(
                "Docker socket mounted but ALLOW_DOCKER_SOCKET is not true. "
                "Set ALLOW_DOCKER_SOCKET=true to continue."
            )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
