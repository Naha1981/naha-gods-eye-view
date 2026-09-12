import hashlib
import hmac
import json
import os
import unittest

os.environ["RAILWATCH_DEMO_MODE"] = "true"
os.environ["RAILWATCH_WHATSAPP_ENABLED"] = "true"
os.environ["WHATSAPP_WEBHOOK_SECRET"] = "test-whatsapp-secret"
os.environ["RAILWATCH_DEFAULT_TENANT"] = "NahaLabs-Demo"
os.environ["RAILWATCH_ALLOWED_ORIGINS"] = "http://testserver"
os.environ["RAILWATCH_OPERATOR_SECRET"] = "test-operator-secret"
os.environ["RAILWATCH_INGEST_KEY"] = "test-ingest"

from fastapi.testclient import TestClient

from main import app


class WhatsAppIntegrationTests(unittest.TestCase):
    def test_demo_session_is_only_available_in_demo_mode(self):
        with TestClient(app) as client:
            response = client.get("/api/v1/whatsapp/session")
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()["token"].startswith("RW1."))

    def test_status_uses_operator_token_tenant_scope(self):
        with TestClient(app) as client:
            token = client.get("/api/v1/whatsapp/session").json()["token"]
            response = client.get("/api/v1/whatsapp/status", headers={"authorization": f"Bearer {token}"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["tenant"], "NahaLabs-Demo")
            self.assertTrue(response.json()["enabled"])

    def test_webhook_signature_and_idempotency(self):
        with TestClient(app) as client:
            body = {
                "schemaVersion": 1,
                "waAccountId": "demo-wa-account",
                "appId": "railwatch",
                "tenantId": "NahaLabs-Demo",
                "event": "message",
                "data": {
                    "messageId": "WA-QA-001",
                    "senderId": "27821234567",
                    "chatId": "27821234567@s.whatsapp.net",
                    "messageType": "conversation",
                    "text": "HELP",
                },
                "deliveredAt": "2026-09-12T00:00:00+00:00",
            }
            raw = json.dumps(body, separators=(",", ":")).encode()
            signature = hmac.new(b"test-whatsapp-secret", raw, hashlib.sha256).hexdigest()
            first = client.post("/api/v1/webhooks/whatsapp", headers={"x-webhook-signature": signature}, content=raw)
            second = client.post("/api/v1/webhooks/whatsapp", headers={"x-webhook-signature": signature}, content=raw)
            rejected = client.post("/api/v1/webhooks/whatsapp", headers={"x-webhook-signature": "bad"}, content=raw)

            self.assertEqual(first.status_code, 200)
            self.assertFalse(first.json()["duplicate"])
            self.assertEqual(second.status_code, 200)
            self.assertTrue(second.json()["duplicate"])
            self.assertEqual(rejected.status_code, 401)


if __name__ == "__main__":
    unittest.main()
