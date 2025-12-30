from __future__ import annotations

import shlex
from pathlib import Path

import docker
from docker.errors import DockerException, NotFound

from .settings import Settings


def docker_socket_enabled(settings: Settings) -> bool:
    return settings.docker_socket_path.exists()


def check_container(settings: Settings) -> tuple[bool, str | None]:
    if not docker_socket_enabled(settings):
        return False, "Docker socket not mounted"
    try:
        client = docker.from_env()
        container = client.containers.get(settings.kometa_container_name)
        container.reload()
        if container.status != "running":
            return False, f"Container status: {container.status}"
    except NotFound:
        return False, "Container not found"
    except DockerException as exc:
        return False, str(exc)
    return True, None


def _build_kometa_cmd(settings: Settings, config_path: Path) -> list[str]:
    cmd_template = settings.kometa_run_cmd
    if "{config}" in cmd_template:
        cmd = cmd_template.format(config=str(config_path))
    else:
        tokens = shlex.split(cmd_template)
        if "-c" not in tokens and "--config" not in tokens:
            cmd = f"{cmd_template} -c {shlex.quote(str(config_path))}"
        else:
            cmd = cmd_template
    return shlex.split(cmd)


def run_kometa(settings: Settings, log_path: Path, config_path: Path) -> int:
    if not docker_socket_enabled(settings):
        raise RuntimeError("Docker socket is not mounted")

    client = docker.from_env()
    container = client.containers.get(settings.kometa_container_name)
    container.reload()
    if container.status != "running":
        raise RuntimeError(f"Kometa container is not running (status: {container.status})")

    cmd = _build_kometa_cmd(settings, config_path)
    api_client = client.api
    exec_info = api_client.exec_create(container.id, cmd, stdout=True, stderr=True)
    exec_id = exec_info.get("Id")
    if not exec_id:
        raise RuntimeError("Failed to create exec session")

    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("ab") as handle:
        for stdout, stderr in api_client.exec_start(exec_id, stream=True, demux=True):
            if stdout:
                handle.write(stdout)
            if stderr:
                handle.write(stderr)
            handle.flush()

    inspect = api_client.exec_inspect(exec_id)
    exit_code = inspect.get("ExitCode")
    return int(exit_code) if exit_code is not None else 1


def exec_in_container(settings: Settings, cmd: list[str]) -> tuple[int, str]:
    if not docker_socket_enabled(settings):
        raise RuntimeError("Docker socket is not mounted")

    client = docker.from_env()
    container = client.containers.get(settings.kometa_container_name)
    container.reload()
    if container.status != "running":
        raise RuntimeError(f"Kometa container is not running (status: {container.status})")

    api_client = client.api
    exec_info = api_client.exec_create(container.id, cmd, stdout=True, stderr=True)
    exec_id = exec_info.get("Id")
    if not exec_id:
        raise RuntimeError("Failed to create exec session")

    output: list[str] = []
    for stdout, stderr in api_client.exec_start(exec_id, stream=True, demux=True):
        if stdout:
            output.append(stdout.decode("utf-8", errors="ignore"))
        if stderr:
            output.append(stderr.decode("utf-8", errors="ignore"))

    inspect = api_client.exec_inspect(exec_id)
    exit_code = inspect.get("ExitCode")
    return int(exit_code) if exit_code is not None else 1, "".join(output)
