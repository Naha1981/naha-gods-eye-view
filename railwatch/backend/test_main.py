import os

os.environ.setdefault("RAILWATCH_INGEST_KEY", "test-ingest")
os.environ.setdefault("RAILWATCH_WS_KEY", "test-ws")
os.environ.setdefault("RAILWATCH_ALLOWED_ORIGINS", "http://testserver")

from fastapi.testclient import TestClient

from main import app


client = TestClient(app)


def sample_alert(event_id: str = "EVT-1"):
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


def test_healthz():
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_ingest_requires_auth():
    response = client.post("/api/v1/telemetry/line-breach", json=sample_alert())
    assert response.status_code == 401


def test_ingest_accepts_and_deduplicates():
    headers = {"x-railwatch-key": "test-ingest"}
    first = client.post("/api/v1/telemetry/line-breach", json=sample_alert(), headers=headers)
    second = client.post("/api/v1/telemetry/line-breach", json=sample_alert(), headers=headers)
    assert first.status_code == 202
    assert first.json()["status"] == "accepted"
    assert second.status_code == 202
    assert second.json()["status"] == "duplicate"
