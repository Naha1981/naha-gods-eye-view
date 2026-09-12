from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from fastapi import Body, Header, HTTPException, Request, status


_METADATA_KEYS = {
    "source",
    "source_system",
    "protocol",
    "protocol_version",
    "device_id",
    "source_id",
    "gateway",
    "protocol_metadata",
}
_METADATA_MAX_BYTES = 12000


def _unwrap(body: dict[str, Any]) -> dict[str, Any]:
    for key in ("data", "payload", "event"):
        value = body.get(key)
        if isinstance(value, dict):
            merged = dict(value)
            for outer_key in ("event_id", "source", "source_system", "tenant"):
                if outer_key in body and outer_key not in merged:
                    merged[outer_key] = body[outer_key]
            return merged
    return body


def _first(data: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        value = data.get(key)
        if value not in (None, ""):
            return value
    return default


def _bounded_metadata(data: dict[str, Any]) -> dict[str, Any]:
    candidate = {key: data[key] for key in _METADATA_KEYS if key in data}
    if not candidate:
        return {}
    try:
        encoded = json.dumps(candidate, ensure_ascii=False, separators=(",", ":"), default=str)
    except (TypeError, ValueError):
        return {"metadata_error": "unserializable integration metadata"}
    if len(encoded.encode("utf-8")) <= _METADATA_MAX_BYTES:
        return candidate
    # Preserve the integration identity and discard oversized nested evidence rather
    # than allowing a malformed/external source to bloat the durable event payload.
    reduced: dict[str, Any] = {}
    for key in ("source", "source_system", "protocol", "protocol_version", "device_id", "source_id"):
        if key in candidate:
            reduced[key] = str(candidate[key])[:500]
    reduced["metadata_truncated"] = True
    return reduced


def _coordinates(data: dict[str, Any]) -> tuple[float, float, float]:
    raw = _first(data, "coordinates", "position", "location", default=None)
    if isinstance(raw, dict):
        latitude = _first(raw, "latitude", "lat", "y")
        longitude = _first(raw, "longitude", "lon", "lng", "x")
        elevation = _first(raw, "elevation_m", "elevation", "altitude", "alt", default=0)
    elif isinstance(raw, (list, tuple)) and len(raw) >= 2:
        latitude, longitude = raw[0], raw[1]
        elevation = raw[2] if len(raw) > 2 else 0
    else:
        latitude = _first(data, "latitude", "lat", "y")
        longitude = _first(data, "longitude", "lon", "lng", "x")
        elevation = _first(data, "elevation_m", "elevation", "altitude", "alt", default=0)

    if latitude is None or longitude is None:
        raise HTTPException(status_code=422, detail="Telemetry requires latitude/longitude coordinates")
    try:
        return float(latitude), float(longitude), float(elevation or 0)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Telemetry coordinates must be numeric") from exc


def _timestamp(value: Any) -> datetime:
    if value in (None, ""):
        return datetime.now(timezone.utc)
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip()
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Telemetry timestamp must be ISO-8601") from exc
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _build_alert(body: dict[str, Any], main: Any):
    data = _unwrap(body)
    latitude, longitude, elevation = _coordinates(data)
    event_id = str(_first(data, "event_id", "id", "eventId", "message_id", "messageId", default=""))
    if not event_id:
        raise HTTPException(status_code=422, detail="Telemetry requires event_id (or id/message_id)")

    severity = str(_first(data, "severity", "priority", "alarm_level", "alarmLevel", default="INFO")).upper()
    if severity not in {"INFO", "WARNING", "HIGH", "CRITICAL"}:
        severity = "INFO"

    alert_type = str(_first(data, "alert_type", "alertType", "event_type", "eventType", "type", default="TELEMETRY_EVENT"))
    corridor = str(_first(data, "corridor_code", "corridor", "corridorCode", "route", default="EXTERNAL"))
    segment = str(_first(data, "segment_name", "segment", "section", "location_name", "locationName", default="External telemetry sector"))
    sensor_id = str(_first(data, "sensor_id", "sensorId", "device_id", "deviceId", "source_id", "sourceId", default="EXTERNAL-SENSOR"))

    km_marker_raw = _first(data, "km_marker", "km", "kilometre", "kilometer", "chainage", default=0)
    try:
        km_marker = max(0.0, float(km_marker_raw or 0))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Telemetry km_marker must be numeric") from exc

    location_name = str(_first(data, "location_name", "locationName", "site_name", "siteName", default=segment))
    operational_impact = str(_first(data, "operational_impact", "impact", "description", "message", default="External telemetry event received"))
    recommended_action = str(_first(data, "recommended_action", "recommendedAction", "action", default="Verify event with the responsible operations team"))
    condition = str(_first(data, "asset_condition", "condition", "status", default="External telemetry state reported"))
    data_classification = str(_first(data, "data_classification", "classification", default="INTEGRATED · EXTERNAL TELEMETRY"))
    source_system = str(_first(data, "source_system", "sourceSystem", "source", default="external"))
    media_url = _first(data, "media_url", "mediaUrl", "cctv_url", "cctvUrl", default=None)

    incident = main.IncidentContext(
        location_name=location_name,
        asset_type=str(_first(data, "asset_type", "assetType", default="External rail asset")),
        asset_condition=condition,
        operational_impact=f"[{source_system}] {operational_impact}"[:240],
        recommended_action=recommended_action[:240],
        data_classification=data_classification[:120],
        assets=[],
    )
    return main.TelemetryBreachAlert(
        event_id=event_id,
        corridor_code=corridor[:64] or "EXTERNAL",
        segment_name=segment[:180] or "External telemetry sector",
        km_marker=min(km_marker, 10000),
        coordinates=main.Coordinates(latitude=latitude, longitude=longitude, elevation_m=max(-1000, min(elevation, 10000))),
        alert_type=alert_type[:80] or "TELEMETRY_EVENT",
        severity=severity,
        sensor_id=sensor_id[:120] or "EXTERNAL-SENSOR",
        timestamp=_timestamp(_first(data, "timestamp", "occurred_at", "occurredAt", "time", "event_time", "eventTime")),
        camera_preset=main.CameraPreset(),
        media_url=str(media_url)[:500] if media_url else None,
        incident=incident,
        integration_metadata=_bounded_metadata(data),
    )


def install(app: Any, manager: Any = None, store: Any = None) -> None:
    import main
    from operations import _verify_signed_request, _METRICS

    if getattr(app.state, "railwatch_generic_telemetry_installed", False):
        return
    app.state.railwatch_generic_telemetry_installed = True

    @app.post("/api/v1/telemetry/ingest", status_code=status.HTTP_202_ACCEPTED)
    async def generic_telemetry_ingest(
        body: dict[str, Any] = Body(...),
        x_railwatch_key: str | None = Header(default=None),
        x_idempotency_key: str | None = Header(default=None),
    ) -> dict[str, Any]:
        main.require_ingest_key(x_railwatch_key)
        alert = _build_alert(body, main)
        return await main._store_and_broadcast(alert, x_idempotency_key or alert.event_id)

    @app.post("/api/v1/telemetry/signed-ingest", status_code=status.HTTP_202_ACCEPTED)
    async def signed_generic_telemetry_ingest(
        request: Request,
        x_railwatch_client: str | None = Header(default=None),
        x_railwatch_timestamp: str | None = Header(default=None),
        x_railwatch_nonce: str | None = Header(default=None),
        x_railwatch_signature: str | None = Header(default=None),
        x_idempotency_key: str | None = Header(default=None),
    ) -> dict[str, Any]:
        raw = await request.body()
        if not all((x_railwatch_client, x_railwatch_timestamp, x_railwatch_nonce, x_railwatch_signature)):
            raise HTTPException(status_code=401, detail="Signed telemetry headers required")
        _verify_signed_request(raw, x_railwatch_client, x_railwatch_timestamp, x_railwatch_nonce, x_railwatch_signature)
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            raise HTTPException(status_code=422, detail="Telemetry body must be valid JSON") from exc
        if not isinstance(body, dict):
            raise HTTPException(status_code=422, detail="Telemetry body must be a JSON object")
        alert = _build_alert(body, main)
        result = await main._store_and_broadcast(alert, x_idempotency_key or alert.event_id)
        if result.get("status") == "accepted":
            _METRICS["signed_accepted"] += 1
        return result

    @app.get("/api/v1/telemetry/integration-info")
    def integration_info() -> dict[str, Any]:
        return {
            "status": "ready",
            "adapter": "railwatch-generic-telemetry-v1",
            "endpoints": {
                "ingest": "/api/v1/telemetry/ingest",
                "signed_ingest": "/api/v1/telemetry/signed-ingest",
                "line_breach": "/api/v1/telemetry/line-breach",
            },
            "accepted_aliases": [
                "event_id/id/message_id",
                "latitude/lat + longitude/lon/lng",
                "corridor_code/corridor/route",
                "segment_name/segment/section",
                "sensor_id/device_id/source_id",
                "alert_type/event_type/type",
                "severity/priority/alarm_level",
                "km_marker/km/chainage",
                "timestamp/occurred_at/event_time",
            ],
            "auth": [
                "x-railwatch-key + optional x-idempotency-key",
                "HMAC headers for signed-ingest",
            ],
            "notes": "Adapter normalizes external telemetry into the RailWatch incident contract; bounded integration_metadata preserves source/protocol evidence without allowing oversized external payloads.",
        }
