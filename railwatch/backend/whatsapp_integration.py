from __future__ import annotations

import hashlib
import hmac
import os
import re
from typing import Any

from fastapi import Body, Header, HTTPException, Request, status

from whatsapp_operator import NahaLabsWhatsAppOperator, WhatsAppOperatorError
from whatsapp_persistence import WhatsAppPersistence


_OPERATOR_NUMBERS = re.compile(r"[^0-9:+,@=;|a-zA-Z_-]")


def _flag(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default).lower()).strip().lower() in {"1", "true", "yes", "on"}


def _app_id() -> str:
    return os.getenv("WHATSAPP_APP_ID", "railwatch").strip()


def _public_app_url() -> str:
    return (os.getenv("RAILWATCH_APP_URL") or os.getenv("APP_URL") or os.getenv("RENDER_EXTERNAL_URL") or "").rstrip("/")


def _webhook_url() -> str:
    base = _public_app_url()
    return f"{base}/api/v1/webhooks/whatsapp" if base else "/api/v1/webhooks/whatsapp"


def _recipients() -> list[str]:
    raw = os.getenv("RAILWATCH_WHATSAPP_ALERT_RECIPIENTS", "")
    return [value.strip() for value in raw.split(",") if value.strip()]


def _operators() -> dict[str, str]:
    raw = os.getenv("RAILWATCH_WHATSAPP_OPERATORS", "")
    result: dict[str, str] = {}
    for item in raw.split(","):
        if not item or "=" not in item:
            continue
        number, role = item.split("=", 1)
        digits = re.sub(r"\D", "", number)
        if digits and role.strip():
            result[digits] = role.strip().lower()
    return result


def _normalize_sender(value: str | None) -> str:
    return re.sub(r"\D", "", value or "")


def _verify_webhook(raw: bytes, signature: str | None) -> bool:
    secret = os.getenv("WHATSAPP_WEBHOOK_SECRET", "").strip()
    if not secret or not signature:
        return False
    expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    provided = signature.removeprefix("sha256=")
    return hmac.compare_digest(expected, provided)


def _operator_claims(authorization: str | None) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    from operations import parse_operator_token
    return parse_operator_token(authorization.split(" ", 1)[1].strip())


HELP_TEXT = (
    "RailWatch WhatsApp commands:\n"
    "STATUS\n"
    "SHOW <event_id>\n"
    "ACKNOWLEDGE <event_id>\n"
    "VERIFY <event_id>\n"
    "DISPATCH <event_id>\n"
    "RESOLVE <event_id>\n"
    "PROVE <event_id>"
)


