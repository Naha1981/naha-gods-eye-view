#!/usr/bin/env python3
"""Approved-network gateway for historical TRITON UDP telemetry.

This is intentionally a separate process from the public Render API. It can
listen on an approved/private interface, validate a TRITON telegram, and
forward only validated telemetry to RailWatch over HTTPS.

It does not contain any Transnet network addresses or assume historical
addresses/ports are still valid.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import ipaddress
import json
import os
import secrets
import socket
import sys
import time
import urllib.error
import urllib.request
from typing import Iterable

# Allow running directly from the repo without packaging.
BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from triton_legacy import parse_telegram  # noqa: E402


def allowed_source(address: str, networks: Iterable[str]) -> bool:
    if not networks:
        return True
    ip = ipaddress.ip_address(address)
    return any(ip in ipaddress.ip_network(net, strict=False) for net in networks)


def sign_payload(body: bytes, client: str, secret: str) -> dict[str, str]:
    timestamp = str(int(time.time()))
    nonce = secrets.token_urlsafe(18)
    digest = hmac.new(
        secret.encode("utf-8"),
        f"{timestamp}.{nonce}.".encode("utf-8") + body,
        hashlib.sha256,
    ).hexdigest()
    return {
        "X-RailWatch-Client": client,
        "X-RailWatch-Timestamp": timestamp,
        "X-RailWatch-Nonce": nonce,
        "X-RailWatch-Signature": digest,
    }


def forward(api_url: str, body: dict, client: str, secret: str, timeout: float) -> None:
    raw = json.dumps(body, separators=(",", ":")).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    headers.update(sign_payload(raw, client, secret))
    request = urllib.request.Request(api_url, data=raw, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        response.read()


def build_forward_body(decoded: dict, raw: bytes, source_ip: str) -> dict:
    gps = decoded.get("nmea", {}).get("gps", {})
    return {
        "event_id": f"TRITON-{decoded['serial_number']}-{decoded['sequence_number']}-{int(time.time()*1000)}",
        "source_system": "TRITON-LEGACY-GATEWAY",
        "source_id": f"TRITON-{decoded['serial_number']}",
        "corridor": os.getenv("RAILWATCH_INTEGRATION_CORRIDOR", "EXTERNAL"),
        "section": os.getenv("RAILWATCH_INTEGRATION_SEGMENT", "External TRITON sector"),
        "lat": gps.get("latitude"),
        "lon": gps.get("longitude"),
        "elevation_m": gps.get("altitude_m", 0),
        "type": decoded.get("message_name", "TRITON_EVENT"),
        "priority": "WARNING" if decoded.get("message_type") in {3, 4, 5, 6} else "INFO",
        "device_id": f"TRITON-{decoded['serial_number']}",
        "occurred_at": gps.get("timestamp"),
        "description": "Validated TRITON telegram received by approved integration gateway",
        "protocol": "TRITON-LEGACY",
        "gateway": {
            "source_ip": source_ip,
            "sequence_number": decoded.get("sequence_number"),
            "message_type": decoded.get("message_type"),
            "crc": decoded.get("received_crc"),
            "raw_telegram_base64": base64.b64encode(raw).decode("ascii"),
        },
    }


def run(listen_host: str, listen_port: int, allowed_networks: list[str], api_url: str, client: str, secret: str, timeout: float) -> None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((listen_host, listen_port))
    print(f"RailWatch TRITON gateway listening on {listen_host}:{listen_port}")

    while True:
        packet, address = sock.recvfrom(2048)
        source_ip, _source_port = address
        if not allowed_source(source_ip, allowed_networks):
            print(f"Dropped telegram from non-allowlisted source {source_ip}")
            continue
        try:
            decoded = parse_telegram(packet)
        except ValueError as exc:
            print(f"Dropped malformed telegram from {source_ip}: {exc}")
            continue
        if not decoded["valid_crc"]:
            print(f"Dropped CRC-invalid telegram from {source_ip}")
            continue
        if decoded["nmea"]["gps"].get("latitude") is None or decoded["nmea"]["gps"].get("longitude") is None:
            print(f"Validated telegram from {source_ip} has no supported GPS coordinates; not forwarded")
            continue

        body = build_forward_body(decoded, packet, source_ip)
        try:
            forward(api_url, body, client, secret, timeout)
            print(f"Forwarded TRITON event from {source_ip}: {body['event_id']}")
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            print(f"Forward failed for {source_ip}: {exc}")


def main() -> None:
    parser = argparse.ArgumentParser(description="RailWatch historical TRITON UDP integration gateway")
    parser.add_argument("--listen-host", default=os.getenv("TRITON_GATEWAY_HOST", "127.0.0.1"))
    parser.add_argument("--listen-port", type=int, default=int(os.getenv("TRITON_GATEWAY_PORT", "9009")))
    parser.add_argument("--allow-network", action="append", default=[])
    parser.add_argument("--api-url", default=os.getenv("RAILWATCH_SIGNED_INGEST_URL", "https://naha-railwatch-api.onrender.com/api/v1/telemetry/signed-ingest"))
    parser.add_argument("--client", default=os.getenv("RAILWATCH_SIGNING_CLIENT", "demo-sensor"))
    parser.add_argument("--secret", default=os.getenv("RAILWATCH_SIGNING_SECRET", ""))
    parser.add_argument("--timeout", type=float, default=float(os.getenv("RAILWATCH_FORWARD_TIMEOUT", "5")))
    args = parser.parse_args()

    if not args.secret:
        raise SystemExit("RAILWATCH_SIGNING_SECRET is required")

    run(
        args.listen_host,
        args.listen_port,
        args.allow_network,
        args.api_url,
        args.client,
        args.secret,
        args.timeout,
    )


if __name__ == "__main__":
    main()
