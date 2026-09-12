from __future__ import annotations

import asyncio
import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


class WhatsAppOperatorError(RuntimeError):
    pass


@dataclass(frozen=True)
class OperatorConfig:
    base_url: str
    api_key: str
    app_id: str
    tenant_id: str
    timeout_seconds: float = 10.0


class NahaLabsWhatsAppOperator:
    """Server-only adapter based on the NahaLabs WhatsApp server-client template."""

    def __init__(self, config: OperatorConfig) -> None:
        self.config = config

    @classmethod
    def from_env(cls, tenant_id: str) -> "NahaLabsWhatsAppOperator":
        return cls(
            OperatorConfig(
                base_url=os.getenv("WHATSAPP_OPERATOR_URL", "https://my-own-whatsapp-2z5h.onrender.com").rstrip("/"),
                api_key=os.getenv("WHATSAPP_OPERATOR_API_KEY", "").strip(),
                app_id=os.getenv("WHATSAPP_APP_ID", "railwatch" ).strip(),
                tenant_id=tenant_id,
                timeout_seconds=float(os.getenv("RAILWATCH_WHATSAPP_TIMEOUT_SECONDS", "10")),
            )
        )

    @staticmethod
    def _decode(response: urllib.response.addinfourl) -> Any:
        raw = response.read().decode("utf-8")
        if not raw:
            return {}
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"raw": raw}

    def _request_sync(self, path: str, method: str = "GET", body: dict[str, Any] | None = None) -> Any:
        if not self.config.api_key:
            raise WhatsAppOperatorError("WHATSAPP_OPERATOR_API_KEY is not configured")
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(
            f"{self.config.base_url}{path}",
            data=payload,
            method=method,
            headers={
                "Accept": "application/json",
                "X-API-Key": self.config.api_key,
                "X-App-Id": self.config.app_id,
                "X-Tenant-Id": self.config.tenant_id,
                **({"Content-Type": "application/json"} if body is not None else {}),
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.config.timeout_seconds) as response:
                return self._decode(response)
        except urllib.error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            raise WhatsAppOperatorError(f"Operator HTTP {exc.code}: {details[:500]}") from exc
        except urllib.error.URLError as exc:
            raise WhatsAppOperatorError(f"WhatsApp Operator unavailable: {exc.reason}") from exc

    async def request(self, path: str, method: str = "GET", body: dict[str, Any] | None = None) -> Any:
        return await asyncio.to_thread(self._request_sync, path, method, body)

    async def health(self) -> Any:
        return await self.request("/health")

    async def bootstrap(self, webhook_url: str) -> Any:
        return await self.request(
            "/accounts/bootstrap",
            "POST",
            {
                "label": f"{self.config.app_id} WhatsApp",
                "appId": self.config.app_id,
                "tenantId": self.config.tenant_id,
                "webhookUrl": webhook_url,
            },
        )

    async def connect(self, wa_account_id: str) -> Any:
        return await self.request(f"/accounts/{wa_account_id}/connect", "POST")

    async def status(self, wa_account_id: str) -> Any:
        return await self.request(f"/accounts/{wa_account_id}/status")

    async def qr(self, wa_account_id: str) -> Any:
        return await self.request(f"/accounts/{wa_account_id}/qr")

    async def pairing_code(self, wa_account_id: str, phone_number: str) -> Any:
        return await self.request(
            f"/accounts/{wa_account_id}/pairing-code",
            "POST",
            {"phoneNumber": phone_number},
        )

    async def reset(self, wa_account_id: str) -> Any:
        return await self.request(f"/accounts/{wa_account_id}/reset", "POST")

    async def disconnect(self, wa_account_id: str) -> Any:
        return await self.request(f"/accounts/{wa_account_id}/disconnect", "POST")

    async def send_text(self, wa_account_id: str, to: str, text: str) -> Any:
        return await self.request(
            "/send",
            "POST",
            {"waAccountId": wa_account_id, "to": to, "type": "text", "text": text},
        )
