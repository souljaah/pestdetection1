from __future__ import annotations

import os
import sqlite3
from contextlib import closing, contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence


class DatabaseConfigurationError(RuntimeError):
    pass


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = PROJECT_ROOT / "api" / "schema.sql"
DEFAULT_SQLITE_PATH = PROJECT_ROOT / "instance" / "agri.sqlite3"


EXPECTED_TABLES = frozenset(
    {
        "zones",
        "cameras",
        "detections",
        "spray_logs",
        "system_events",
        "alerts",
        "system_settings",
    }
)

EXPECTED_COLUMNS = {
    "zones": {"id", "name", "spray_status", "created_at", "updated_at"},
    "cameras": {
        "id",
        "zone_id",
        "camera_code",
        "name",
        "status",
        "signal",
        "ip_address",
        "frame_rate",
        "resolution",
        "stream_url",
        "last_seen_at",
        "created_at",
        "updated_at",
    },
    "detections": {
        "id",
        "zone_id",
        "camera_id",
        "pest_class",
        "confidence",
        "status",
        "box_x",
        "box_y",
        "box_w",
        "box_h",
        "detected_at",
        "created_at",
    },
    "spray_logs": {
        "id",
        "zone_id",
        "trigger",
        "duration",
        "status",
        "activated_at",
        "created_at",
    },
    "system_events": {
        "id",
        "zone_id",
        "event_type",
        "event",
        "detail",
        "occurred_at",
        "created_at",
    },
    "alerts": {
        "id",
        "zone_id",
        "alert_type",
        "message",
        "detail",
        "acknowledged",
        "created_at",
    },
    "system_settings": {
        "id",
        "threshold",
        "spray_duration",
        "auto_spray",
        "notifications",
        "updated_at",
    },
}


@dataclass(frozen=True)
class ExecuteResult:
    last_insert_rowid: int | None
    rows_affected: int


def _statements(script: str) -> Iterable[str]:
    current = ""
    for line in script.splitlines():
        current += f"{line}\n"
        if sqlite3.complete_statement(current):
            statement = current.strip().rstrip(";").strip()
            if statement:
                yield statement
            current = ""
    if current.strip():
        yield current.strip().rstrip(";")


class Database:
    """Small parameterized-query adapter for Turso and local SQLite tests."""

    def __init__(
        self,
        *,
        turso_url: str | None = None,
        turso_token: str | None = None,
        sqlite_path: str | None = None,
    ) -> None:
        self.sqlite_path = sqlite_path
        self._client: Any = None

        if sqlite_path:
            Path(sqlite_path).parent.mkdir(parents=True, exist_ok=True)
            return

        if not turso_url or not turso_token:
            raise DatabaseConfigurationError(
                "TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required."
            )

        try:
            from libsql_client import create_client_sync
        except ImportError as exc:  # pragma: no cover - dependency exists in production
            raise DatabaseConfigurationError(
                "The libsql-client package is required for Turso connections."
            ) from exc

        self._client = create_client_sync(url=turso_url, auth_token=turso_token)

    @property
    def backend_name(self) -> str:
        return "SQLite" if self.sqlite_path else "Turso"

    @classmethod
    def from_environment(cls, sqlite_path: str | None = None) -> "Database":
        turso_url = os.getenv("TURSO_DATABASE_URL")
        turso_token = os.getenv("TURSO_AUTH_TOKEN")
        if not sqlite_path and not (turso_url or turso_token):
            # Vercel's filesystem is read-only and discarded between invocations, so a
            # local file there would silently lose every write. Require Turso instead.
            if os.getenv("VERCEL"):
                raise DatabaseConfigurationError(
                    "TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required on Vercel."
                )
            sqlite_path = os.getenv("SQLITE_PATH") or str(DEFAULT_SQLITE_PATH)
        return cls(turso_url=turso_url, turso_token=turso_token, sqlite_path=sqlite_path)

    @contextmanager
    def _sqlite_connection(self) -> Iterator[sqlite3.Connection]:
        """Open a connection, commit on success (rollback on error), and always close it."""
        if not self.sqlite_path:
            raise RuntimeError("Not a local SQLite database")
        with closing(sqlite3.connect(self.sqlite_path, timeout=10)) as connection:
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys = ON")
            with connection:
                yield connection

    @staticmethod
    def _normalize_args(args: Sequence[Any]) -> list[Any]:
        return [int(value) if isinstance(value, bool) else value for value in args]

    def query(self, sql: str, args: Sequence[Any] = ()) -> list[dict[str, Any]]:
        values = self._normalize_args(args)
        if self.sqlite_path:
            with self._sqlite_connection() as connection:
                rows = connection.execute(sql, values).fetchall()
                return [dict(row) for row in rows]

        result = self._client.execute(sql, values)
        columns = list(result.columns)
        return [dict(zip(columns, list(row), strict=True)) for row in result.rows]

    def query_one(
        self, sql: str, args: Sequence[Any] = ()
    ) -> dict[str, Any] | None:
        rows = self.query(sql, args)
        return rows[0] if rows else None

    def execute(self, sql: str, args: Sequence[Any] = ()) -> ExecuteResult:
        values = self._normalize_args(args)
        if self.sqlite_path:
            with self._sqlite_connection() as connection:
                cursor = connection.execute(sql, values)
                return ExecuteResult(cursor.lastrowid, max(cursor.rowcount, 0))

        result = self._client.execute(sql, values)
        return ExecuteResult(
            int(result.last_insert_rowid) if result.last_insert_rowid is not None else None,
            int(result.rows_affected or 0),
        )

    def batch(self, statements: Sequence[tuple[str, Sequence[Any]]]) -> list[ExecuteResult]:
        """Run several writes as one transaction: either all of them are saved or none are."""
        if self.sqlite_path:
            with self._sqlite_connection() as connection:
                results = []
                for sql, args in statements:
                    cursor = connection.execute(sql, self._normalize_args(args))
                    results.append(ExecuteResult(cursor.lastrowid, max(cursor.rowcount, 0)))
                return results

        result_sets = self._client.batch(
            [(sql, self._normalize_args(args)) for sql, args in statements]
        )
        return [
            ExecuteResult(
                int(rs.last_insert_rowid) if rs.last_insert_rowid is not None else None,
                int(rs.rows_affected or 0),
            )
            for rs in result_sets
        ]

    def execute_script(self, script: str) -> None:
        if self.sqlite_path:
            with self._sqlite_connection() as connection:
                connection.executescript(script)
            return

        for statement in _statements(script):
            self._client.execute(statement)

    def ping(self) -> bool:
        row = self.query_one("SELECT 1 AS ok")
        return bool(row and row["ok"] == 1)

    def missing_tables(self) -> list[str]:
        placeholders = ", ".join("?" for _ in EXPECTED_TABLES)
        rows = self.query(
            f"""
            SELECT name
            FROM sqlite_schema
            WHERE type = 'table' AND name IN ({placeholders})
            """,
            sorted(EXPECTED_TABLES),
        )
        existing = {str(row["name"]) for row in rows}
        return sorted(EXPECTED_TABLES - existing)

    def missing_columns(self) -> dict[str, list[str]]:
        missing_tables = set(self.missing_tables())
        missing: dict[str, list[str]] = {}
        for table, expected in EXPECTED_COLUMNS.items():
            if table in missing_tables:
                continue
            # The table name comes from the static allowlist above; values remain parameterized.
            rows = self.query(f'PRAGMA table_info("{table}")')
            existing = {str(row["name"]) for row in rows}
            absent = sorted(expected - existing)
            if absent:
                missing[table] = absent
        return missing

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
