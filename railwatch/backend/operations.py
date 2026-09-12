from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import Body, Header, HTTPException, Request, status

STAGES = ("DETECT", "LOCATE", "VERIFY", "RESPOND", "RESOLVE", "PROVE")
ROLES = {"admin", "controller", "dispatcher", "viewer"}
SLA_SECONDS = {
    "CRITICAL": {"ACK": 30, "VERIFY": 120, "DISPATCH": 300},
    "HIGH": {"ACK": 60, "VERIFY": 300, "DISPATCH": 600},
    "WARNING": {"ACK": 120, "VERIFY": 600, "DISPATCH": 900},
    "INFO": {"ACK": 300, "VERIFY": 900, "DISPATCH": 1800},
}

_METRICS: dict[str, int] = {
    "accepted": 0,
    "duplicate": 0,
    "signed_accepted": 0,
    "signature_rejected": 0,
    "replay_rejected": 0,
    "operator_actions": 0,
    "broadcast_failures": 0,
}
_INCIDENTS: dict[str, dict[str, Any]] = {}
_AUDIT: list[dict[str, Any]] = []
_NONCES: dict[str, float] = {}
_START = time.monotonic()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _secret_map() -> dict[str, str]:
    raw = os.getenv("RAILWATCH_SIGNING_KEYS", "")
    result: dict[str, str] = {}
    for item in raw.split(","):
        if "=" in item:
            client, secret = item.split("=", 1)
            if client.strip() and secret.strip():
                result[client.strip()] = secret.strip()
    default = os.getenv("RAILWATCH_SIGNING_SECRET", "")
    if default:
        result.setdefault("demo-sensor", default)
    return result


