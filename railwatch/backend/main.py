from __future__ import annotations

import hashlib
import hmac
import os
import time
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field


class Severity(str, Enum):
    INFO = "INFO"
    WARNING = "WARNING"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class Coordinates(BaseModel):
    model_config = ConfigDict(extra="forbid")
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    elevation_m: float = Field(default=0, ge=-1000, le=10000)


class CameraPreset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pitch: float = Field(default=-45, ge=-90, le=0)
    heading: float = Field(default=0, ge=0, lt=360)
    range_meters: float = Field(default=300, gt=50, le=5000)


class TelemetryBreachAlert(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: str = Field(min_length=3, max_length=120, pattern=r"^[A-Za-z0-9._:-]+$")
    corridor_code: str = Field(min_length=2, max_length=64)
    segment_name: str = Field(min_length=2, max_length=180)
    km_marker: float = Field(ge=0, le=10000)
    coordinates: Coordinates
    alert_type: str = Field(min_length=2, max_length=80)
    severity: Severity
    sensor_id: str = Field(min_length=2, max_length=120)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    camera_preset: CameraPreset = Field(default_factory=CameraPreset)
    media_url: str | None = Field(default=None, max_length=500)


ALLOWED_ORIGINS = [x.strip() for x in os.getenv("RAILWATCH_ALLOWED_ORIGINS", "http://localhost:5173").split(",") if x.strip()]
INGEST_KEY = os.getenv("RAILWATCH_INGEST_KEY", "")
WS_KEY = os.getenv("RAILWATCH_WS_KEY", INGEST_KEY)
MAX_EVENTS = int(os.getenv("RAILWATCH_MAX_EVENTS", "2000"))

app = FastAPI(
    title="Naha RailWatch Telemetry Engine",
    version="0.1.0",
    description="Authenticated real-time rail telemetry ingestion and command-center broadcasting.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["content-type", "x-railwatch-key", "x-idempotency-key"],
)


class ConnectionManager:
    def __init__(self) -> None:
        self.active: set[WebSocket] = set()
        self.events: dict[str, dict[str, Any]] = {}

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active.add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self.active.discard(websocket)

    async def broadcast(self, payload: dict[str, Any]) -> int:
        dead: list[WebSocket] = []
        for connection in list(self.active):
            try:
                await connection.send_json(payload)
            except Exception:
                dead.append(connection)
        for connection in dead:
            self.disconnect(connection)
        return len(self.active)


manager = ConnectionManager()


def _safe_equal(provided: str | None, expected: str) -> bool:
    if not provided or not expected:
        return False
    return hmac.compare_digest(provided.encode(), expected.encode())


def require_ingest_key(x_railwatch_key: str | None = Header(default=None)) -> None:
    if not _safe_equal(x_railwatch_key, INGEST_KEY):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


def require_ws_key(websocket: WebSocket) -> None:
    provided = websocket.query_params.get("token")
    if not _safe_equal(provided, WS_KEY):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "railwatch-telemetry",
        "connections": len(manager.active),
        "events": len(manager.events),
    }


@app.get("/api/v1/events")
def recent_events(limit: int = 100) -> list[dict[str, Any]]:
    limit = max(1, min(limit, 500))
    return list(manager.events.values())[-limit:]


@app.websocket("/ws/v1/c2-stream")
async def c2_stream(websocket: WebSocket) -> None:
    token = websocket.query_params.get("token")
    if not _safe_equal(token, WS_KEY):
        await websocket.close(code=1008)
        return
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


@app.post("/api/v1/telemetry/line-breach", status_code=status.HTTP_202_ACCEPTED)
async def ingest_line_breach(
    alert: TelemetryBreachAlert,
    _: None = Depends(require_ingest_key),
    x_idempotency_key: str | None = Header(default=None),
) -> dict[str, Any]:
    dedupe_key = x_idempotency_key or alert.event_id
    existing = manager.events.get(dedupe_key)
    if existing:
        return {"status": "duplicate", "event_id": alert.event_id}

    timestamp = alert.timestamp
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    timestamp = timestamp.astimezone(timezone.utc)

    payload = {
        "action": "TRIGGER_ALARM",
        "schema_version": "1.0",
        "data": {
            "event_id": alert.event_id,
            "corridor": alert.corridor_code,
            "segment": alert.segment_name,
            "km_marker": alert.km_marker,
            "location": [alert.coordinates.latitude, alert.coordinates.longitude],
            "elevation_m": alert.coordinates.elevation_m,
            "alert_type": alert.alert_type,
            "severity": alert.severity,
            "sensor_id": alert.sensor_id,
            "target_label": f"{alert.severity}: {alert.segment_name} · KM {alert.km_marker:.1f}",
            "camera_preset": alert.camera_preset.model_dump(),
            "media_url": alert.media_url,
            "timestamp": timestamp.isoformat(),
        },
    }

    manager.events[dedupe_key] = payload
    if len(manager.events) > MAX_EVENTS:
        oldest = next(iter(manager.events))
        manager.events.pop(oldest, None)

    connections = await manager.broadcast(payload)
    event_hash = hashlib.sha256(alert.event_id.encode()).hexdigest()[:16]
    return {
        "status": "accepted",
        "event_id": alert.event_id,
        "broadcast_connections": connections,
        "event_fingerprint": event_hash,
    }


# Keep this process-level limiter intentionally small and replace it with Redis
# or an API gateway before production deployment.
_rate_window_started = time.monotonic()
_rate_count = 0
RATE_LIMIT = int(os.getenv("RAILWATCH_RATE_LIMIT_PER_MIN", "120"))


def rate_guard() -> None:
    global _rate_window_started, _rate_count
    now = time.monotonic()
    if now - _rate_window_started >= 60:
        _rate_window_started, _rate_count = now, 0
    _rate_count += 1
    if _rate_count > RATE_LIMIT:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
