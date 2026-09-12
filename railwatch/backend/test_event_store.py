import os
import unittest
from unittest.mock import patch

from event_store import EventStore


class EventStoreContractTests(unittest.TestCase):
    def test_memory_mode_is_explicit_when_database_url_missing(self):
        with patch.dict(os.environ, {"RAILWATCH_REQUIRE_PERSISTENCE": "false"}, clear=False):
            os.environ.pop("DATABASE_URL", None)
            store = EventStore("")
            self.assertFalse(store.enabled)
            self.assertFalse(store.initialize())
            self.assertEqual(
                store.health(),
                {
                    "mode": "memory",
                    "configured": False,
                    "available": False,
                    "required": False,
                },
            )

    def test_configured_store_can_be_required_explicitly(self):
        with patch.dict(os.environ, {"RAILWATCH_REQUIRE_PERSISTENCE": "true"}, clear=False):
            store = EventStore("postgresql://example.invalid/railwatch")
            self.assertTrue(store.enabled)
            self.assertTrue(store.required)
            self.assertEqual(store.health()["mode"], "postgres")
            self.assertTrue(store.health()["configured"])
            self.assertTrue(store.health()["required"])


if __name__ == "__main__":
    unittest.main()