def _record_audit(action: str, event_id: str | None, actor: str, tenant: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    previous = _AUDIT[-1]["event_hash"] if _AUDIT else "GENESIS"
    body = {
        "id": str(uuid.uuid4()),
        "timestamp": _utc_now().isoformat(),
        "actor": actor,
        "tenant": tenant,
        "incident_id": event_id,
        "action": action,
        "details": details or {},
        "previous_hash": previous,
    }
    body["event_hash"] = hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    _AUDIT.append(body)
    _METRICS["operator_actions"] += 1 if action.startswith("OPERATOR_") else 0
    return body


def _rule_evaluation(payload: dict[str, Any]) -> dict[str, Any]:
    data = payload.get("data", {})
    severity = str(data.get("severity", "INFO"))
    alert_type = str(data.get("alert_type", ""))
    impact = str((data.get("incident") or {}).get("operational_impact", "")).upper()
    critical_breach = severity == "CRITICAL" and alert_type == "LINE_BREACH"
    train_nearby = "TRAIN" in impact or "TRAIN" in json.dumps(data).upper()
    cctv_confirmed = "CCTV_CONFIRM" in json.dumps(data).upper()
    escalate = critical_breach and (train_nearby or not cctv_confirmed)
    return {
        "ruleset": "railwatch-deterministic-v1",
        "critical_line_breach": critical_breach,
        "train_nearby": train_nearby,
        "cctv_confirmed": cctv_confirmed,
        "recommended_escalation": "IMMEDIATE" if escalate else "STANDARD",
        "explanation": "CRITICAL line breach requires immediate controller attention and verification." if critical_breach else "Standard operating workflow applies.",
    }


def _incident_record(payload: dict[str, Any]) -> dict[str, Any]:
    data = payload.get("data", {})
    event_id = str(data.get("event_id"))
    severity = str(data.get("severity", "INFO"))
    occurred = data.get("timestamp") or _utc_now().isoformat()
    try:
        occurred_at = datetime.fromisoformat(str(occurred).replace("Z", "+00:00"))
    except ValueError:
        occurred_at = _utc_now()
    sla = SLA_SECONDS.get(severity, SLA_SECONDS["INFO"])
    timeline = [
        {"stage": "DETECT", "action": "SIGNAL_RECEIVED", "timestamp": occurred_at.isoformat(), "actor": "system"},
    ]
    return {
        "event_id": event_id,
        "tenant": "NahaLabs-Demo",
        "status": "OPEN",
        "stage": "DETECT",
        "created_at": occurred_at.isoformat(),
        "severity": severity,
        "sla": {k: {"seconds": v, "due_at": (occurred_at.timestamp() + v)} for k, v in sla.items()},
        "timeline": timeline,
        "rules": _rule_evaluation(payload),
        "data_classification": (data.get("incident") or {}).get("data_classification", "DEMO · NOT AUTHORITATIVE GIS"),
    }


def register_incident(payload: dict[str, Any], actor: str = "system", source: str = "telemetry") -> dict[str, Any]:
    event_id = str(payload.get("data", {}).get("event_id"))
    record = _INCIDENTS.get(event_id)
    if not record:
        record = _incident_record(payload)
        _INCIDENTS[event_id] = record
        _record_audit("INCIDENT_CREATED", event_id, actor, record["tenant"], {"source": source, "rules": record["rules"]})
    return record


def add_action(event_id: str, action: str, actor: str, tenant: str, note: str | None = None) -> dict[str, Any]:
    incident = _INCIDENTS.get(event_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    transition = {
        "ACKNOWLEDGE": "VERIFY",
        "VERIFY": "VERIFY",
        "DISPATCH": "RESPOND",
        "RESOLVE": "RESOLVE",
        "PROVE": "PROVE",
        "CLOSE": "PROVE",
    }
    next_stage = transition.get(action.upper(), incident["stage"])
    if STAGES.index(next_stage) < STAGES.index(incident["stage"]):
        next_stage = incident["stage"]
    if action.upper() == "CLOSE":
        incident["status"] = "CLOSED"
    incident["stage"] = next_stage
    entry = {"stage": next_stage, "action": action.upper(), "timestamp": _utc_now().isoformat(), "actor": actor, "note": note or ""}
    incident["timeline"].append(entry)
    _record_audit(f"OPERATOR_{action.upper()}", event_id, actor, tenant, {"stage": next_stage, "note": note or ""})
    return entry


def _verify_signed_request(raw: bytes, client: str, timestamp: str, nonce: str, signature: str) -> None:
    secrets = _secret_map()
    secret = secrets.get(client)
    if not secret:
        _METRICS["signature_rejected"] += 1
        raise HTTPException(status_code=401, detail="Unknown telemetry client")
    try:
        sent_at = int(timestamp)
    except ValueError as exc:
        _METRICS["signature_rejected"] += 1
        raise HTTPException(status_code=401, detail="Invalid telemetry signature") from exc
    if abs(int(time.time()) - sent_at) > int(os.getenv("RAILWATCH_SIGNATURE_TTL", "120")):
        _METRICS["signature_rejected"] += 1
        raise HTTPException(status_code=401, detail="Expired telemetry signature")
    key = f"{client}:{nonce}"
    now = time.time()
    for cached, expiry in list(_NONCES.items()):
        if expiry <= now:
            _NONCES.pop(cached, None)
    if key in _NONCES:
        _METRICS["replay_rejected"] += 1
        raise HTTPException(status_code=409, detail="Replay detected")
    expected = hmac.new(secret.encode(), f"{timestamp}.{nonce}.".encode() + raw, hashlib.sha256).hexdigest()
    provided = signature.removeprefix("sha256=")
    if not hmac.compare_digest(provided, expected):
        _METRICS["signature_rejected"] += 1
        raise HTTPException(status_code=401, detail="Invalid telemetry signature")
    _NONCES[key] = now + int(os.getenv("RAILWATCH_SIGNATURE_TTL", "120"))


def make_operator_token(operator: str, role: str, tenant: str) -> str:
    secret = os.getenv("RAILWATCH_OPERATOR_SECRET") or os.getenv("RAILWATCH_INGEST_KEY", "demo-operator-secret")
    payload = {"sub": operator, "role": role, "tenant": tenant, "iat": int(time.time()), "exp": int(time.time()) + 3600}
    body = _b64encode(json.dumps(payload, separators=(",", ":")).encode())
    sig = _b64encode(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest())
    return f"RW1.{body}.{sig}"


def parse_operator_token(token: str) -> dict[str, Any]:
    secret = os.getenv("RAILWATCH_OPERATOR_SECRET") or os.getenv("RAILWATCH_INGEST_KEY", "demo-operator-secret")
    parts = token.split(".")
    if len(parts) != 3 or parts[0] != "RW1":
        raise HTTPException(status_code=401, detail="Unauthorized")
    body, provided = parts[1], parts[2]
    expected = _b64encode(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        claims = json.loads(_b64decode(body))
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Unauthorized") from exc
    if int(claims.get("exp", 0)) < int(time.time()) or claims.get("role") not in ROLES:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return claims


def install(app: Any, manager: Any, store: Any) -> None:
    import main

    original = main._store_and_broadcast

    async def enhanced(alert: Any, dedupe_key: str) -> dict[str, Any]:
        result = await original(alert, dedupe_key)
        if result.get("status") == "accepted":
            _METRICS["accepted"] += 1
            payload = main.manager.events.get(dedupe_key)
            if payload:
                incident = register_incident(payload)
                payload["operations"] = {"rules": incident["rules"], "sla": incident["sla"], "tenant": incident["tenant"]}
                _record_audit("TELEMETRY_ACCEPTED", alert.event_id, "system", incident["tenant"], {"source": "telemetry", "fingerprint": result.get("event_fingerprint")})
        else:
            _METRICS["duplicate"] += 1
        return result

    main._store_and_broadcast = enhanced

    @app.post("/api/v1/telemetry/signed-line-breach", status_code=status.HTTP_202_ACCEPTED)
    async def signed_line_breach(
        request: Request,
        x_railwatch_client: str | None = Header(default=None),
        x_railwatch_timestamp: str | None = Header(default=None),
        x_railwatch_nonce: str | None = Header(default=None),
        x_railwatch_signature: str | None = Header(default=None),
    ) -> dict[str, Any]:
        raw = await request.body()
        if not all((x_railwatch_client, x_railwatch_timestamp, x_railwatch_nonce, x_railwatch_signature)):
            raise HTTPException(status_code=401, detail="Signed telemetry headers required")
        _verify_signed_request(raw, x_railwatch_client, x_railwatch_timestamp, x_railwatch_nonce, x_railwatch_signature)
        try:
            alert = main.TelemetryBreachAlert.model_validate_json(raw)
        except Exception as exc:
            raise HTTPException(status_code=422, detail="Invalid telemetry payload") from exc
        result = await enhanced(alert, alert.event_id)
        if result.get("status") == "accepted":
            _METRICS["signed_accepted"] += 1
        return result

    @app.post("/api/v1/auth/demo-token")
    def demo_token(x_railwatch_key: str | None = Header(default=None), role: str = "controller", operator: str = "demo-controller") -> dict[str, Any]:
        expected = os.getenv("RAILWATCH_OPERATOR_BOOTSTRAP_KEY") or os.getenv("RAILWATCH_INGEST_KEY", "")
        if not expected or not hmac.compare_digest(x_railwatch_key or "", expected) or role not in ROLES:
            raise HTTPException(status_code=401, detail="Unauthorized")
        tenant = os.getenv("RAILWATCH_DEFAULT_TENANT", "NahaLabs-Demo")
        return {"token": make_operator_token(operator, role, tenant), "role": role, "tenant": tenant, "expires_in": 3600}

    def current_operator(authorization: str | None) -> dict[str, Any]:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(status_code=401, detail="Unauthorized")
        return parse_operator_token(authorization.split(" ", 1)[1].strip())

    @app.get("/api/v1/incidents/{event_id}/timeline")
    def incident_timeline(event_id: str) -> dict[str, Any]:
        incident = _INCIDENTS.get(event_id)
        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")
        return incident

    @app.get("/api/v1/incidents/{event_id}/replay")
    def incident_replay(event_id: str) -> dict[str, Any]:
        incident = _INCIDENTS.get(event_id)
        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")
        return {"event_id": event_id, "mode": "replay", "timeline": incident["timeline"], "rules": incident["rules"], "data_classification": incident["data_classification"]}

    @app.get("/api/v1/incidents/{event_id}/sla")
    def incident_sla(event_id: str) -> dict[str, Any]:
        incident = _INCIDENTS.get(event_id)
        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")
        now = time.time()
        return {"event_id": event_id, "status": incident["status"], "stage": incident["stage"], "milestones": {k: {**v, "remaining_seconds": max(0, int(v["due_at"] - now))} for k, v in incident["sla"].items()}}

    @app.post("/api/v1/incidents/{event_id}/action")
    def incident_action(
        event_id: str,
        action: str = Body(embed=True),
        note: str | None = Body(default=None, embed=True),
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        claims = current_operator(authorization)
        role = claims["role"]
        required = {"ACKNOWLEDGE": {"admin", "controller"}, "VERIFY": {"admin", "controller"}, "DISPATCH": {"admin", "controller", "dispatcher"}, "RESOLVE": {"admin", "controller", "dispatcher"}, "PROVE": {"admin", "controller", "viewer"}, "CLOSE": {"admin", "controller"}}
        if action.upper() not in required or role not in required[action.upper()]:
            raise HTTPException(status_code=403, detail="Insufficient role")
        return add_action(event_id, action, claims["sub"], claims["tenant"], note)

    @app.get("/api/v1/audit")
    def audit(limit: int = 100, authorization: str | None = Header(default=None)) -> list[dict[str, Any]]:
        claims = current_operator(authorization)
        if claims["role"] not in {"admin", "viewer", "controller"}:
            raise HTTPException(status_code=403, detail="Insufficient role")
        tenant = claims["tenant"]
        return [entry for entry in _AUDIT if entry["tenant"] == tenant][-max(1, min(limit, 500)):]

    @app.get("/api/v1/rules/evaluate/{event_id}")
    def rules(event_id: str) -> dict[str, Any]:
        incident = _INCIDENTS.get(event_id)
        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")
        return incident["rules"]

    @app.get("/api/v1/operations/health")
    def operations_health() -> dict[str, Any]:
        return {
            "status": "ok",
            "service": "railwatch-operations",
            "uptime_seconds": int(time.monotonic() - _START),
            "incidents": len(_INCIDENTS),
            "audit_entries": len(_AUDIT),
            "replay_cache_entries": len(_NONCES),
            "metrics": dict(_METRICS),
            "capabilities": {
                "signed_telemetry": True,
                "replay_protection": True,
                "rbac": True,
                "tenant_scoping": True,
                "server_audit": True,
                "incident_replay": True,
                "sla_escalation": True,
                "deterministic_rules": True,
                "redis_event_bus": bool(os.getenv("RAILWATCH_REDIS_URL")),
            },
            "data_boundary": "Demo control-room implementation; not certified rail-control software.",
        }

    @app.get("/api/v1/capabilities")
    def capabilities() -> dict[str, Any]:
        return operations_health()
