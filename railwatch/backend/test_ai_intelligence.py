import os
import unittest

os.environ["RAILWATCH_DEMO_MODE"] = "true"
os.environ["RAILWATCH_DEFAULT_TENANT"] = "NahaLabs-Demo"
os.environ.pop("NAHALLM_URL", None)
os.environ.pop("NAHALLM_API_KEY", None)

from fastapi.testclient import TestClient

from main import app


class AIIntelligenceTests(unittest.TestCase):
    def test_ai_status_is_safe_when_gateway_not_configured(self):
        with TestClient(app) as client:
            response = client.get("/api/v1/ai/status")
            self.assertEqual(response.status_code, 200)
            self.assertFalse(response.json()["configured"])

    def test_ai_feature_returns_service_unavailable_without_gateway(self):
        with TestClient(app) as client:
            demo = client.post("/api/v1/demo/line-breach")
            self.assertEqual(demo.status_code, 202)
            event_id = demo.json()["event_id"]
            response = client.post(f"/api/v1/ai/incident/{event_id}/brief")
            self.assertEqual(response.status_code, 503)
            self.assertIn("NahaLLM is not configured", response.text)

    def test_unknown_incident_returns_not_found(self):
        with TestClient(app) as client:
            response = client.post("/api/v1/ai/incident/DOES-NOT-EXIST/brief")
            self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
