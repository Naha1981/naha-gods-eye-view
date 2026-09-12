"""Small deployment-side bridge for legacy TRITON UDP telemetry.

Run this only on an approved integration host/network. It listens for UDP,
validates the historical TRITON telegram CRC, converts supported NMEA GPS data
and forwards a normalized JSON event to the RailWatch HTTPS ingest endpoint.
It never opens a connection to a Transnet address by itself.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import hmac
import json
import os
import urllib.request
from typing import Any

from triton_legacy import parse_telegram


class Receiver(asyncio.DatagramProtocol):
    def __init__(self, target_url: str, ingest_key: str, corridor: str, segment: str) -> None:
        self.target_url = target_url
        self.ingest_key = ingest_key
        self.corridor = corridor
        self.segment = segment

    def datagram_received(self, data: bytes, addr: tuple[str, int]) -> None:
        try:
            decoded = parse_telegram(data)
            if not decoded["valid_crc"]:
                return
            gps = decoded["nmea"].get("gps", {})
            if gps.get("latitude") is None or gps.get("longitude") is None:
                return
            event = {
                "event_id": f"TRITON-{decoded['serial_number']}-{decoded['sequence_number']}",
                "source_system": "TRITON-UDP-BRIDGE",
                "corridor": self.corridor,
                "section": self.segment,
                "lat": gps["latitude"],
                "lon": gps["longitude"],
                "priority": "WARNING",
                "type": decoded["message_name"],
                "device_id": f"TRITON-{decoded['serial_number']}",
                "occurred_at": gps.get("timestamp"),
                "description": "TRITON UDP telemetry normalized by approved bridge",
                "protocol": "TRITON-LEGACY",
                "protocol_metadata": {
                    "message_type": decoded["message_type"],
                    "sequence_number": decoded["sequence_number"],
                    "host_id": decoded["host_id"],
                    "port_id": decoded["port_id"],
                },
            }
            payload = json.dumps(event, separators=(",", ":")).encode("utf-8")
            request = urllib.request.Request(
                self.target_url,
                data=payload,
                method="POST",
                headers={"content-type": "application/json", "x-railwatch-key": self.ingest_key},
            )
            with urllib.request.urlopen(request, timeout=5) as response:
                response.read()
        except Exception:
            # A production bridge should emit structured logs/metrics. For the
            # small reference bridge we fail closed on malformed input/network errors.
            return


async def main() -> None:
    parser = argparse.ArgumentParser(description="TRITON UDP to RailWatch HTTPS bridge")
    parser.add_argument("--listen-host", default=os.getenv("TRITON_LISTEN_HOST", "0.0.0.0"))
    parser.add_argument("--listen-port", type=int, default=int(os.getenv("TRITON_LISTEN_PORT", "9009")))
    parser.add_argument("--target-url", default=os.getenv("RAILWATCH_TARGET_URL", "https://naha-railwatch-api.onrender.com/api/v1/telemetry/ingest"))
    parser.add_argument("--ingest-key", default=os.getenv("RAILWATCH_INGEST_KEY", ""))
    parser.add_argument("--corridor", default=os.getenv("TRITON_CORRIDOR", "EXTERNAL"))
    parser.add_argument("--segment", default=os.getenv("TRITON_SEGMENT", "External TRITON sector"))
    args = parser.parse_args()
    if not args.ingest_key:
        raise SystemExit("RAILWATCH_INGEST_KEY / --ingest-key is required")
    loop = asyncio.get_running_loop()
    transport, _ = await loop.create_datagram_endpoint(
        lambda: Receiver(args.target_url, args.ingest_key, args.corridor, args.segment),
        local_addr=(args.listen_host, args.listen_port),
    )
    try:
        await asyncio.Future()
    finally:
        transport.close()


if __name__ == "__main__":
    asyncio.run(main())
