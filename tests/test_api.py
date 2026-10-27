import sqlite3
from pathlib import Path

import pytest

from api.db import Database
from api.index import create_app


@pytest.fixture()
def client(tmp_path: Path):
    database_path = tmp_path / "test.sqlite3"
    app = create_app(
        {
            "TESTING": True,
            "SQLITE_PATH": str(database_path),
            "DEVICE_API_KEY": "test-device-secret",
            "CURRENT_DETECTION_WINDOW_SECONDS": 300,
        }
    )
    database = app.extensions["agri_database"]
    database.execute_script(
        (Path(__file__).parents[1] / "api" / "schema.sql").read_text(encoding="utf-8")
    )
    with app.test_client() as test_client:
        yield test_client
    database.close()


def auth_headers() -> dict[str, str]:
    return {"Authorization": "Bearer test-device-secret"}


def test_health_and_seeded_resources(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.get_json() == {"database": True, "status": "ok"}

    zones = client.get("/api/zones").get_json()
    cameras = client.get("/api/cameras").get_json()
    detections = client.get("/api/detections").get_json()
    assert [zone["name"] for zone in zones] == ["Zone 1", "Zone 2", "Zone 3", "Zone 4"]
    assert len(cameras) == 4
    assert detections == []


def test_health_reports_missing_schema(tmp_path: Path):
    app = create_app(
        {
            "TESTING": True,
            "SQLITE_PATH": str(tmp_path / "unmigrated.sqlite3"),
            "DEVICE_API_KEY": "test-device-secret",
            "AUTO_MIGRATE": False,
        }
    )
    with app.test_client() as test_client:
        response = test_client.get("/api/health")
    app.extensions["agri_database"].close()

    assert response.status_code == 503
    body = response.get_json()
    assert body["database"] is True
    assert body["schema"] is False
    assert body["missingColumns"] == {}
    assert set(body["missingTables"]) == {
        "zones",
        "cameras",
        "detections",
        "spray_logs",
        "system_events",
        "alerts",
        "system_settings",
    }


def test_schema_migration_is_idempotent_and_preserves_data(tmp_path: Path):
    database = Database(sqlite_path=str(tmp_path / "migration.sqlite3"))
    schema = (Path(__file__).parents[1] / "api" / "schema.sql").read_text(encoding="utf-8")
    database.execute_script(schema)
    database.execute("INSERT INTO zones (id, name) VALUES (?, ?)", [99, "Existing Zone"])
    database.execute_script(schema)

    assert database.missing_tables() == []
    assert database.missing_columns() == {}
    assert database.query_one("SELECT name FROM zones WHERE id = ?", [99]) == {
        "name": "Existing Zone"
    }
    database.close()


def test_detection_requires_auth_and_validates_body(client):
    payload = {"zoneId": 1, "pestClass": "Aphid", "confidence": 94.7}
    assert client.post("/api/detections", json=payload).status_code == 401

    invalid = {**payload, "confidence": 101}
    response = client.post("/api/detections", json=invalid, headers=auth_headers())
    assert response.status_code == 400
    assert response.get_json()["error"] == "validation_error"


def test_detection_round_trip_creates_event_and_alert(client):
    response = client.post(
        "/api/detections",
        json={
            "zoneId": 2,
            "pestClass": "Aphid",
            "confidence": 94.7,
            "box": {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4},
        },
        headers=auth_headers(),
    )
    assert response.status_code == 201
    created = response.get_json()
    assert created["zoneName"] == "Zone 2"
    assert created["confidence"] == 94.7

    detections = client.get("/api/detections").get_json()
    current = client.get("/api/detections/current").get_json()
    events = client.get("/api/events").get_json()
    alerts = client.get("/api/alerts").get_json()
    assert detections[0]["id"] == created["id"]
    assert current["2"]["pestClass"] == "Aphid"
    assert events[0]["type"] == "detection"
    assert alerts[0]["type"] == "pest_detected"


def test_spray_round_trip(client):
    response = client.post(
        "/api/sprays/trigger",
        json={"zoneId": 3, "trigger": "Caterpillar detected", "duration": 7},
        headers=auth_headers(),
    )
    assert response.status_code == 201
    assert response.get_json()["duration"] == 7
    assert client.get("/api/sprays").get_json()[0]["zoneName"] == "Zone 3"


def test_settings_require_csrf_and_persist(client):
    response = client.put(
        "/api/settings",
        json={"threshold": 90, "sprayDuration": 8, "autoSpray": False, "notifications": True},
    )
    assert response.status_code == 403

    settings_response = client.get("/api/settings")
    csrf_token = settings_response.get_json()["csrfToken"]
    response = client.put(
        "/api/settings",
        json={"threshold": 90, "sprayDuration": 8, "autoSpray": False, "notifications": True},
        headers={"X-CSRF-Token": csrf_token},
    )
    assert response.status_code == 200
    assert response.get_json() == {
        "threshold": 90,
        "sprayDuration": 8,
        "autoSpray": False,
        "notifications": True,
    }
    assert client.get("/api/settings").get_json()["threshold"] == 90


def test_query_validation(client):
    response = client.get("/api/detections?limit=9999")
    assert response.status_code == 400
    assert response.get_json()["error"] == "validation_error"


def csrf_headers(client) -> dict[str, str]:
    return {"X-CSRF-Token": client.get("/api/csrf").get_json()["csrfToken"]}


def create_detection(client, zone_id: int = 1) -> dict:
    response = client.post(
        "/api/detections",
        json={"zoneId": zone_id, "pestClass": "Aphid", "confidence": 91.0},
        headers=auth_headers(),
    )
    assert response.status_code == 201
    return response.get_json()


def test_auto_migrate_creates_local_database(tmp_path: Path):
    database_path = tmp_path / "fresh" / "agri.sqlite3"
    app = create_app({"TESTING": True, "SQLITE_PATH": str(database_path)})
    with app.test_client() as test_client:
        assert test_client.get("/api/health").status_code == 200
        assert len(test_client.get("/api/zones").get_json()) == 4
    app.extensions["agri_database"].close()
    assert database_path.exists()


def test_data_persists_across_app_restarts(tmp_path: Path):
    database_path = str(tmp_path / "persist.sqlite3")
    config = {"TESTING": True, "SQLITE_PATH": database_path, "DEVICE_API_KEY": "test-device-secret"}
    with create_app(config).test_client() as first:
        created = create_detection(first)
    with create_app(config).test_client() as second:
        ids = [row["id"] for row in second.get("/api/detections").get_json()]
    assert ids == [created["id"]]


def test_dashboard_writes_require_csrf(client):
    assert client.put("/api/zones/1/stream", json={"streamUrl": "http://x/stream"}).status_code == 403
    assert client.put("/api/settings", json={"threshold": 90, "sprayDuration": 8, "autoSpray": False, "notifications": True}).status_code == 403


def test_spray_creation_is_device_only(client):
    payload = {"zoneId": 1, "trigger": "Manual", "duration": 3}
    assert client.post("/api/sprays/trigger", json=payload).status_code == 401
    assert client.post("/api/sprays/trigger", json=payload, headers=csrf_headers(client)).status_code == 401
    assert client.get("/api/sprays").get_json() == []


def test_batch_is_all_or_nothing(tmp_path: Path):
    app = create_app({"TESTING": True, "SQLITE_PATH": str(tmp_path / "tx.sqlite3")})
    database = app.extensions["agri_database"]
    with pytest.raises(sqlite3.IntegrityError):
        database.batch(
            [
                ("INSERT INTO spray_logs (zone_id, trigger, duration, activated_at) VALUES (?, ?, ?, ?)",
                 [1, "ok", 5, "2026-01-01T00:00:00+00:00"]),
                # duration 99 violates the CHECK constraint, so the first insert must be rolled back too
                ("INSERT INTO spray_logs (zone_id, trigger, duration, activated_at) VALUES (?, ?, ?, ?)",
                 [1, "bad", 99, "2026-01-01T00:00:00+00:00"]),
            ]
        )
    assert database.query("SELECT * FROM spray_logs") == []
    database.close()


def test_zone_stream_url_round_trip(client):
    headers = csrf_headers(client)
    response = client.put("/api/zones/3/stream", json={"streamUrl": " http://192.168.1.50:81/stream "}, headers=headers)
    assert response.status_code == 200
    zone = next(z for z in client.get("/api/zones").get_json() if z["id"] == 3)
    assert zone["streamUrl"] == "http://192.168.1.50:81/stream"

    assert client.put("/api/zones/3/stream", json={"streamUrl": "javascript:alert(1)"}, headers=headers).status_code == 400
    assert client.put("/api/zones/99/stream", json={"streamUrl": "/s"}, headers=headers).status_code == 404

    assert client.put("/api/zones/3/stream", json={"streamUrl": ""}, headers=headers).status_code == 200
    zone = next(z for z in client.get("/api/zones").get_json() if z["id"] == 3)
    assert zone["streamUrl"] == ""
