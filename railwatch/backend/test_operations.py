import base64
import hashlib
import hmac
import json
import os
import time
import unittest

os.environ.setdefault("RAILWATCH_INGEST_KEY", "test-ingest")
os.environ.setdefault("RAILWATCH_ALLOWED_ORIGINS", "http://testserver")
os.environ["RAILWATCH_SIGNING_SECRET"] = "test-signing-secret"
os.environ["RAILWATCH_OPERATOR_SECRET"] = "test-operator-secret"
os.environ["RAILWATCH_OPERATOR_BOOTSTRAP_KEY"] = "test-ingest"
os.environ.setdefault("RAILWATCH_DEFAULT_TENANT", "Tenant-A")

from fastapi.testclient import TestClient

from main import app


def sample_alert(event_id="OPS-1"):
    return {
        "event_id": event_id,
        "corridor_code": "TEST-CORRIDOR",
        "segment_name": "Test Sector",
        "km_marker": 12.5,
        "coordinates": {"latitude": -26.2041, "longitude": 28.0473, "elevation_m": 1700},
        "alert_type": "LINE_BREACH",
        "severity": "CRITICAL",
        "sensor_id": "TEST-01",
    }


def operator_token(client, tenant_label="Tenant-A"):
    previous = os.environ.get("RAILWATCH_DEFAULT_TENANT")
    os.environ["RAILWATCH_DEFAULT_TENANT"] = tenant_label
    try:
        response = client.post(
            "/api/v1/auth/demo-token?role=controller&operator=test-controller",
            headers={"x-railwatch-key": "test-ingest"},
        )
    finally:
        if previous is None:
            os.environ.pop("RAILWATCH_DEFAULT_TENANT", None)
        else:
            os.environ["RAILWATCH_DEFAULT_TENANT"] = previous
    return response.json()["token"]


class OperationsContractTests(unittest.TestCase):
    def test_demo_token_and_rbac_action(self):
        with TestClient(app) as client:
            token_response = client.post("/api/v1/auth/demo-token?role=controller&operator=test-controller", headers={"x-railwatch-key": "test-ingest"})
            self.assertEqual(token_response.status_code, 200)
            token = token_response.json()["token"]
            ingest = client.post("/api/v1/telemetry/line-breach", headers={"x-railwatch-key": "test-ingest"}, json=sample_alert("OPS-ACTION"))
            self.assertEqual(ingest.status_code, 202)
            action = client.post("/api/v1/incidents/OPS-ACTION/action", headers={"authorization": f"Bearer {token}"}, json={"action": "ACKNOWLEDGE"})
            self.assertEqual(action.status_code, 200)
            self.assertEqual(action.json()["stage"], "VERIFY")

    def test_sla_replay_and_rules_require_operator_scope(self):
        with TestClient(app) as client:
            token = operator_token(client, "Tenant-A")
            client.post("/api/v1/telemetry/line-breach", headers={"x-railwatch-key": "test-ingest"}, json=sample_alert("OPS-SLA"))
            self.assertEqual(client.get("/api/v1/incidents/OPS-SLA/sla").status_code, 401)
            headers = {"authorization": f"Bearer {token}"}
            sla = client.get("/api/v1/incidents/OPS-SLA/sla", headers=headers)
            replay = client.get("/api/v1/incidents/OPS-SLA/replay", headers=headers)
            rules = client.get("/api/v1/rules/evaluate/OPS-SLA", headers=headers)
            self.assertEqual(sla.status_code, 200)
            self.assertIn("ACK", sla.json()["milestones"])
            self.assertEqual(replay.status_code, 200)
            self.assertGreaterEqual(len(replay.json()["timeline"]), 1)
            self.assertEqual(rules.status_code, 200)
            self.assertEqual(rules.json()["recommended_escalation"], "IMMEDIATE")

    def test_tenant_isolation(self):
        with TestClient(app) as client:
            tenant_a_token = operator_token(client, "Tenant-A")
            client.post(
                "/api/v1/telemetry/line-breach",
                headers={"x-railwatch-key": "test-ingest"},
                json=sample_alert("OPS-TENANT-A"),
            )

            tenant_b_token = operator_token(client, "Tenant-B")
            os.environ["RAILWATCH_DEFAULT_TENANT"] = "Tenant-B"
            try:
                client.post(
                    "/api/v1/telemetry/line-breach",
                    headers={"x-railwatch-key": "test-ingest"},
                    json=sample_alert("OPS-TENANT-B"),
                )
            finally:
                os.environ["RAILWATCH_DEFAULT_TENANT"] = "Tenant-A"

            headers_a = {"authorization": f"Bearer {tenant_a_token}"}
            headers_b = {"authorization": f"Bearer {tenant_b_token}"}
            self.assertEqual(client.get("/api/v1/incidents/OPS-TENANT-A/timeline", headers=headers_a).status_code, 200)
            self.assertEqual(client.get("/api/v1/incidents/OPS-TENANT-B/timeline", headers=headers_b).status_code, 200)
            self.assertEqual(client.get("/api/v1/incidents/OPS-TENANT-B/timeline", headers=headers_a).status_code, 403)
            self.assertEqual(client.get("/api/v1/incidents/OPS-TENANT-A/timeline", headers=headers_b).status_code, 403)

    def test_signed_telemetry_accepts_then_rejects_replay(self):
        with TestClient(app) as client:
            payload = json.dumps(sample_alert("OPS-SIGNED"), separators=(",", ":")).encode()
            ts = str(int(time.time()))
            nonce = "nonce-1"
            digest = hmac.new(b"test-signing-secret", ts.encode() + b"." + nonce.encode() + b"." + payload, hashlib.sha256).hexdigest()
            headers = {
                "x-railwatch-client": "demo-sensor",
                "x-railwatch-timestamp": ts,
                "x-railwatch-nonce": nonce,
                "x-railwatch-signature": digest,
                "content-type": "application/json",
            }
            first = client.post("/api/v1/telemetry/signed-line-breach", headers=headers, content=payload)
            second = client.post("/api/v1/telemetry/signed-line-breach", headers=headers, content=payload)
            self.assertEqual(first.status_code, 202)
            self.assertEqual(second.status_code, 409)


if __name__ == "__main__":
    unittest.main()
