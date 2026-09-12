import hashlib
import hmac
import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.dirname(__file__))

from triton_udp_gateway import allowed_source, sign_payload  # noqa: E402


class TritonGatewayTests(unittest.TestCase):
    def test_source_allowlist(self):
        self.assertTrue(allowed_source("10.10.1.25", ["10.10.0.0/16"]))
        self.assertFalse(allowed_source("192.0.2.10", ["10.10.0.0/16"]))

    def test_signed_forward_headers(self):
        with patch("triton_udp_gateway.time.time", return_value=1730000000), patch(
            "triton_udp_gateway.secrets.token_urlsafe", return_value="nonce-demo"
        ):
            headers = sign_payload(b'{"event_id":"E1"}', "demo-sensor", "secret")
        expected = hmac.new(
            b"secret",
            b"1730000000.nonce-demo.{\"event_id\":\"E1\"}",
            hashlib.sha256,
        ).hexdigest()
        self.assertEqual(headers["X-RailWatch-Timestamp"], "1730000000")
        self.assertEqual(headers["X-RailWatch-Nonce"], "nonce-demo")
        self.assertEqual(headers["X-RailWatch-Signature"], expected)


if __name__ == "__main__":
    unittest.main()
