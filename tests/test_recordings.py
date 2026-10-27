import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

import api.recordings as recordings
from api.index import create_app

JPEG = b"\xff\xd8\xff\xe0fake-jpeg-body\xff\xd9"


class FakeMjpegCamera(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=cam")
        self.end_headers()
        try:
            for _ in range(200):
                self.wfile.write(b"--cam\r\nContent-Type: image/jpeg\r\n\r\n" + JPEG + b"\r\n")
                self.wfile.flush()
                time.sleep(0.05)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def log_message(self, *_):
        pass


@pytest.fixture()
def camera_url():
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeMjpegCamera)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}/stream"
    server.shutdown()


@pytest.fixture()
def client(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(recordings, "RECORDINGS_DIR", tmp_path / "recordings")
    app = create_app({"TESTING": True, "SQLITE_PATH": str(tmp_path / "test.sqlite3"), "DEVICE_API_KEY": "k"})
    with app.test_client() as test_client:
        yield test_client
    app.extensions["agri_database"].close()


def csrf(client):
    return {"X-CSRF-Token": client.get("/api/csrf").get_json()["csrfToken"]}


def wait_for(predicate, seconds=5.0):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return False


def test_live_stream_is_recorded_and_can_be_replayed(client, camera_url):
    headers = csrf(client)
    assert client.put("/api/zones/1/stream", json={"streamUrl": camera_url}, headers=headers).status_code == 200
    assert client.post("/api/recordings/start", json={"zoneId": 1}).status_code == 403  # CSRF protected

    started = client.post("/api/recordings/start", json={"zoneId": 1}, headers=headers)
    assert started.status_code == 201
    recording_id = started.get_json()["id"]

    # A heartbeat keeps the same recording going
    again = client.post("/api/recordings/start", json={"zoneId": 1}, headers=headers)
    assert again.status_code == 200 and again.get_json()["id"] == recording_id
    assert client.get("/api/recordings/active").get_json()["1"]["id"] == recording_id

    assert wait_for(lambda: client.get("/api/recordings").get_json()[0]["frameCount"] >= 3)
    assert client.post("/api/recordings/stop", json={"zoneId": 1}, headers=headers).get_json()["stopped"]
    assert wait_for(lambda: client.get("/api/recordings").get_json()[0]["status"] == "completed")

    row = client.get("/api/recordings").get_json()[0]
    assert row["zoneName"] == "Zone 1" and row["kind"] == "mjpeg" and row["frameCount"] >= 3
    assert client.get("/api/recordings/active").get_json() == {}

    frame = client.get(f"/api/recordings/{recording_id}/frame?t=0")
    assert frame.status_code == 200 and frame.data == JPEG

    played = client.get(f"/api/recordings/{recording_id}/play")
    assert played.mimetype == "multipart/x-mixed-replace"
    assert JPEG in next(played.response)
    played.close()

    deleted = client.delete(f"/api/recordings/{recording_id}", headers=headers)
    assert deleted.status_code == 200
    assert client.get("/api/recordings").get_json() == []


def test_start_requires_a_saved_stream(client):
    response = client.post("/api/recordings/start", json={"zoneId": 2}, headers=csrf(client))
    assert response.status_code == 409


def test_unreachable_stream_is_marked_failed(client):
    headers = csrf(client)
    client.put("/api/zones/3/stream", json={"streamUrl": "http://127.0.0.1:9/none"}, headers=headers)
    client.post("/api/recordings/start", json={"zoneId": 3}, headers=headers)
    assert wait_for(lambda: client.get("/api/recordings").get_json()[0]["status"] == "failed")
    assert client.get("/api/recordings").get_json()[0]["error"]


def test_recording_can_be_deleted_while_it_is_playing(client):
    recordings.RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
    path = recordings.RECORDINGS_DIR / "1.mjpg"
    with path.open("wb") as handle:
        for i in range(20):
            handle.write(recordings.FRAME_HEADER.pack(i * 200, len(JPEG)) + JPEG)
    database = client.application.extensions["agri_database"]
    database.execute(
        """
        INSERT INTO recordings (id, zone_id, stream_url, status, started_at, file_name, frame_count)
        VALUES (1, 1, 'http://camera', 'completed', '2026-10-27T00:00:00+00:00', '1.mjpg', 20)
        """
    )
    played = client.get("/api/recordings/1/play")
    assert JPEG in next(played.response)  # the player has the file open

    deleted = client.delete("/api/recordings/1", headers=csrf(client))
    assert deleted.status_code == 200
    assert client.get("/api/recordings").get_json() == []

    played.close()  # the player stops; the file is removed once it is released
    assert wait_for(lambda: not path.exists())


def test_starting_the_api_never_deletes_recording_files(tmp_path):
    recordings.RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
    kept = [recordings.RECORDINGS_DIR / "29.mjpg", recordings.RECORDINGS_DIR / "29-boxes.jsonl"]
    for path in kept:
        path.write_bytes(b"data")
    # A database that does not list them (e.g. a different/empty database) must not remove them
    app = create_app({"TESTING": True, "SQLITE_PATH": str(tmp_path / "other.sqlite3"), "DEVICE_API_KEY": "k"})
    app.extensions["agri_database"].close()
    assert all(path.exists() for path in kept)
