import os
import unittest

os.environ.pop("DATABASE_URL", None)
os.environ["RAILWATCH_REQUIRE_PERSISTENCE"] = "true"

from main_persistent import startup_restore, storage_health


class PersistentAppContractTests(unittest.TestCase):
    def test_storage_health_reports_explicit_memory_fallback_without_database(self):
        response = storage_health()
        self.assertEqual(response["mode"], "memory")
        self.assertFalse(response["configured"])
        self.assertTrue(response["required"])

    def test_startup_restore_is_safe_without_database(self):
        import asyncio

        asyncio.run(startup_restore())


if __name__ == "__main__":
    unittest.main()
