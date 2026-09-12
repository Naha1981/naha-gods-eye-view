from __future__ import annotations

import json
import logging
import os

logger = logging.getLogger("railwatch.audit")


def install() -> None:
    import operations

    if getattr(operations, "_AUDIT_PERSISTENCE_INSTALLED", False):
        return
    operations._AUDIT_PERSISTENCE_INSTALLED = True

    database_url = os.getenv("DATABASE_URL", "").strip()
    required = os.getenv("RAILWATCH_REQUIRE_AUDIT", "false").lower() in {"1", "true", "yes", "on"}
    if not database_url:
        return

    def ensure_table() -> None:
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
                    CREATE INDEX IF NOT EXISTS railwatch_audit_occurred_at_idx
                    ON railwatch_audit (occurred_at DESC)
                """)
            connection.commit()

    def persist(entry: dict) -> None:
        try:
            import psycopg
            with psycopg.connect(database_url, connect_timeout=3) as connection:
                with connection.cursor() as cursor:
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

    try:
        ensure_table()
    except Exception as exc:
        logger.warning("RailWatch audit table bootstrap unavailable: %s", exc)
        if required:
            raise RuntimeError("Required RailWatch audit persistence unavailable") from exc
        return

    # Restore the tail of the persisted audit chain so the next event continues
    # from the last durable hash instead of resetting to GENESIS after a restart.
    try:
        import psycopg
        with psycopg.connect(database_url, connect_timeout=3) as connection:
            with connection.cursor() as cursor:
                cursor.execute("""
                    SELECT id, occurred_at, actor, tenant, incident_id, action, details,
                           previous_hash, event_hash
                    FROM railwatch_audit
                    ORDER BY occurred_at DESC, id DESC
                    LIMIT 500
                """)
                rows = cursor.fetchall()
        restored = []
        for row in reversed(rows):
            details = row[6] if isinstance(row[6], dict) else json.loads(row[6])
            restored.append({
                "id": row[0],
                "timestamp": row[1].isoformat() if hasattr(row[1], "isoformat") else str(row[1]),
                "actor": row[2],
                "tenant": row[3],
                "incident_id": row[4],
                "action": row[5],
                "details": details,
                "previous_hash": row[7],
                "event_hash": row[8],
            })
        operations._AUDIT[:] = restored
    except Exception as exc:
        logger.warning("RailWatch audit hydration unavailable: %s", exc)
        if required:
            raise RuntimeError("Required RailWatch audit persistence unavailable") from exc

    def wrapped(action: str, event_id: str | None, actor: str, tenant: str, details: dict | None = None) -> dict:
        entry = operations._record_audit_original(action, event_id, actor, tenant, details)
        persist(entry)
        return entry

    operations._record_audit_original = operations._record_audit
    operations._record_audit = wrapped
