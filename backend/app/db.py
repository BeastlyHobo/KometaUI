from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from typing import Iterator

from .settings import Settings


def init_db(settings: Settings) -> None:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    with db_conn(settings) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY,
                started_at INTEGER NOT NULL,
                finished_at INTEGER,
                status TEXT NOT NULL,
                duration_sec INTEGER,
                trigger TEXT NOT NULL,
                log_file TEXT,
                exit_code INTEGER,
                error TEXT
            )
            """
        )
        conn.commit()


@contextmanager
def db_conn(settings: Settings) -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(settings.db_path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def insert_run(
    settings: Settings,
    run_id: str,
    started_at: int,
    status: str,
    trigger: str,
    log_file: str | None,
) -> None:
    with db_conn(settings) as conn:
        conn.execute(
            """
            INSERT INTO runs (id, started_at, status, trigger, log_file)
            VALUES (?, ?, ?, ?, ?)
            """,
            (run_id, started_at, status, trigger, log_file),
        )
        conn.commit()


def update_run(
    settings: Settings,
    run_id: str,
    finished_at: int,
    status: str,
    duration_sec: int,
    exit_code: int | None,
    error: str | None,
) -> None:
    with db_conn(settings) as conn:
        conn.execute(
            """
            UPDATE runs
            SET finished_at = ?, status = ?, duration_sec = ?, exit_code = ?, error = ?
            WHERE id = ?
            """,
            (finished_at, status, duration_sec, exit_code, error, run_id),
        )
        conn.commit()


def list_runs(settings: Settings) -> list[dict]:
    with db_conn(settings) as conn:
        rows = conn.execute(
            """
            SELECT id, started_at, finished_at, status, duration_sec, trigger,
                   log_file, exit_code, error
            FROM runs
            ORDER BY started_at DESC
            """
        ).fetchall()
        return [dict(row) for row in rows]


def get_run(settings: Settings, run_id: str) -> dict | None:
    with db_conn(settings) as conn:
        row = conn.execute(
            """
            SELECT id, started_at, finished_at, status, duration_sec, trigger,
                   log_file, exit_code, error
            FROM runs
            WHERE id = ?
            """,
            (run_id,),
        ).fetchone()
        return dict(row) if row else None