class RailWatchWhatsApp:
    def __init__(self, app: Any, manager: Any, store: Any) -> None:
        self.app = app
        self.manager = manager
        self.store = store
        self.persistence = WhatsAppPersistence()
        self.enabled = _flag("RAILWATCH_WHATSAPP_ENABLED")
        self.auto_alerts = _flag("RAILWATCH_WHATSAPP_AUTO_ALERTS")
        self.install_once = False

    def _tenant_from_claims(self, authorization: str | None) -> str:
        return str(_operator_claims(authorization)["tenant"])

    async def _binding(self, tenant: str) -> dict[str, Any] | None:
        return self.persistence.get_binding(_app_id(), tenant)

    async def _ensure_binding(self, tenant: str) -> dict[str, Any]:
        existing = await self._binding(tenant)
        if existing:
            return existing
        if not _public_app_url():
            raise HTTPException(status_code=503, detail="RAILWATCH_APP_URL/APP_URL is required for WhatsApp webhooks")
        operator = NahaLabsWhatsAppOperator.from_env(tenant)
        try:
            result = await operator.bootstrap(_webhook_url())
        except WhatsAppOperatorError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        account_id = str(result.get("waAccountId") or result.get("id") or "")
        if not account_id:
            raise HTTPException(status_code=502, detail="WhatsApp Operator did not return waAccountId")
        return self.persistence.save_binding(_app_id(), tenant, account_id, _webhook_url())

    async def account_status(self, tenant: str) -> dict[str, Any]:
        binding = await self._binding(tenant)
        if not binding:
            return {
                "enabled": self.enabled,
                "configured": bool(os.getenv("WHATSAPP_OPERATOR_API_KEY")),
                "paired": False,
                "tenant": tenant,
                "appId": _app_id(),
                "webhookUrl": _webhook_url(),
                "recipientsConfigured": bool(_recipients()),
            }
        operator = NahaLabsWhatsAppOperator.from_env(tenant)
        try:
            status_result = await operator.status(binding["waAccountId"])
        except WhatsAppOperatorError as exc:
            return {"enabled": self.enabled, "configured": True, "paired": False, "error": str(exc), **binding}
        return {
            "enabled": self.enabled,
            "configured": True,
            "paired": bool(status_result.get("isConnected")),
            "operator": status_result,
            **binding,
        }

    async def notify_incident(self, event_id: str, tenant: str | None = None) -> dict[str, Any]:
        tenant = tenant or os.getenv("RAILWATCH_DEFAULT_TENANT", "NahaLabs-Demo")
        binding = await self._binding(tenant)
        if not binding:
            return {"status": "not_configured", "event_id": event_id, "sent": 0}
        payload = self.manager.events.get(event_id)
        if not payload:
            raise HTTPException(status_code=404, detail="Incident not found")
        data = payload.get("data", payload)
        incident = data.get("incident") or {}
        recipients = _recipients()
        if not recipients:
            return {"status": "no_recipients", "event_id": event_id, "sent": 0}
        text = (
            "🚨 RAILWATCH INCIDENT\n\n"
            f"{data.get('severity', 'UNKNOWN')} · {data.get('alert_type', 'EVENT')}\n"
            f"Location: {incident.get('location_name', data.get('segment', 'Unknown'))}\n"
            f"KM: {data.get('km_marker', '—')}\n"
            f"Asset: {incident.get('asset_type', '—')}\n"
            f"Impact: {incident.get('operational_impact', 'Assessment pending')}\n\n"
            "ACTION: VERIFY BEFORE DISPATCH\n"
            f"Event: {event_id}"
        )
        operator = NahaLabsWhatsAppOperator.from_env(tenant)
        sent = 0
        errors: list[str] = []
        for recipient in recipients:
            try:
                await operator.send_text(binding["waAccountId"], recipient, text)
                sent += 1
            except WhatsAppOperatorError as exc:
                errors.append(str(exc))
        return {"status": "sent" if sent else "failed", "event_id": event_id, "sent": sent, "errors": errors}

    async def reply(self, wa_account_id: str, to: str, text: str, tenant: str) -> None:
        operator = NahaLabsWhatsAppOperator.from_env(tenant)
        try:
            await operator.send_text(wa_account_id, to, text)
        except WhatsAppOperatorError:
            # Webhook acknowledgement should remain fast; Operator retry/dead-letter handles transport failures.
            return

    def _latest_events(self) -> list[dict[str, Any]]:
        events = list(self.manager.events.values())
        return list(reversed(events[-10:]))

    async def _handle_command(self, text: str, sender: str, chat: str, wa_account_id: str, tenant: str) -> None:
        from operations import add_action

        command = " ".join(text.strip().split())
        upper = command.upper()
        if upper in {"HELP", "?"}:
            await self.reply(wa_account_id, chat, HELP_TEXT, tenant)
            return
        if upper == "STATUS":
            events = self._latest_events()
            if not events:
                await self.reply(wa_account_id, chat, "RailWatch status: no recent incidents.", tenant)
                return
            lines = ["RAILWATCH STATUS", ""]
            for event in events[:5]:
                data = event.get("data", {})
                incident = data.get("incident") or {}
                lines.append(
                    f"• {data.get('severity', 'UNKNOWN')} {data.get('alert_type', 'EVENT')} — "
                    f"{incident.get('location_name', data.get('segment', 'Unknown'))} — {data.get('event_id')}"
                )
            await self.reply(wa_account_id, chat, "\n".join(lines), tenant)
            return

        match = re.match(r"^(SHOW|ACKNOWLEDGE|VERIFY|DISPATCH|RESOLVE|PROVE)\s+([A-Za-z0-9._:-]+)$", command, re.I)
        if not match:
            await self.reply(wa_account_id, chat, "Unknown command. Send HELP for available RailWatch commands.", tenant)
            return

        action, event_id = match.group(1).upper(), match.group(2)
        payload = self.manager.events.get(event_id)
        if not payload:
            await self.reply(wa_account_id, chat, f"Incident {event_id} was not found in the active event store.", tenant)
            return
        data = payload.get("data", payload)
        incident = data.get("incident") or {}
        if action == "SHOW":
            await self.reply(
                wa_account_id,
                chat,
                (
                    f"{data.get('severity', 'UNKNOWN')} {data.get('alert_type', 'EVENT')}\n"
                    f"{incident.get('location_name', data.get('segment', 'Unknown'))}\n"
                    f"KM {data.get('km_marker', '—')} · {event_id}\n"
                    f"Impact: {incident.get('operational_impact', '—')}\n"
                    f"Recommendation: {incident.get('recommended_action', 'Verify with operations')}"
                ),
                tenant,
            )
            return

        role = _operators().get(sender)
        if not role:
            await self.reply(wa_account_id, chat, "This WhatsApp number is not authorised for RailWatch operator commands.", tenant)
            return
        allowed = {
            "ACKNOWLEDGE": {"admin", "controller"},
            "VERIFY": {"admin", "controller"},
            "DISPATCH": {"admin", "controller", "dispatcher"},
            "RESOLVE": {"admin", "controller", "dispatcher"},
            "PROVE": {"admin", "controller", "viewer"},
        }
        if role not in allowed[action]:
            await self.reply(wa_account_id, chat, f"Role {role} cannot perform {action}.", tenant)
            return
        try:
            result = add_action(event_id, action, f"whatsapp:{sender}", tenant, "Command received through NahaLabs WhatsApp Operator")
        except HTTPException as exc:
            await self.reply(wa_account_id, chat, f"RailWatch rejected {action}: {exc.detail}", tenant)
            return
        await self.reply(wa_account_id, chat, f"✅ {action} recorded for {event_id}. Stage: {result['stage']}.", tenant)

    async def handle_webhook(self, request: Request, signature: str | None) -> dict[str, Any]:
        raw = await request.body()
        if not _verify_webhook(raw, signature):
            raise HTTPException(status_code=401, detail="Invalid WhatsApp webhook signature")
        body = await request.json()
        event = str(body.get("event") or "message")
        app_id = str(body.get("appId") or "")
        tenant = str(body.get("tenantId") or "")
        account_id = str(body.get("waAccountId") or "")
        if app_id != _app_id() or not tenant or not account_id:
            raise HTTPException(status_code=403, detail="Invalid WhatsApp application scope")
        data = body.get("data") if isinstance(body.get("data"), dict) else body.get("message") if isinstance(body.get("message"), dict) else {}
        message_id = str(data.get("messageId") or data.get("key", {}).get("id") or "")
        if message_id and self.persistence.has_event(message_id):
            return {"ok": True, "duplicate": True}
        self.persistence.mark_event(message_id, app_id, tenant, account_id, event, body)

        if event == "message":
            sender = _normalize_sender(str(data.get("senderId") or data.get("participant") or data.get("sender") or ""))
            chat = str(data.get("chatId") or data.get("remoteJid") or sender)
            text = str(data.get("text") or data.get("conversation") or "").strip()
            if text:
                await self._handle_command(text, sender, chat, account_id, tenant)
            elif str(data.get("messageType") or "").lower() in {"audio", "ptt"}:
                await self.reply(account_id, chat, "🎙️ Voice message received. Voice-command transcription is the next channel adapter; text commands are active now. Send HELP for commands.", tenant)
        return {"ok": True, "duplicate": False}

    def install_routes(self) -> None:
        if self.install_once:
            return
        self.install_once = True

        @self.app.get("/api/v1/whatsapp/status")
        async def whatsapp_status(authorization: str | None = Header(default=None)) -> dict[str, Any]:
            if not self.enabled:
                return {"enabled": False, "message": "RailWatch WhatsApp integration is disabled"}
            claims = _operator_claims(authorization)
            return await self.account_status(str(claims["tenant"]))

        @self.app.post("/api/v1/whatsapp/bootstrap")
        async def whatsapp_bootstrap(authorization: str | None = Header(default=None)) -> dict[str, Any]:
            if not self.enabled:
                raise HTTPException(status_code=404, detail="WhatsApp integration disabled")
            claims = _operator_claims(authorization)
            return await self._ensure_binding(str(claims["tenant"]))

        @self.app.post("/api/v1/whatsapp/connect")
        async def whatsapp_connect(authorization: str | None = Header(default=None)) -> dict[str, Any]:
            claims = _operator_claims(authorization)
            binding = await self._ensure_binding(str(claims["tenant"]))
            operator = NahaLabsWhatsAppOperator.from_env(str(claims["tenant"]))
            try:
                result = await operator.connect(binding["waAccountId"])
            except WhatsAppOperatorError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc
            return {"binding": binding, "operator": result}

        @self.app.get("/api/v1/whatsapp/qr")
        async def whatsapp_qr(authorization: str | None = Header(default=None)) -> dict[str, Any]:
            claims = _operator_claims(authorization)
            binding = await self._ensure_binding(str(claims["tenant"]))
            try:
                result = await NahaLabsWhatsAppOperator.from_env(str(claims["tenant"])).qr(binding["waAccountId"])
            except WhatsAppOperatorError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc
            return result

        @self.app.post("/api/v1/whatsapp/pairing-code")
        async def whatsapp_pairing_code(phoneNumber: str = Body(embed=True), authorization: str | None = Header(default=None)) -> dict[str, Any]:
            claims = _operator_claims(authorization)
            binding = await self._ensure_binding(str(claims["tenant"]))
            try:
                return await NahaLabsWhatsAppOperator.from_env(str(claims["tenant"])).pairing_code(binding["waAccountId"], phoneNumber)
            except WhatsAppOperatorError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc

        @self.app.post("/api/v1/whatsapp/notify/{event_id}")
        async def whatsapp_notify(event_id: str, authorization: str | None = Header(default=None)) -> dict[str, Any]:
            claims = _operator_claims(authorization)
            return await self.notify_incident(event_id, str(claims["tenant"]))

        @self.app.post("/api/v1/webhooks/whatsapp")
        async def whatsapp_webhook(request: Request, x_webhook_signature: str | None = Header(default=None)) -> dict[str, Any]:
            return await self.handle_webhook(request, x_webhook_signature)

        @self.app.get("/api/v1/whatsapp/health")
        async def whatsapp_health() -> dict[str, Any]:
            return {
                "enabled": self.enabled,
                "autoAlerts": self.auto_alerts,
                "appId": _app_id(),
                "webhookUrl": _webhook_url(),
                "persistence": self.persistence.health(),
                "operatorConfigured": bool(os.getenv("WHATSAPP_OPERATOR_API_KEY")),
                "recipientsConfigured": bool(_recipients()),
            }

    def install(self) -> None:
        if not self.enabled:
            self.install_routes()
            return
        self.persistence.initialize()
        self.install_routes()
        if self.auto_alerts:
            import main
            original = main._store_and_broadcast

            async def enhanced(alert: Any, dedupe_key: str) -> dict[str, Any]:
                result = await original(alert, dedupe_key)
                if result.get("status") == "accepted":
                    try:
                        await self.notify_incident(alert.event_id)
                    except Exception:
                        pass
                return result

            if not getattr(main, "_railwatch_whatsapp_wrapped", False):
                main._store_and_broadcast = enhanced
                main._railwatch_whatsapp_wrapped = True


def install(app: Any, manager: Any, store: Any) -> RailWatchWhatsApp:
    service = getattr(app.state, "railwatch_whatsapp", None)
    if service is None:
        service = RailWatchWhatsApp(app, manager, store)
        app.state.railwatch_whatsapp = service
    service.install()
    return service
