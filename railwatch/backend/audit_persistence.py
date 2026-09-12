from __future__ import annotations

import json
import logging
import os

logger = logging.getLogger("railwatch.audit")


def install() -> None:
    import operations

    original = operations._record_audit
    database_url = os.getenv("DATABASE_URL", "").strip()
    required = os.getenv("RAILWATCH_REQUIRE_AUDIT", "false").lower() in {"1", "true", "yes", "on"}

    def persist(entry: dict) -> None:
        if not database_url:
            return
        try:
            import psycopg
            with psycopg.connect(database_url, connect_timeout=3) as connection:
                with connection.cursor() as cursor:
                    cursor.execute("""
                        CREATE TABLE IF NOT EXISTS railwatch_audit (
                            id TEXT PRIMARY KEY,
                            occurred_at TIMESTAMPTZ NOT NULL,
                            actor TEXT NOT NULL,
                            tenant TEXT NOT NULL,
                            incident_id TEXT,
                            action TEXT NOT NULL,
                            details JSONB NOT NULL,
                            previous_hash TEXT NOT NULL,
                            event_hash TEXT NOT NULL
                        )
                    """)
                    cursor.execute("""
                        INSERT INTO railwatch_audit
                        (id, occurred_at, actor, tenant, incident_id, action, details, previous_hash, event_hash)
                        VALUES (%s, %s::timestamptz, %s, %s, %s, %s, %s::jsonb, %s, %s)
                        ON CONFLICT (id) DO NOTHING
                    """, (
                        entry["id"], entry["timestamp"], entry["actor"], entry["tenant"], entry["incident_id"],
                        entry["action"], json.dumps(entry["details"]), entry["previous_hash"], entry["event_hash"],
                    ))
                connection.commit()
        except Exception as exc:
            logger.warning("RailWatch audit persistence failed: %s", exc)
            if required:
                raise RuntimeError("Required RailWatch audit persistence unavailable") from exc

    def wrapped(action: str, event_id: str | None, actor: str, tenant: str, details: dict | None = None) -> dict:
        entry = original(action, event_id, actor, tenant, details)
        persist(entry)
        return entry

    operations._record_audit = wrapped
