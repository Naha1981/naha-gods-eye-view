import os
import unittest

os.environ.setdefault("RAILWATCH_INGEST_KEY", "test-ingest")
os.environ.setdefault("RAILWATCH_ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("RAILWATCH_DEMO_MODE", "false")

from fastapi.testclient import TestClient

from main import app


class GenericTelemetryContractTests(unittest.TestCase):
    def test_normalizes_common_external_fields(self):
        body = {
            "id": "EXT-001",
            "corridor": "COAL",
            "section": "Demo external section",
            "km": 42.5,
            "lat": -26.2,
            "lon": 28.1,
            "type": "TRACK_ALARM",
            "priority": "HIGH",
            "device_id": "PLC-17",
            "occurred_at": "2026-09-12T11:00:00Z",
            "description": "External system alarm",
        }
        with TestClient(app) as client:
            response = client.post("/api/v1/telemetry/ingest", headers={"x-railwatch-key": "test-ingest"}, json=body)
            self.assertEqual(response.status_code, 202)
            self.assertEqual(response.json()["status"], "accepted")

            events = client.get("/api/v1/events").json()
            event = next(item for item in events if item["data"]["event_id"] == "EXT-001")
            self.assertEqual(event["data"]["corridor"], "COAL")
            self.assertEqual(event["data"]["segment"], "Demo external section")
            self.assertEqual(event["data"]["severity"], "HIGH")
            self.assertEqual(event["data"]["sensor_id"], "PLC-17")
            self.assertEqual(event["data"]["alert_type"], "TRACK_ALARM")

    def test_requires_authentication(self):
        with TestClient(app) as client:
            response = client.post("/api/v1/telemetry/ingest", json={"id": "EXT-AUTH", "lat": 1, "lon": 2})
            self.assertEqual(response.status_code, 401)

    def test_integration_info_is_public_and_describes_adapter(self):
        with TestClient(app) as client:
            response = client.get("/api/v1/telemetry/integration-info")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["status"], "ready")
            self.assertIn("/api/v1/telemetry/signed-ingest", response.json()["endpoints"]["signed_ingest"])


if __name__ == "__main__":
    unittest.main()
