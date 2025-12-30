from __future__ import annotations

from pathlib import Path


def acquire_lock(lock_path: Path, run_id: str) -> bool:
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = lock_path.open("x", encoding="utf-8")
    except FileExistsError:
        return False
    with fd:
        fd.write(run_id)
    return True


def release_lock(lock_path: Path) -> None:
    try:
        lock_path.unlink()
    except FileNotFoundError:
        pass


def lock_exists(lock_path: Path) -> bool:
    return lock_path.exists()
