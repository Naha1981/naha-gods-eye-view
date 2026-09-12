# RailWatch live telemetry integration

RailWatch is designed to receive external rail telemetry through a controlled integration boundary.

## Supported paths

- Generic JSON telemetry: `/api/v1/telemetry/ingest`
- Signed JSON telemetry: `/api/v1/telemetry/signed-ingest`
- Historical TRITON telegrams: `/api/v1/telemetry/triton/telegram`
- Historical TRITON/NMEA messages: `/api/v1/telemetry/triton/nmea`
- Adapter metadata: `/api/v1/telemetry/integration-info` and `/api/v1/telemetry/triton/info`

## Historical TRITON path

The repository includes `integration/triton_udp_gateway.py`. It is a separate integration process intended for an approved/private network segment. It:

1. receives UDP datagrams;
2. optionally allowlists source CIDRs;
3. validates the TRITON telegram structure and CRC;
4. decodes supported GPRMC/GPGGA/GPVTG payloads;
5. forwards normalized telemetry to RailWatch over HTTPS with HMAC headers.

The gateway defaults to `127.0.0.1` so it cannot accidentally become a public listener. A real deployment must bind it only to an explicitly approved interface and source network.

## What a Transnet technician can provide

For an approved pilot, RailWatch can be mapped to the current interface by receiving:

- current protocol/interface-control document;
- sample telemetry messages from a test environment;
- current field definitions for locomotive, train, asset and alarm identifiers;
- current coordinate/chainage conventions;
- current security/authentication requirements;
- current network path (API, broker, UDP gateway, VPN/private link, etc.);
- GIS/asset reference data required for authoritative map matching.

Do not use the historic TRITON addresses/ports as connection instructions. The public material available for TRITON is historical and does not establish current production endpoints.

## Demo-to-live transition

The command centre does not need to be rebuilt when a new source is introduced. The integration layer normalizes the source into the RailWatch event contract, after which PostgreSQL persistence, realtime broadcasting, incident rules, SLA tracking, audit and replay continue through the existing operational pipeline.

Until the current Transnet interface is officially supplied and approved, all source-specific values should be treated as integration-test configuration rather than production credentials or endpoints.
