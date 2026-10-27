"""Pest detection on the live camera feeds with the YOLO model in models/ (e.g. aphid_detector_best.pt).

The recorder (api/recordings.py) already reads every frame of a feed that is live on the
Live Monitoring page; it hands each frame to this module, so the camera is not opened twice.
For each zone a worker runs the model on the newest frame and keeps the boxes in memory:

  GET /api/detections/live  ->  boxes per zone, drawn over the feed (refreshed several times a second)

When a pest appears it is also saved like any device detection (detections + system_events +
alerts tables), at most once per LOG_COOLDOWN_SECONDS per zone so the logs are not flooded.
Only boxes at or above the Detection Confidence Threshold (System Settings) count.

Needs `pip install -r requirements-detect.txt` (Ultralytics). Without it, or without a model
file, everything else keeps working and /api/detections/live reports why detection is off.
"""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from flask import Flask, jsonify

from api.db import PROJECT_ROOT, Database

MODELS_DIR = PROJECT_ROOT / "models"
# Boxes older than this are no longer drawn (the feed stopped or the model fell behind).
LIVE_MAX_AGE_SECONDS = 3
LOG_COOLDOWN_SECONDS = 30
# A zone's worker exits when it has received no frame for this long.
IDLE_SECONDS = 10
SETTINGS_REFRESH_SECONDS = 5
DEFAULT_THRESHOLD = 85


# Frame-to-frame smoothing of the live boxes (each zone's feed is a video, not a single photo):
# a pest is shown as soon as one frame reaches the confidence threshold. After that it keeps
# being followed while the model still sees it at up to KEEP_MARGIN points below the threshold
# (scores often hover around it), and through up to HOLD_FRAMES frames the model misses it.
KEEP_MARGIN = 20
HOLD_FRAMES = 2
MATCH_IOU = 0.3
SMOOTHING = 0.5  # weight of the newest frame when averaging a box's position and confidence


def _iou(a: dict[str, Any], b: dict[str, Any]) -> float:
    x1, y1 = max(a["x"], b["x"]), max(a["y"], b["y"])
    x2 = min(a["x"] + a["w"], b["x"] + b["w"])
    y2 = min(a["y"] + a["h"], b["y"] + b["h"])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = a["w"] * a["h"] + b["w"] * b["h"] - inter
    return inter / union if union > 0 else 0.0


def track_boxes(
    tracks: list[dict[str, Any]], found: list[dict[str, Any]], threshold: float = 0
) -> list[dict[str, Any]]:
    """Matches this frame's boxes (found down to threshold - KEEP_MARGIN) to the pests seen
    before, updating `tracks` in place, and returns the smoothed boxes to show: those that
    have reached `threshold` in at least one frame."""
    unmatched = list(range(len(tracks)))
    for box in sorted(found, key=lambda b: -b["confidence"]):
        best, best_iou = None, MATCH_IOU
        for i in unmatched:
            overlap = _iou(tracks[i]["box"], box)
            if overlap >= best_iou:
                best, best_iou = i, overlap
        if best is None:
            tracks.append({"box": dict(box), "hits": 1, "misses": 0, "shown": box["confidence"] >= threshold})
            continue
        unmatched.remove(best)
        track = tracks[best]
        old = track["box"]
        track["box"] = {
            **box,
            **{k: round(old[k] + SMOOTHING * (box[k] - old[k]), 4) for k in ("x", "y", "w", "h")},
            "confidence": round(old["confidence"] + SMOOTHING * (box["confidence"] - old["confidence"]), 1),
        }
        track["hits"] += 1
        track["misses"] = 0
        track["shown"] = track["shown"] or box["confidence"] >= threshold
    for i in unmatched:
        tracks[i]["misses"] += 1
    tracks[:] = [t for t in tracks if t["misses"] <= HOLD_FRAMES]
    return [dict(t["box"]) for t in tracks if t["shown"]]


def model_path() -> Path | None:
    configured = os.getenv("DETECTION_MODEL")
    if configured:
        path = Path(configured)
        return path if path.is_absolute() else PROJECT_ROOT / path
    found = sorted(MODELS_DIR.glob("*.pt")) + sorted(MODELS_DIR.glob("*.onnx"))
    return found[0] if found else None


