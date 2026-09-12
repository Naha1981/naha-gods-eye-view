from __future__ import annotations

import json
import logging
import os

logger = logging.getLogger("railwatch.incidents")


def install() -> None:
    import operations

    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url or getattr(operations, "_INCIDENT_PERSISTENCE_INSTALLED", False):
        return
    operations._INCIDENT_PERSISTENCE_INSTALLED = True

    def ensure_table() -> None:
        import psycopg
        with psycopg.connect(database_url, connect_timeout=3) as connection:
            with connection.cursor() as cursor:
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS railwatch_incidents (
                        event_id TEXT PRIMARY KEY,
                        tenant TEXT NOT NULL,
                        status TEXT NOT NULL,
                        stage TEXT NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL,
                        severity TEXT NOT NULL,
                        state JSONB NOT NULL,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                """)
            connection.commit()

    try:
        ensure_table()
    except Exception as exc:
        logger.warning("RailWatch incident table bootstrap unavailable: %s", exc)

    def write(record: dict) -> None:
        try:
            import psycopg
            with psycopg.connect(database_url, connect_timeout=3) as connection:
                with connection.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO railwatch_incidents
                        (event_id, tenant, status, stage, created_at, severity, state)
                        VALUES (%s, %s, %s, %s, %s::timestamptz, %s, %s::jsonb)
                        ON CONFLICT (event_id) DO UPDATE SET
                            tenant = EXCLUDED.tenant,
                            status = EXCLUDED.status,
                            stage = EXCLUDED.stage,
                            severity = EXCLUDED.severity,
                            state = EXCLUDED.state,
                            updated_at = NOW()
                    """, (record["event_id"], record["tenant"], record["status"], record["stage"], record["created_at"], record["severity"], json.dumps(record)))
                connection.commit()
        except Exception as exc:
            logger.warning("RailWatch incident persistence failed: %s", exc)

    original_register = operations.register_incident
    original_action = operations.add_action

    def wrapped_register(payload: dict, actor: str = "system", source: str = "telemetry") -> dict:
        record = original_register(payload, actor, source)
        write(record)
        return record

    def wrapped_action(event_id: str, action: str, actor: str, tenant: str, note: str | None = None) -> dict:
        result = original_action(event_id, action, actor, tenant, note)
        record = operations._INCIDENTS.get(event_id)
        if record:
            write(record)
        return result

    operations.register_incident = wrapped_register
    operations.add_action = wrapped_action

    try:
        import psycopg
        with psycopg.connect(database_url, connect_timeout=3) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT state FROM railwatch_incidents ORDER BY updated_at DESC LIMIT 500")
                rows = cursor.fetchall()
        for row in rows:
            state = row[0]
            if isinstance(state, dict) and state.get("event_id"):
                operations._INCIDENTS[state["event_id"]] = state
    except Exception as exc:
        logger.warning("RailWatch incident hydration unavailable: %s", exc)
