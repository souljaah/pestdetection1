import time
from pathlib import Path

import pytest

cv2 = pytest.importorskip("cv2")  # installed with requirements-detect.txt
np = pytest.importorskip("numpy")

from api.index import create_app  # noqa: E402


class FakeTensor:
    def __init__(self, values):
        self.values = values

    def tolist(self):
        return self.values


class FakeModel:
    """Stands in for YOLO: always finds one aphid in the top-left quarter."""

    def predict(self, image, conf, verbose):
        boxes = type("Boxes", (), {
            "xyxyn": FakeTensor([[0.1, 0.2, 0.3, 0.5]]),
            "conf": FakeTensor([0.9]),
            "cls": FakeTensor([0]),
        })()
        return [type("Result", (), {"names": {0: "aphid"}, "boxes": boxes})()]


@pytest.fixture()
def app(tmp_path: Path):
    app = create_app({"TESTING": True, "SQLITE_PATH": str(tmp_path / "test.sqlite3"), "DEVICE_API_KEY": "k"})
    yield app
    app.extensions["agri_database"].close()


def test_frames_from_a_live_feed_produce_boxes_and_one_logged_detection(app):
    detector = app.extensions["pest_detector"]
    detector.model = FakeModel()
    frame = cv2.imencode(".jpg", np.zeros((480, 640, 3), dtype=np.uint8))[1].tobytes()
    client = app.test_client()

    deadline = time.monotonic() + 5
    zone = None
    while time.monotonic() < deadline and not (zone and zone["boxes"]):
        detector.feed(2, frame)
        time.sleep(0.05)
        zone = client.get("/api/detections/live").get_json()["zones"].get("2")

    assert zone and zone["width"] == 640 and zone["height"] == 480
    assert zone["boxes"] == [{"pestClass": "Aphid", "confidence": 90.0, "x": 0.1, "y": 0.2, "w": 0.2, "h": 0.3}]

    for _ in range(5):  # more frames with the same pest do not flood the logs
        detector.feed(2, frame)
        time.sleep(0.05)
    detections = client.get("/api/detections").get_json()
    assert [(d["zoneId"], d["pestClass"], d["confidence"]) for d in detections] == [(2, "Aphid", 90.0)]
    assert client.get("/api/detections/current").get_json()["2"]["box"] == {"x": 0.1, "y": 0.2, "w": 0.2, "h": 0.3}
    assert client.get("/api/alerts").get_json()[0]["type"] == "pest_detected"


def test_live_endpoint_reports_status_without_frames(app):
    body = app.test_client().get("/api/detections/live").get_json()
    assert body["zones"] == {}
    assert isinstance(body["available"], bool) and body["message"]


def box(x, conf=80.0):
    return {"pestClass": "Aphid", "confidence": conf, "x": x, "y": 0.5, "w": 0.1, "h": 0.1}


def test_tracking_shows_at_threshold_and_keeps_pests_whose_score_dips():
    from api.detection import track_boxes

    tracks = []
    assert len(track_boxes(tracks, [box(0.1, 86.0)], 85)) == 1  # one frame at the threshold: shown at once
    assert len(track_boxes(tracks, [box(0.11, 78.0)], 85)) == 1  # score dips below it: still followed
    assert len(track_boxes(tracks, [], 85)) == 1  # missed for a frame: still shown
    assert len(track_boxes(tracks, [], 85)) == 1
    assert track_boxes(tracks, [], 85) == []  # gone for 3 frames: removed

    tracks = []
    for _ in range(5):  # only ever below the threshold: never shown
        assert track_boxes(tracks, [box(0.5, 80.0)], 85) == []

    tracks = []
    track_boxes(tracks, [box(0.2, 90.0)], 85)
    # far apart (IoU < 0.3): a different pest, and below the threshold, so only the first is shown
    shown = track_boxes(tracks, [box(0.2, 90.0), box(0.6, 70.0)], 85)
    assert [b["x"] for b in shown] == [0.2] and len(tracks) == 2

    tracks = []
    track_boxes(tracks, [box(0.20, 90.0)], 85)
    smoothed = track_boxes(tracks, [box(0.22, 80.0)], 85)[0]
    assert smoothed["x"] == 0.21 and smoothed["confidence"] == 85.0  # position/confidence averaged


def test_boxes_are_saved_with_the_recording(app, tmp_path, monkeypatch):
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    import api.recordings as recordings

    monkeypatch.setattr(recordings, "RECORDINGS_DIR", tmp_path / "recordings")
    jpeg = cv2.imencode(".jpg", np.zeros((480, 640, 3), dtype=np.uint8))[1].tobytes()

    class Camera(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=cam")
            self.end_headers()
            try:
                for _ in range(200):
                    self.wfile.write(b"--cam\r\nContent-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n")
                    time.sleep(0.05)
            except OSError:
                pass

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Camera)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    app.extensions["pest_detector"].model = FakeModel()
    client = app.test_client()
    headers = {"X-CSRF-Token": client.get("/api/csrf").get_json()["csrfToken"]}
    client.put("/api/zones/1/stream", json={"streamUrl": f"http://127.0.0.1:{server.server_address[1]}/s"}, headers=headers)
    recording_id = client.post("/api/recordings/start", json={"zoneId": 1}, headers=headers).get_json()["id"]

    deadline = time.monotonic() + 5
    while time.monotonic() < deadline and not client.get(f"/api/recordings/{recording_id}/boxes").get_json():
        time.sleep(0.1)
    client.post("/api/recordings/stop", json={"zoneId": 1}, headers=headers)
    server.shutdown()

    entries = client.get(f"/api/recordings/{recording_id}/boxes").get_json()
    assert entries and entries[0]["w"] == 640 and entries[0]["h"] == 480
    assert entries[0]["boxes"][0]["pestClass"] == "Aphid" and entries[0]["t"] >= 0
    assert all(a["t"] <= b["t"] for a, b in zip(entries, entries[1:]))
    assert client.get("/api/recordings").get_json()[0]["hasDetections"] is True

    assert wait_until(lambda: client.get("/api/recordings").get_json()[0]["status"] == "completed")
    client.delete(f"/api/recordings/{recording_id}", headers=headers)
    assert not recordings.boxes_path(recording_id).exists()


def wait_until(predicate, seconds=5.0):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return False