class PestDetector:
    def __init__(self, db: Callable[[], Database]):
        self.db = db
        self.lock = threading.Lock()
        self.model_lock = threading.Lock()  # YOLO inference is not thread-safe
        self.model: Any = None
        self.model_error: str | None = None
        self.loading = False
        self.frames: dict[int, tuple[bytes, float]] = {}  # newest frame per zone and when it arrived
        self.events: dict[int, threading.Event] = {}
        self.workers: dict[int, threading.Thread] = {}
        self.live: dict[int, dict[str, Any]] = {}
        self.tracks: dict[int, list[dict[str, Any]]] = {}
        # Called with (boxes, frame width, frame height, time.monotonic() the frame arrived);
        # the recorder uses it to save the boxes with the recording.
        self.listeners: dict[int, list[Callable[[list[dict[str, Any]], int, int, float], None]]] = {}
        self.last_logged: dict[int, float] = {}
        self.threshold = DEFAULT_THRESHOLD
        self.threshold_read = 0.0

    # ------------------------------------------------------------------ model
    def status(self) -> tuple[bool, str]:
        if self.model is not None:
            return True, f"{self.model_name} running"
        if self.model_error:
            return False, self.model_error
        try:
            import ultralytics  # noqa: F401
        except ImportError:
            return False, "Install the detector: pip install -r requirements-detect.txt"
        path = model_path()
        if not path or not path.exists():
            return False, f"No model file found in {MODELS_DIR} (or DETECTION_MODEL)."
        return True, "Model loads when a camera feed is live"

    @property
    def model_name(self) -> str:
        path = model_path()
        return path.name if path else "model"

    def _load_model(self) -> None:
        try:
            from ultralytics import YOLO

            path = model_path()
            if not path or not path.exists():
                raise RuntimeError(f"No model file found in {MODELS_DIR} (or DETECTION_MODEL).")
            model = YOLO(str(path))
            self.model = model
        except ImportError:
            self.model_error = "Install the detector: pip install -r requirements-detect.txt"
        except Exception as exc:
            self.model_error = f"The model could not be loaded: {exc}"[:300]
        finally:
            self.loading = False

    def _ensure_model(self) -> bool:
        if self.model is not None:
            return True
        if self.model_error:
            return False
        with self.lock:
            if not self.loading and self.model is None:
                self.loading = True
                threading.Thread(target=self._load_model, name="detector-load", daemon=True).start()
        return False

    # ------------------------------------------------------------------ frames
    def feed(self, zone_id: int, frame: bytes) -> None:
        """Called by the recorder for every frame; never blocks it."""
        if self.model_error:
            return
        with self.lock:
            self.frames[zone_id] = (frame, time.monotonic())
            event = self.events.setdefault(zone_id, threading.Event())
            event.set()
            worker = self.workers.get(zone_id)
            if worker is None or not worker.is_alive():
                worker = threading.Thread(target=self._run, args=(zone_id,), name=f"detector-{zone_id}", daemon=True)
                self.workers[zone_id] = worker
                worker.start()

    def _current_threshold(self) -> int:
        now = time.monotonic()
        if now - self.threshold_read > SETTINGS_REFRESH_SECONDS:
            self.threshold_read = now
            try:
                row = self.db().query_one("SELECT threshold FROM system_settings WHERE id = 1")
                if row:
                    self.threshold = int(row["threshold"])
            except Exception:
                pass
        return self.threshold

    def _run(self, zone_id: int) -> None:
        event = self.events[zone_id]
        while event.wait(IDLE_SECONDS):
            event.clear()
            with self.lock:
                pending = self.frames.pop(zone_id, None)
            if pending is None or not self._ensure_model():
                if self.model_error:
                    return
                continue
            try:
                self._detect(zone_id, *pending)
            except Exception as exc:  # a bad frame must not stop detection
                self.live[zone_id] = {"boxes": [], "at": time.time(), "error": str(exc)[:200]}
        with self.lock:
            if self.workers.get(zone_id) is threading.current_thread():
                del self.workers[zone_id]
        self.live.pop(zone_id, None)
        self.tracks.pop(zone_id, None)

    def add_listener(self, zone_id: int, listener: Callable[[list[dict[str, Any]], int, int, float], None]) -> None:
        with self.lock:
            self.listeners.setdefault(zone_id, []).append(listener)

    def remove_listener(self, zone_id: int, listener: Callable[[list[dict[str, Any]], int, int, float], None]) -> None:
        with self.lock:
            if listener in self.listeners.get(zone_id, []):
                self.listeners[zone_id].remove(listener)

    def _detect(self, zone_id: int, frame: bytes, captured_at: float) -> None:
        import cv2
        import numpy as np

        image = cv2.imdecode(np.frombuffer(frame, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            return
        threshold = self._current_threshold()
        with self.model_lock:
            # Lower than the threshold so pests already on screen are not dropped when their score dips
            result = self.model.predict(image, conf=max(threshold - KEEP_MARGIN, 5) / 100, verbose=False)[0]
        names = result.names
        boxes = []
        for (x1, y1, x2, y2), conf, cls in zip(
            result.boxes.xyxyn.tolist(), result.boxes.conf.tolist(), result.boxes.cls.tolist()
        ):
            boxes.append(
                {
                    "pestClass": str(names.get(int(cls), "pest")).capitalize(),
                    "confidence": round(conf * 100, 1),
                    "x": round(x1, 4),
                    "y": round(y1, 4),
                    "w": round(x2 - x1, 4),
                    "h": round(y2 - y1, 4),
                }
            )
        height, width = image.shape[:2]
        boxes = track_boxes(self.tracks.setdefault(zone_id, []), boxes, threshold)
        self.live[zone_id] = {"boxes": boxes, "at": time.time(), "width": width, "height": height}
        for listener in list(self.listeners.get(zone_id, [])):
            try:
                listener(boxes, width, height, captured_at)
            except Exception:
                pass  # a failing listener must not stop detection
        strong = [b for b in boxes if b["confidence"] >= threshold]
        if strong:
            self._log(zone_id, max(strong, key=lambda b: b["confidence"]))

    def _log(self, zone_id: int, box: dict[str, Any]) -> None:
        """Saves a detection like POST /api/detections does, once per cooldown per zone."""
        now = time.monotonic()
        if now - self.last_logged.get(zone_id, -LOG_COOLDOWN_SECONDS) < LOG_COOLDOWN_SECONDS:
            return
        self.last_logged[zone_id] = now
        zone = self.db().query_one(
            "SELECT z.name, c.id AS camera_id FROM zones z LEFT JOIN cameras c ON c.zone_id = z.id WHERE z.id = ?",
            [zone_id],
        )
        if not zone:
            return
        detected_at = datetime.now(timezone.utc).isoformat()
        detail = f"{box['pestClass']} — {box['confidence']:.1f}% confidence"
        self.db().batch(
            [
                (
                    """
                    INSERT INTO detections
                      (zone_id, camera_id, pest_class, confidence, status, box_x, box_y, box_w, box_h, detected_at)
                    VALUES (?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?)
                    """,
                    [zone_id, zone["camera_id"], box["pestClass"], box["confidence"],
                     box["x"], box["y"], box["w"], box["h"], detected_at],
                ),
                (
                    """
                    INSERT INTO system_events (zone_id, event_type, event, detail, occurred_at)
                    VALUES (?, 'detection', 'Pest Detected', ?, ?)
                    """,
                    [zone_id, detail, detected_at],
                ),
                (
                    """
                    INSERT INTO alerts (zone_id, alert_type, message, detail, created_at)
                    VALUES (?, 'pest_detected', 'PEST DETECTED', ?, ?)
                    """,
                    [zone_id, f"{zone['name']} detected {detail}", detected_at],
                ),
            ]
        )


def register_detection(app: Flask, db: Callable[[], Database]) -> PestDetector:
    detector = PestDetector(db)
    app.extensions["pest_detector"] = detector

    @app.get("/api/detections/live")
    def live_detections() -> Any:
        available, message = detector.status()
        now = time.time()
        return jsonify(
            available=available,
            message=message,
            threshold=detector.threshold,
            zones={
                str(zone_id): {
                    "boxes": state["boxes"],
                    "width": state.get("width"),
                    "height": state.get("height"),
                    "ageSeconds": round(now - state["at"], 2),
                }
                for zone_id, state in list(detector.live.items())
                if now - state["at"] <= LIVE_MAX_AGE_SECONDS
            },
        )

    return detector
