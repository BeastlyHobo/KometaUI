from __future__ import annotations

import os
from pathlib import Path


def tail_lines(path: Path, line_count: int) -> tuple[list[str], bool]:
    if line_count <= 0:
        return [], False
    if not path.exists():
        raise FileNotFoundError(str(path))

    chunk_size = 4096
    data = bytearray()
    with path.open("rb") as handle:
        handle.seek(0, os.SEEK_END)
        end = handle.tell()
        while end > 0 and data.count(b"\n") <= line_count:
            read_size = min(chunk_size, end)
            end -= read_size
            handle.seek(end)
            chunk = handle.read(read_size)
            data[:0] = chunk

    lines = data.splitlines()
    has_more = len(lines) > line_count
    tail = lines[-line_count:]
    return [line.decode("utf-8", errors="replace") for line in tail], has_more


def find_latest_log(log_dir: Path) -> Path | None:
    if not log_dir.exists():
        return None
    candidates = [p for p in log_dir.iterdir() if p.is_file()]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)
