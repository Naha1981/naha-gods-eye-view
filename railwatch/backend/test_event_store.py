from event_store import EventStore


def test_memory_mode_is_explicit_when_database_url_missing(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("RAILWATCH_REQUIRE_PERSISTENCE", raising=False)
    store = EventStore("")
    assert store.enabled is False
    assert store.initialize() is False
    assert store.health() == {
        "mode": "memory",
        "configured": False,
        "available": False,
        "required": False,
    }


def test_configured_store_requires_explicit_fail_closed_policy(monkeypatch):
    monkeypatch.setenv("RAILWATCH_REQUIRE_PERSISTENCE", "true")
    store = EventStore("postgresql://example.invalid/railwatch")
    assert store.enabled is True
    assert store.required is True
    assert store.health()["mode"] == "postgres"
    assert store.health()["configured"] is True
    assert store.health()["required"] is True
