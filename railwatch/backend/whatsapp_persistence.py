from __future__ import annotations

import json
import logging
import os
import threading
from typing import Any

logger = logging.getLogger("railwatch.whatsapp.persistence")


class WhatsAppPersistence:
    def __init__(self) -> None:
        self.database_url = os.getenv("DATABASE_URL", "").strip()
        self.required = os.getenv("RAILWATCH_REQUIRE_PERSISTENCE", "false").lower() in {"1", "true", "yes", "on"}
        self.enabled = bool(self.database_url)
        self.available = False
        self.error: str | None = None
        self._memory_bindings: dict[str, dict[str, Any]] = {}
        self._memory_events: set[str] = set()
        self._lock = threading.Lock()

    def _connect(self):
        if not self.enabled:
            return None
        import psycopg
        return psycopg.connect(self.database_url, connect_timeout=3)

    def initialize(self) -> bool:
        if not self.enabled:
            return False
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        CREATE TABLE IF NOT EXISTS railwatch_whatsapp_bindings (
                            app_id TEXT NOT NULL,
                            tenant_id TEXT NOT NULL,
                            wa_account_id TEXT NOT NULL,
                            webhook_url TEXT NOT NULL,
                            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                            PRIMARY KEY (app_id, tenant_id)
                        )
                        """
                    )
                    cursor.execute(
                        """
                        CREATE UNIQUE INDEX IF NOT EXISTS railwatch_whatsapp_bindings_account_idx
                        ON railwatch_whatsapp_bindings (wa_account_id)
                        """
                    )
                    cursor.execute(
                        """
                        CREATE TABLE IF NOT EXISTS railwatch_whatsapp_events (
                            message_id TEXT PRIMARY KEY,
                            app_id TEXT NOT NULL,
                            tenant_id TEXT NOT NULL,
                            wa_account_id TEXT NOT NULL,
                            event_type TEXT NOT NULL,
                            payload JSONB NOT NULL,
                            received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                        )
                        """
                    )
                connection.commit()
            self.available = True
            self.error = None
            return True
        except Exception as exc:
            self.available = False
            self.error = str(exc)
            logger.warning("RailWatch WhatsApp persistence unavailable: %s", exc)
            return False

    def get_binding(self, app_id: str, tenant_id: str) -> dict[str, Any] | None:
        key = f"{app_id}:{tenant_id}"
        if not self.enabled:
            return self._memory_bindings.get(key)
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT app_id, tenant_id, wa_account_id, webhook_url FROM railwatch_whatsapp_bindings WHERE app_id=%s AND tenant_id=%s",
                        (app_id, tenant_id),
                    )
                    row = cursor.fetchone()
            self.available = True
            self.error = None
            if not row:
                return None
            return {"appId": row[0], "tenantId": row[1], "waAccountId": row[2], "webhookUrl": row[3]}
        except Exception as exc:
            self.available = False
            self.error = str(exc)
            logger.warning("RailWatch WhatsApp binding lookup failed: %s", exc)
            return None

    def save_binding(self, app_id: str, tenant_id: str, wa_account_id: str, webhook_url: str) -> dict[str, Any]:
        binding = {"appId": app_id, "tenantId": tenant_id, "waAccountId": wa_account_id, "webhookUrl": webhook_url}
        key = f"{app_id}:{tenant_id}"
        if not self.enabled:
            self._memory_bindings[key] = binding
            return binding
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO railwatch_whatsapp_bindings (app_id, tenant_id, wa_account_id, webhook_url)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (app_id, tenant_id) DO UPDATE SET
                        wa_account_id=EXCLUDED.wa_account_id,
                        webhook_url=EXCLUDED.webhook_url,
                        updated_at=NOW()
                    """,
                    (app_id, tenant_id, wa_account_id, webhook_url),
                )
            connection.commit()
        self.available = True
        self.error = None
        return binding

    def has_event(self, message_id: str) -> bool:
        if not message_id:
            return False
        if not self.enabled:
            with self._lock:
                return message_id in self._memory_events
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT 1 FROM railwatch_whatsapp_events WHERE message_id=%s", (message_id,))
                    found = cursor.fetchone() is not None
            self.available = True
            self.error = None
            return found
        except Exception as exc:
            self.available = False
            self.error = str(exc)
            logger.warning("RailWatch WhatsApp webhook idempotency lookup failed: %s", exc)
            return False

    def mark_event(self, message_id: str, app_id: str, tenant_id: str, wa_account_id: str, event_type: str, payload: dict[str, Any]) -> None:
        if not message_id:
            return
        if not self.enabled:
            with self._lock:
                self._memory_events.add(message_id)
            return
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO railwatch_whatsapp_events (message_id, app_id, tenant_id, wa_account_id, event_type, payload)
                    VALUES (%s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (message_id) DO NOTHING
                    """,
                    (message_id, app_id, tenant_id, wa_account_id, event_type, json.dumps(payload, default=str)),
                )
            connection.commit()
        self.available = True
        self.error = None

    def health(self) -> dict[str, Any]:
        if not self.enabled:
            return {"mode": "memory", "configured": False, "available": False, "required": self.required}
        return {
            "mode": "postgres",
            "configured": True,
            "available": self.available,
            "required": self.required,
            **({"error": self.error} if self.error else {}),
        }
