# RailWatch live-data integration handoff

## What can connect immediately

RailWatch has a normalized telemetry boundary at:

- `POST /api/v1/telemetry/ingest` for JSON telemetry authenticated with `x-railwatch-key`.
- `POST /api/v1/telemetry/signed-ingest` for HMAC-signed JSON telemetry with timestamp and nonce replay protection.
- `POST /api/v1/telemetry/triton/telegram` for a historical TRITON telegram supplied as base64 or hexadecimal.
- `POST /api/v1/telemetry/triton/nmea` for supported NMEA GPS sentences.
- `GET /api/v1/telemetry/integration-info` for the generic adapter contract.
- `GET /api/v1/telemetry/triton/info` for the TRITON decoder capabilities.

## Common field mapping

The generic adapter accepts common aliases for event ID, coordinates, corridor, section, device/sensor identity, event type, priority/severity, kilometre/chainage, timestamp, operational impact, asset condition, media/CCTV URL and source system.

This lets a technician prove the end-to-end path with a small sample message before mapping a complete production interface.

## Historical TRITON path

The supplied public historical material describes TRITON as a UDP/IP binary telegram protocol with a 10-byte header, a variable body and a CCITT CRC. Documented GPS payloads include GPRMC, GPGGA and GPVTG. RailWatch now contains an offline decoder for those documented structures.

For a real network that emits TRITON UDP, use the supplied `triton_udp_bridge.py` on an approved integration host. The bridge receives UDP locally, validates the telegram CRC, extracts supported GPS data and sends normalized telemetry to RailWatch over HTTPS.

The bridge deliberately does not know or connect to any Transnet address. The integration owner supplies the approved listener/network details and the RailWatch target URL after security approval.

## What still needs Transnet confirmation

Do not assume historical TRITON IP addresses, ports, field layouts, GIS identifiers, authentication methods or signalling interfaces remain current. Request the current interface-control document, security/network requirements, GIS data dictionary, data-sharing agreement and test-environment access.

RailWatch treats train telemetry and asset monitoring as non-safety telemetry by default. It does not issue signalling or movement authority commands.

## First-contact demo script

A technician can provide one synthetic or approved test event. RailWatch should then:

1. authenticate the event;
2. normalize it into the internal incident contract;
3. deduplicate it;
4. persist it in PostgreSQL;
5. broadcast it through the command centre;
6. expose the incident timeline, SLA, deterministic rules and audit trail.

The system can then map additional Transnet-specific fields without changing the command-centre workflow.
