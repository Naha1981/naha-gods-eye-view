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

from event_store import EventStore


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


class IncidentAsset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    asset_id: str = Field(min_length=2, max_length=80)
    asset_type: str = Field(min_length=2, max_length=80)
    name: str = Field(min_length=2, max_length=160)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    status: str = Field(min_length=2, max_length=50)
    condition: str = Field(min_length=2, max_length=180)
    distance_km: float = Field(ge=0, le=1000)


class IncidentContext(BaseModel):
    model_config = ConfigDict(extra="forbid")
    location_name: str = Field(min_length=2, max_length=180)
    asset_type: str = Field(min_length=2, max_length=120)
    asset_condition: str = Field(min_length=2, max_length=160)
    operational_impact: str = Field(min_length=2, max_length=240)
    recommended_action: str = Field(min_length=2, max_length=240)
    assets: list[IncidentAsset] = Field(default_factory=list)
    data_classification: str = Field(default="DEMO · NOT AUTHORITATIVE GIS", max_length=120)


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
    incident: IncidentContext | None = None


ALLOWED_ORIGINS_RAW = os.getenv("RAILWATCH_ALLOWED_ORIGINS", "http://localhost:5173")
ALLOW_ALL_ORIGINS = ALLOWED_ORIGINS_RAW.strip() == "*"
ALLOWED_ORIGINS = [x.strip() for x in ALLOWED_ORIGINS_RAW.split(",") if x.strip() and x.strip() != "*"]
INGEST_KEY = os.getenv("RAILWATCH_INGEST_KEY", "")
WS_KEY = os.getenv("RAILWATCH_WS_KEY", INGEST_KEY)
DEMO_MODE = os.getenv("RAILWATCH_DEMO_MODE", "false").lower() in {"1", "true", "yes", "on"}
MAX_EVENTS = int(os.getenv("RAILWATCH_MAX_EVENTS", "2000"))
BUILD_SHA = os.getenv("RENDER_GIT_COMMIT") or os.getenv("RAILWATCH_BUILD_SHA") or "local"
BUILD_BRANCH = os.getenv("RENDER_GIT_BRANCH") or os.getenv("RAILWATCH_BUILD_BRANCH") or "local"
INSTANCE_ID = os.getenv("RENDER_INSTANCE_ID") or "local"
STARTED_AT = datetime.now(timezone.utc)

app = FastAPI(
    title="Naha RailWatch Telemetry Engine",
    version="0.4.0",
    description="Authenticated real-time rail telemetry ingestion and command-center broadcasting.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if ALLOW_ALL_ORIGINS else ALLOWED_ORIGINS,
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
store = EventStore()


def _safe_equal(provided: str | None, expected: str) -> bool:
    if not provided or not expected:
        return False
    return hmac.compare_digest(provided.encode(), expected.encode())


def require_ingest_key(x_railwatch_key: str | None = Header(default=None)) -> None:
    if not _safe_equal(x_railwatch_key, INGEST_KEY):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


def _normalise_timestamp(value: datetime) -> datetime:
    timestamp = value
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    return timestamp.astimezone(timezone.utc)


def _build_payload(alert: TelemetryBreachAlert) -> dict[str, Any]:
    timestamp = _normalise_timestamp(alert.timestamp)
    return {
        "action": "TRIGGER_ALARM",
        "schema_version": "1.2",
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
            "incident": alert.incident.model_dump() if alert.incident else None,
            "timestamp": timestamp.isoformat(),
        },
    }


async def _store_and_broadcast(alert: TelemetryBreachAlert, dedupe_key: str) -> dict[str, Any]:
    if manager.events.get(dedupe_key):
        return {"status": "duplicate", "event_id": alert.event_id, "broadcast_connections": 0}

    durable_existing = store.exists(dedupe_key)
    if durable_existing is True:
        return {"status": "duplicate", "event_id": alert.event_id, "broadcast_connections": 0}
    if durable_existing is None and store.enabled and store.required:
        raise HTTPException(status_code=503, detail="Durable event store unavailable")

    payload = _build_payload(alert)
    event_hash = hashlib.sha256(alert.event_id.encode()).hexdigest()
    timestamp = _normalise_timestamp(alert.timestamp)

    inserted = store.insert(dedupe_key, alert.event_id, timestamp.isoformat(), event_hash, payload)
    if inserted is False:
        return {"status": "duplicate", "event_id": alert.event_id, "broadcast_connections": 0}
    if inserted is None and store.enabled and store.required:
        raise HTTPException(status_code=503, detail="Durable event store unavailable")

    manager.events[dedupe_key] = payload
    while len(manager.events) > MAX_EVENTS:
        oldest = next(iter(manager.events))
        manager.events.pop(oldest, None)

    connections = await manager.broadcast(payload)
    return {
        "status": "accepted",
        "event_id": alert.event_id,
        "broadcast_connections": connections,
        "event_fingerprint": event_hash[:16],
    }


