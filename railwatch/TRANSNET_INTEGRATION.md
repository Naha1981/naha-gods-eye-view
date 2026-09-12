# RailWatch live telemetry integration handoff

RailWatch is demo software, but the ingestion boundary is designed so an external rail system can connect without changing the command-center UI.

## Fastest connection

Send a JSON object to:

`POST /api/v1/telemetry/ingest`

Required header:

`x-railwatch-key: <integration key>`

Optional header:

`x-idempotency-key: <stable unique event key>`

The adapter accepts common field names and normalizes them into the RailWatch incident contract.

## Accepted common field names

- Event ID: `event_id`, `id`, `eventId`, `message_id`, `messageId`
- Latitude: `latitude`, `lat`, `y`
- Longitude: `longitude`, `lon`, `lng`, `x`
- Corridor: `corridor_code`, `corridor`, `corridorCode`, `route`
- Section: `segment_name`, `segment`, `section`, `location_name`, `locationName`
- Kilometre: `km_marker`, `km`, `kilometre`, `kilometer`, `chainage`
- Alert type: `alert_type`, `alertType`, `event_type`, `eventType`, `type`
- Severity: `severity`, `priority`, `alarm_level`, `alarmLevel`
- Sensor/device: `sensor_id`, `sensorId`, `device_id`, `deviceId`, `source_id`, `sourceId`
- Time: `timestamp`, `occurred_at`, `occurredAt`, `time`, `event_time`, `eventTime`
- Optional media: `media_url`, `mediaUrl`, `cctv_url`, `cctvUrl`

The adapter also accepts an object nested under `data`, `payload`, or `event`.

## Example payload

```json
{
  "event_id": "TRANSNET-EXAMPLE-001",
  "corridor": "COAL",
  "section": "Example section",
  "km": 142.8,
  "latitude": -26.5225,
  "longitude": 29.9811,
  "alert_type": "LINE_BREACH",
  "severity": "CRITICAL",
  "sensor_id": "FIELD-SENSOR-17",
  "timestamp": "2026-09-12T11:15:00Z",
  "description": "Example external alarm"
}
```

## Signed connection

For system-to-system production-style integration, use:

`POST /api/v1/telemetry/signed-ingest`

with these headers:

- `x-railwatch-client`
- `x-railwatch-timestamp` (Unix seconds)
- `x-railwatch-nonce` (unique per request)
- `x-railwatch-signature`

Signature input is:

`HMAC-SHA256(secret, timestamp + "." + nonce + "." + raw_request_body)`

The server rejects an unknown client, expired timestamp, invalid signature, and nonce replay.

## Integration discovery

`GET /api/v1/telemetry/integration-info` returns the adapter status, endpoints, supported field aliases, and authentication modes.

## Important boundary

The adapter is intentionally generic. It does not guess Transnet's authoritative asset IDs, GIS geometry, signalling semantics, or operational permissions. During a technical demo, the integration team can map their existing event stream into this boundary immediately; authoritative production mappings should then be agreed with the relevant Transnet system owners.

RailWatch must remain labelled as a prototype/demo and must not be used as a certified signalling or train-control system.
