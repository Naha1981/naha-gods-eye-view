from __future__ import annotations

import base64
import binascii
from datetime import datetime, timezone
from typing import Any

from fastapi import Body, Header, HTTPException, status


# Historical values from the supplied BBC 4204 summary. These are deliberately
# exposed as decoder metadata, not live network connection instructions.
MESSAGE_TYPES = {
    0x01: "LOCOMOTIVE_STATUS",
    0x02: "SERVICE_AVAILABILITY",
    0x03: "GPS_RMC",
    0x04: "GPS_GGA",
    0x05: "GPS_VTG",
    0x06: "TRITON_TRACK_TRACE",
    0x07: "TRITON_SOFTWARE_VERSION",
    0x08: "TRITON_HARDWARE_VERSION",
    0x0C: "TRAIN_DEFINITION_UNIT",
    0xFE: "POLL_REQUEST",
    0xFF: "OPEN_FORMAT_BROADCAST",
}


def crc_ccitt(data: bytes, initial: int = 0xFFFF) -> int:
    """CRC-CCITT using the documented 0x1021 polynomial."""
    crc = initial
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def decode_nmea_latlon(value: str, hemisphere: str) -> float:
    """Decode ddmm.mmmm / dddmm.mmmm NMEA coordinates to decimal degrees."""
    numeric = float(value)
    degrees = int(numeric // 100)
    minutes = numeric - (degrees * 100)
    result = degrees + minutes / 60.0
    if hemisphere.upper() in {"S", "W"}:
        result = -result
    return result


def parse_rmc(sentence: str) -> dict[str, Any] | None:
    fields = sentence.strip().split(",")
    if not fields or fields[0] not in {"$GPRMC", "$GNRMC"} or len(fields) < 10:
        return None
    if fields[2].upper() != "A":
        return None
    try:
        latitude = decode_nmea_latlon(fields[3], fields[4])
        longitude = decode_nmea_latlon(fields[5], fields[6])
        speed_knots = float(fields[7] or 0)
        course = float(fields[8] or 0)
    except (ValueError, IndexError):
        return None
    timestamp = None
    if len(fields) > 9 and fields[1] and fields[9]:
        try:
            day = int(fields[9][0:2])
            month = int(fields[9][2:4])
            year = 2000 + int(fields[9][4:6])
            hh = int(fields[1][0:2])
            mm = int(fields[1][2:4])
            ss = int(float(fields[1][4:]))
            timestamp = datetime(year, month, day, hh, mm, ss, tzinfo=timezone.utc)
        except (ValueError, IndexError):
            timestamp = None
    return {
        "latitude": latitude,
        "longitude": longitude,
        "speed_knots": speed_knots,
        "speed_kph": speed_knots * 1.852,
        "course_true": course,
        "timestamp": timestamp.isoformat() if timestamp else None,
        "sentence_type": fields[0],
    }


def parse_gga(sentence: str) -> dict[str, Any] | None:
    fields = sentence.strip().split(",")
    if not fields or fields[0] not in {"$GPGGA", "$GNGGA"} or len(fields) < 10:
        return None
    try:
        latitude = decode_nmea_latlon(fields[2], fields[3])
        longitude = decode_nmea_latlon(fields[4], fields[5])
        quality = int(fields[6] or 0)
        satellites = int(fields[7] or 0)
        hdop = float(fields[8] or 0)
        altitude = float(fields[9] or 0)
    except (ValueError, IndexError):
        return None
    return {
        "latitude": latitude,
        "longitude": longitude,
        "gps_quality": quality,
        "satellites": satellites,
        "hdop": hdop,
        "altitude_m": altitude,
        "sentence_type": fields[0],
    }


def parse_vtg(sentence: str) -> dict[str, Any] | None:
    fields = sentence.strip().split(",")
    if not fields or fields[0] not in {"$GPVTG", "$GNVTG"} or len(fields) < 9:
        return None
    try:
        course = float(fields[1] or 0)
        speed_knots = float(fields[5] or 0)
        speed_kph = float(fields[7] or 0)
    except (ValueError, IndexError):
        return None
    return {"course_true": course, "speed_knots": speed_knots, "speed_kph": speed_kph, "sentence_type": fields[0]}


def parse_nmea_body(body: bytes | str) -> dict[str, Any]:
    text = body.decode("ascii", errors="replace") if isinstance(body, bytes) else body
    sentences = [line.strip() for line in text.replace("\r", "\n").split("\n") if line.strip()]
    result: dict[str, Any] = {"sentences": [], "gps": {}}
    for sentence in sentences:
        parsed = parse_rmc(sentence) or parse_gga(sentence) or parse_vtg(sentence)
        result["sentences"].append({"raw": sentence[:1000], "parsed": parsed, "supported": parsed is not None})
        if parsed:
            result["gps"].update({k: v for k, v in parsed.items() if k != "sentence_type" and v is not None})
    return result


def parse_telegram(raw: bytes) -> dict[str, Any]:
    if len(raw) < 12:
        raise ValueError("TRITON telegram must contain a 10-byte header and 2-byte CRC")
    received_crc = int.from_bytes(raw[-2:], "little")
    calculated_crc = crc_ccitt(raw[:-2])
    header = raw[:10]
    body = raw[10:-2]
    telegram_type = header[0]
    serial_number = int.from_bytes(header[1:4], "little")
    sequence_number = header[4]
    message_type = header[5]
    host_id = header[6]
    port_id = int.from_bytes(header[7:9], "little")
    gmi = header[9]
    return {
        "valid_crc": received_crc == calculated_crc,
        "received_crc": f"0x{received_crc:04X}",
        "calculated_crc": f"0x{calculated_crc:04X}",
        "telegram_type": telegram_type,
        "serial_number": serial_number,
        "sequence_number": sequence_number,
        "message_type": message_type,
        "message_name": MESSAGE_TYPES.get(message_type, "UNKNOWN"),
        "host_id": host_id,
        "port_id": port_id,
        "gateway_message_identifier": gmi,
        "locomotive_number_in_body": gmi == 1,
        "body_length": len(body),
        "body_text": body.decode("ascii", errors="replace")[:4000],
        "body_hex": body.hex()[:8000],
        "nmea": parse_nmea_body(body),
    }


def _decode_payload(value: str, encoding: str) -> bytes:
    encoding = encoding.lower().strip()
    if encoding == "hex":
        try:
            return bytes.fromhex(value)
        except ValueError as exc:
            raise ValueError("Invalid hexadecimal telegram") from exc
    if encoding == "base64":
        try:
            return base64.b64decode(value, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise ValueError("Invalid base64 telegram") from exc
    raise ValueError("encoding must be 'hex' or 'base64'")


def _normalise_triton_event(decoded: dict[str, Any], *, source_system: str, event_id: str | None, corridor: str, segment: str) -> dict[str, Any]:
    gps = decoded["nmea"].get("gps", {})
    event_id = event_id or f"TRITON-{decoded['serial_number']}-{decoded['sequence_number']}"
    alert_type = decoded["message_name"]
    # Historical protocol parsing is intentionally conservative: only fields
    # actually present in a documented NMEA sentence are promoted to telemetry.
    severity = "WARNING" if decoded["message_type"] in {0x03, 0x04, 0x05, 0x06} else "INFO"
    return {
        "event_id": event_id,
        "source_system": source_system,
        "corridor": corridor,
        "segment": segment,
        "latitude": gps.get("latitude"),
        "longitude": gps.get("longitude"),
        "altitude_m": gps.get("altitude_m", 0),
        "speed_knots": gps.get("speed_knots"),
        "speed_kph": gps.get("speed_kph"),
        "course_true": gps.get("course_true"),
        "severity": severity,
        "alert_type": alert_type,
        "sensor_id": f"TRITON-{decoded['serial_number']}",
        "timestamp": gps.get("timestamp") or datetime.now(timezone.utc).isoformat(),
        "protocol": "TRITON-LEGACY",
        "protocol_metadata": decoded,
    }


def install(app: Any, manager: Any = None, store: Any = None) -> None:
    if getattr(app.state, "railwatch_triton_legacy_installed", False):
        return
    app.state.railwatch_triton_legacy_installed = True

    @app.post("/api/v1/telemetry/triton/telegram", status_code=status.HTTP_202_ACCEPTED)
    async def triton_telegram_ingest(
        body: dict[str, Any] = Body(...),
        x_railwatch_key: str | None = Header(default=None),
        x_idempotency_key: str | None = Header(default=None),
    ) -> dict[str, Any]:
        import main

        main.require_ingest_key(x_railwatch_key)
        value = str(body.get("telegram", ""))
        if not value:
            raise HTTPException(status_code=422, detail="TRITON telegram field is required")
        try:
            raw = _decode_payload(value, str(body.get("encoding", "base64")))
            decoded = parse_telegram(raw)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if not decoded["valid_crc"]:
            raise HTTPException(status_code=422, detail="TRITON CRC validation failed")
        event = _normalise_triton_event(
            decoded,
            source_system=str(body.get("source_system", "TRITON")),
            event_id=str(body.get("event_id")) if body.get("event_id") else None,
            corridor=str(body.get("corridor", "EXTERNAL")),
            segment=str(body.get("segment", "External TRITON sector")),
        )
        if event["latitude"] is None or event["longitude"] is None:
            return {"status": "decoded", "ingested": False, "reason": "No supported GPS coordinates in telegram", "triton": decoded}
        alert_body = {
            "event_id": event["event_id"],
            "corridor": event["corridor"],
            "section": event["segment"],
            "lat": event["latitude"],
            "lon": event["longitude"],
            "km": body.get("km", 0),
            "type": event["alert_type"],
            "priority": event["severity"],
            "device_id": event["sensor_id"],
            "occurred_at": event["timestamp"],
            "source_system": event["source_system"],
            "description": f"Decoded {event['alert_type']} from historical TRITON telegram",
            "protocol": "TRITON-LEGACY",
            "protocol_metadata": decoded,
            "gateway": {
                "ingest": "https",
                "raw_telegram_base64": base64.b64encode(raw).decode("ascii"),
            },
        }
        from generic_telemetry import _build_alert
        alert = _build_alert(alert_body, main)
        result = await main._store_and_broadcast(alert, x_idempotency_key or alert.event_id)
        if result.get("status") == "accepted":
            result["triton"] = {"message_name": decoded["message_name"], "serial_number": decoded["serial_number"], "sequence_number": decoded["sequence_number"]}
        return result

    @app.post("/api/v1/telemetry/triton/nmea", status_code=status.HTTP_202_ACCEPTED)
    async def triton_nmea_ingest(
        body: dict[str, Any] = Body(...),
        x_railwatch_key: str | None = Header(default=None),
        x_idempotency_key: str | None = Header(default=None),
    ) -> dict[str, Any]:
        import main

        main.require_ingest_key(x_railwatch_key)
        text = str(body.get("nmea", ""))
        if not text:
            raise HTTPException(status_code=422, detail="TRITON NMEA field is required")
        decoded = parse_nmea_body(text)
        gps = decoded["gps"]
        if gps.get("latitude") is None or gps.get("longitude") is None:
            return {"status": "decoded", "ingested": False, "reason": "No supported GPS coordinates in NMEA", "triton": decoded}
        alert_body = {
            "event_id": str(body.get("event_id") or f"TRITON-NMEA-{int(datetime.now(timezone.utc).timestamp() * 1000)}"),
            "corridor": str(body.get("corridor", "EXTERNAL")),
            "section": str(body.get("segment", "External TRITON NMEA sector")),
            "lat": gps["latitude"],
            "lon": gps["longitude"],
            "km": body.get("km", 0),
            "type": str(body.get("alert_type", "GPS_NMEA")),
            "priority": str(body.get("severity", "INFO")),
            "device_id": str(body.get("sensor_id", "TRITON-NMEA")),
            "occurred_at": gps.get("timestamp") or datetime.now(timezone.utc).isoformat(),
            "source_system": str(body.get("source_system", "TRITON")),
            "description": "Decoded NMEA telemetry from historical TRITON integration",
            "protocol": "TRITON-NMEA",
            "protocol_metadata": decoded,
        }
        from generic_telemetry import _build_alert
        alert = _build_alert(alert_body, main)
        return await main._store_and_broadcast(alert, x_idempotency_key or alert.event_id)

    @app.get("/api/v1/telemetry/triton/info")
    def triton_info() -> dict[str, Any]:
        return {
            "status": "ready",
            "adapter": "railwatch-triton-legacy-decoder-v1",
            "historical": True,
            "message_types": {f"0x{k:02X}": v for k, v in MESSAGE_TYPES.items()},
            "nmea": ["GPRMC", "GNRMC", "GPGGA", "GNGGA", "GPVTG", "GNVTG"],
            "crc": "CRC-CCITT polynomial 0x1021; the current decoder interprets the received CRC bytes as little-endian",
            "network_note": "Historical TRITON addresses/ports are not treated as current connection instructions. Obtain the current interface-control document, approved network path, security requirements and test messages before connecting a live source.",
        }
