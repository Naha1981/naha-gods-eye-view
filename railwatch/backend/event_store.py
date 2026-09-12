from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger("railwatch.event_store")


class EventStore:
    """Small synchronous PostgreSQL adapter with an explicit memory fallback.

    PostgreSQL is optional so local/demo environments remain keyless. When
    DATABASE_URL is configured, callers can require persistence and fail closed
    instead of claiming an event was accepted without durable storage.
    """

    def __init__(self, database_url: str | None = None) -> None:
        self.database_url = database_url if database_url is not None else os.getenv("DATABASE_URL", "").strip()
        self.required = os.getenv("RAILWATCH_REQUIRE_PERSISTENCE", "false").lower() in {"1", "true", "yes", "on"}
        self.enabled = bool(self.database_url)
        self.available = False
        self.error: str | None = None

    def _connect(self):
        if not self.enabled:
            return None
        try:
            import psycopg
        except ImportError as exc:  # pragma: no cover - packaging failure only
            raise RuntimeError("psycopg is required when DATABASE_URL is configured") from exc
        return psycopg.connect(self.database_url, connect_timeout=3)

    def initialize(self) -> bool:
        if not self.enabled:
            self.available = False
            self.error = None
            return False
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        CREATE TABLE IF NOT EXISTS railwatch_events (
                            dedupe_key TEXT PRIMARY KEY,
                            event_id TEXT NOT NULL,
                            occurred_at TIMESTAMPTZ NOT NULL,
                            event_hash TEXT NOT NULL,
                            payload JSONB NOT NULL,
                            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                        )
                        """
                    )
                    cursor.execute(
                        """
                        CREATE INDEX IF NOT EXISTS railwatch_events_occurred_at_idx
                        ON railwatch_events (occurred_at DESC)
                        """
                    )
                connection.commit()
            self.available = True
            self.error = None
            return True
        except Exception as exc:  # pragma: no cover - depends on deployment DB
            self.available = False
            self.error = str(exc)
            logger.warning("RailWatch PostgreSQL unavailable: %s", exc)
            return False

    def insert(self, dedupe_key: str, event_id: str, occurred_at: str, event_hash: str, payload: dict[str, Any]) -> bool | None:
        if not self.enabled:
            return None
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        INSERT INTO railwatch_events (dedupe_key, event_id, occurred_at, event_hash, payload)
                        VALUES (%s, %s, %s::timestamptz, %s, %s::jsonb)
                        ON CONFLICT (dedupe_key) DO NOTHING
                        RETURNING dedupe_key
                        """,
                        (dedupe_key, event_id, occurred_at, event_hash, json.dumps(payload)),
                    )
                    inserted = cursor.fetchone() is not None
                connection.commit()
            self.available = True
            self.error = None
            return inserted
        except Exception as exc:  # pragma: no cover - depends on deployment DB
            self.available = False
            self.error = str(exc)
            logger.warning("RailWatch PostgreSQL write failed: %s", exc)
            return None

    def recent(self, limit: int) -> list[dict[str, Any]]:
        if not self.enabled:
            return []
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT payload
                        FROM railwatch_events
                        ORDER BY occurred_at DESC, created_at DESC
                        LIMIT %s
                        """,
                        (max(1, min(limit, 500)),),
                    )
                    rows = cursor.fetchall()
            self.available = True
            self.error = None
            return [row[0] for row in reversed(rows)]
        except Exception as exc:  # pragma: no cover - depends on deployment DB
            self.available = False
            self.error = str(exc)
            logger.warning("RailWatch PostgreSQL read failed: %s", exc)
            return []

    def health(self) -> dict[str, Any]:
        if not self.enabled:
            return {"mode": "memory", "configured": False, "available": False, "required": self.required}
        if self.available:
            return {"mode": "postgres", "configured": True, "available": True, "required": self.required}
        return {
            "mode": "postgres",
            "configured": True,
            "available": False,
            "required": self.required,
            "error": self.error or "not initialized",
        }
