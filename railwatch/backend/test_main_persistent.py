import os
import unittest

os.environ.pop("DATABASE_URL", None)
os.environ["RAILWATCH_REQUIRE_PERSISTENCE"] = "true"

from fastapi.testclient import TestClient

from main_persistent import app


class PersistentAppContractTests(unittest.TestCase):
    def test_storage_health_reports_explicit_memory_fallback_without_database(self):
        with TestClient(app) as client:
            response = client.get("/api/v1/storage/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["mode"], "memory")
        self.assertFalse(response.json()["configured"])
        self.assertTrue(response.json()["required"])


if __name__ == "__main__":
    unittest.main()