@app.on_event("startup")
async def restore_events() -> None:
    ready = store.initialize()
    if store.enabled and not ready and store.required:
        raise RuntimeError("RailWatch durable event store is required but unavailable")
    for payload in store.recent(MAX_EVENTS):
        event_id = payload.get("data", {}).get("event_id")
        if event_id:
            manager.events[event_id] = payload


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "railwatch-telemetry",
        "connections": len(manager.active),
        "events": len(manager.events),
        "demo_mode": DEMO_MODE,
        "build": {
            "commit": BUILD_SHA,
            "branch": BUILD_BRANCH,
            "instance": INSTANCE_ID,
            "started_at": STARTED_AT.isoformat(),
        },
        "storage": store.health(),
    }


@app.get("/api/v1/storage/health")
def storage_health() -> dict[str, Any]:
    return store.health()


@app.get("/api/v1/events")
def recent_events(limit: int = 100) -> list[dict[str, Any]]:
    limit = max(1, min(limit, 500))
    return list(manager.events.values())[-limit:]


@app.websocket("/ws/v1/c2-stream")
async def c2_stream(websocket: WebSocket) -> None:
    token = websocket.query_params.get("token")
    if not DEMO_MODE and not _safe_equal(token, WS_KEY):
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
    return await _store_and_broadcast(alert, x_idempotency_key or alert.event_id)


_rate_window_started = time.monotonic()
_rate_count = 0
RATE_LIMIT = int(os.getenv("RAILWATCH_DEMO_RATE_LIMIT_PER_MIN", "30"))


def demo_rate_guard() -> None:
    global _rate_window_started, _rate_count
    now = time.monotonic()
    if now - _rate_window_started >= 60:
        _rate_window_started, _rate_count = now, 0
    _rate_count += 1
    if _rate_count > RATE_LIMIT:
        raise HTTPException(status_code=429, detail="Demo rate limit exceeded")


@app.post("/api/v1/demo/line-breach", status_code=status.HTTP_202_ACCEPTED)
async def demo_line_breach(_: None = Depends(demo_rate_guard)) -> dict[str, Any]:
    if not DEMO_MODE:
        raise HTTPException(status_code=404, detail="Demo mode disabled")

    # These are deliberately labelled demo assets. They are placeholders for later
    # integration with authoritative GIS / Transnet infrastructure datasets.
    lat = -26.5225
    lon = 29.9811
    demo_assets = [
        IncidentAsset(
            asset_id="DEMO-SIG-0142",
            asset_type="SIGNALLING",
            name="Demo block signal / control point",
            latitude=lat + 0.0020,
            longitude=lon - 0.0030,
            status="ALERT",
            condition="Potential interference / inspection required",
            distance_km=0.39,
        ),
        IncidentAsset(
            asset_id="DEMO-PT-0142",
            asset_type="TRACK ASSET",
            name="Demo turnout / permanent-way section",
            latitude=lat - 0.0014,
            longitude=lon + 0.0024,
            status="MONITOR",
            condition="Within incident zone; field verification required",
            distance_km=0.30,
        ),
        IncidentAsset(
            asset_id="DEMO-TRL-0142",
            asset_type="TELECOMMUNICATIONS",
            name="Demo wayside telemetry cabinet",
            latitude=lat + 0.0008,
            longitude=lon + 0.0037,
            status="UNKNOWN",
            condition="No current health confirmation",
            distance_km=0.41,
        ),
    ]

    alert = TelemetryBreachAlert(
        event_id=f"DEMO-{int(time.time() * 1000)}",
        corridor_code="TFR-COAL-DEMO",
        segment_name="Ermelo · Richards Bay demonstration sector",
        km_marker=142.8,
        coordinates=Coordinates(latitude=lat, longitude=lon, elevation_m=1600),
        alert_type="LINE_BREACH",
        severity=Severity.CRITICAL,
        sensor_id="DEMO-SENSOR-01",
        timestamp=datetime.now(timezone.utc),
        camera_preset=CameraPreset(pitch=-48, heading=35, range_meters=420),
        incident=IncidentContext(
            location_name="Ermelo–Richards Bay Coal Line · Demo Sector",
            asset_type="Rail infrastructure / wayside equipment",
            asset_condition="Possible tampering or physical damage detected",
            operational_impact="Potential line interruption; train movement should be verified before dispatch",
            recommended_action="Dispatch nearest response team and verify track status via field crew / CCTV",
            assets=demo_assets,
        ),
    )
    return await _store_and_broadcast(alert, alert.event_id)
