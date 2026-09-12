from __future__ import annotations

import hashlib
from datetime import timezone
from typing import Any

from fastapi import HTTPException, status

import main
from event_store import EventStore


store = EventStore()
_original_store_and_broadcast = main._store_and_broadcast


def _normalise_timestamp(value):
    timestamp = value
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    return timestamp.astimezone(timezone.utc)


async def persistent_store_and_broadcast(alert: main.TelemetryBreachAlert, dedupe_key: str) -> dict[str, Any]:
    memory_existing = main.manager.events.get(dedupe_key)
    if memory_existing:
        return {"status": "duplicate", "event_id": alert.event_id, "broadcast_connections": 0}

    durable_existing = store.exists(dedupe_key)
    if durable_existing is True:
        return {"status": "duplicate", "event_id": alert.event_id, "broadcast_connections": 0}
    if durable_existing is None and store.enabled and store.required:
        raise HTTPException(status_code=503, detail="Durable event store unavailable")

    timestamp = _normalise_timestamp(alert.timestamp)
    payload = {
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
    event_hash = hashlib.sha256(alert.event_id.encode()).hexdigest()

    inserted = store.insert(dedupe_key, alert.event_id, timestamp.isoformat(), event_hash, payload)
    if inserted is False:
        return {"status": "duplicate", "event_id": alert.event_id, "broadcast_connections": 0}
    if inserted is None and store.enabled and store.required:
        raise HTTPException(status_code=503, detail="Durable event store unavailable")

    main.manager.events[dedupe_key] = payload
    while len(main.manager.events) > main.MAX_EVENTS:
        oldest = next(iter(main.manager.events))
        main.manager.events.pop(oldest, None)

    connections = await main.manager.broadcast(payload)
    return {
        "status": "accepted",
        "event_id": alert.event_id,
        "broadcast_connections": connections,
        "event_fingerprint": event_hash[:16],
    }


async def startup_restore() -> None:
    ready = store.initialize()
    if store.enabled and not ready and store.required:
        raise RuntimeError("RailWatch durable event store is required but unavailable")
    for payload in store.recent(main.MAX_EVENTS):
        event_id = payload.get("data", {}).get("event_id")
        if event_id:
            main.manager.events[event_id] = payload


@main.app.on_event("startup")
async def _startup() -> None:
    await startup_restore()


@main.app.get("/api/v1/storage/health")
def storage_health() -> dict[str, Any]:
    return store.health()


# The original route resolves `_store_and_broadcast` in the `main` module at call time.
# Replacing the module global keeps the existing API surface while routing writes through
# the durable adapter. The original implementation remains available for fallback/debugging.
main._store_and_broadcast = persistent_store_and_broadcast
app = main.app
_original = _original_store_and_broadcast
