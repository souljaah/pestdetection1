"""Server-side recording of live camera streams, so a live session can be rewatched later.

While a camera is live on the Live Monitoring page the browser sends a heartbeat
(POST /api/recordings/start) every few seconds. The API opens the zone's stream itself and
writes it to instance/recordings/; the recording ends when the heartbeats stop, the page
asks to stop, or the stream drops. One row per recording is kept in the `recordings` table.

Supported streams:
  - MJPEG (multipart/x-mixed-replace, e.g. ESP32-CAM) and single-JPEG snapshot URLs:
    frames are stored as <id>.mjpg = repeated [uint32 ms since start][uint32 length][JPEG]
    and replayed at their original pace as an MJPEG stream.
  - Direct video files (.mp4/.webm): the bytes are saved as-is and served with Range support.
HLS (.m3u8) is not recorded.
"""

from __future__ import annotations

import json
import os
import struct
import threading
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator, cast

from flask import Flask, Response, jsonify, request, send_file

from api.db import PROJECT_ROOT, Database
from api.validation import ValidationError, integer, require_object

RECORDINGS_DIR = Path(os.getenv("RECORDINGS_DIR") or PROJECT_ROOT / "instance" / "recordings")
# Recording stops when the page has not sent a heartbeat for this long (tab closed, page left).
# Generous because browsers slow timers in background tabs to about once a minute.
HEARTBEAT_TIMEOUT_SECONDS = 90
# Long sessions are split into files of at most this length; the next heartbeat starts a new one.
MAX_RECORDING_SECONDS = 30 * 60
# Frames arriving faster than this are skipped to keep files small.
MAX_FPS = 10
SNAPSHOT_FPS = 5
CONNECT_TIMEOUT_SECONDS = 10
FRAME_HEADER = struct.Struct("<II")
BOUNDARY = b"frame"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _display_time(value: str) -> tuple[str, str]:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.strftime("%m/%d/%Y"), parsed.strftime("%I:%M:%S %p")


def boxes_path(recording_id: int) -> Path:
    return RECORDINGS_DIR / f"{recording_id}-boxes.jsonl"


def iter_frames(path: Path, from_ms: int = 0) -> Iterator[tuple[int, bytes]]:
    """Yields (ms since start, JPEG bytes) from a .mjpg recording, starting at from_ms."""
    with path.open("rb") as handle:
        while True:
            header = handle.read(FRAME_HEADER.size)
            if len(header) < FRAME_HEADER.size:
                return
            t_ms, length = FRAME_HEADER.unpack(header)
            if t_ms < from_ms:
                handle.seek(length, os.SEEK_CUR)
                continue
            frame = handle.read(length)
            if len(frame) < length:
                return  # partially written last frame
            yield t_ms, frame


def scan_frames(path: Path) -> tuple[int, int]:
    """(frame count, ms of the last frame) of a .mjpg recording, without reading the JPEGs."""
    count = last = 0
    if not path.exists():
        return 0, 0
    with path.open("rb") as handle:
        while True:
            header = handle.read(FRAME_HEADER.size)
            if len(header) < FRAME_HEADER.size:
                break
            t_ms, length = FRAME_HEADER.unpack(header)
            handle.seek(length, os.SEEK_CUR)
            count, last = count + 1, t_ms
    return count, last


class Recorder(threading.Thread):
    """Reads one camera stream into one recording file until stopped."""

    def __init__(self, recording_id: int, zone_id: int, stream_url: str, on_finish: Callable[["Recorder"], None]):
        super().__init__(name=f"recorder-{recording_id}", daemon=True)
        self.recording_id = recording_id
        self.zone_id = zone_id
        self.stream_url = stream_url
        self.on_finish = on_finish
        self.last_heartbeat = time.monotonic()
        self.started = time.monotonic()
        self.stop_event = threading.Event()
        self.kind = "mjpeg"
        self.path = RECORDINGS_DIR / f"{recording_id}.mjpg"
        self.content_type = "image/jpeg"
        self.frame_count = 0
        self.last_frame_ms = 0
        self.error: str | None = None
        # Receives every JPEG frame as it arrives (the pest detector, api/detection.py).
        self.on_frame: Callable[[int, bytes], None] | None = None
        # Pest boxes found while recording, replayed over the video: one JSON line per model result
        self.boxes_path = boxes_path(recording_id)
        self.boxes_lock = threading.Lock()
        self.had_boxes = False

    def save_boxes(self, boxes: list[dict[str, Any]], width: int, height: int, captured_at: float) -> None:
        """Detector listener: stores the boxes with the time of the frame they were found on."""
        t_ms = int((captured_at - self.started) * 1000)
        # Only while pests are in view, plus one empty entry when they leave (it clears the boxes).
        if t_ms < 0 or (not boxes and not self.had_boxes):
            return
        self.had_boxes = bool(boxes)
        line = json.dumps({"t": t_ms, "w": width, "h": height, "boxes": boxes}, separators=(",", ":"))
        with self.boxes_lock, self.boxes_path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")

    # --------------------------------------------------------------- control
    def heartbeat(self) -> None:
        self.last_heartbeat = time.monotonic()

    def stop(self) -> None:
        self.stop_event.set()

    def should_stop(self) -> bool:
        now = time.monotonic()
        return (
            self.stop_event.is_set()
            or now - self.last_heartbeat > HEARTBEAT_TIMEOUT_SECONDS
            or now - self.started > MAX_RECORDING_SECONDS
        )

    def elapsed_ms(self) -> int:
        return int((time.monotonic() - self.started) * 1000)

    # --------------------------------------------------------------- recording
    def run(self) -> None:
        try:
            RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
            response = urllib.request.urlopen(self.stream_url, timeout=CONNECT_TIMEOUT_SECONDS)
            content_type = (response.headers.get("Content-Type") or "").lower()
            if "mpegurl" in content_type or self.stream_url.lower().split("?")[0].endswith(".m3u8"):
                raise RuntimeError("HLS (.m3u8) streams cannot be recorded.")
            if content_type.startswith("video/") or self._looks_like_video_file():
                self._record_video(response, content_type)
            elif content_type.startswith("image/"):
                self._record_snapshots(response)
            else:
                # multipart/x-mixed-replace, or a camera that does not label its MJPEG stream
                self._record_mjpeg(response)
        except Exception as exc:  # network errors, bad streams: kept on the row for the user
            self.error = str(getattr(exc, "reason", None) or exc)[:300]
        finally:
            self.on_finish(self)

    def _looks_like_video_file(self) -> bool:
        return self.stream_url.lower().split("?")[0].endswith((".mp4", ".webm"))

    def _write_frame(self, handle: Any, frame: bytes) -> None:
        if self.on_frame:
            self.on_frame(self.zone_id, frame)
        t_ms = self.elapsed_ms()
        if self.frame_count and t_ms - self.last_frame_ms < 1000 / MAX_FPS:
            return
        handle.write(FRAME_HEADER.pack(t_ms, len(frame)))
        handle.write(frame)
        handle.flush()
        self.frame_count += 1
        self.last_frame_ms = t_ms

    def _record_mjpeg(self, response: Any) -> None:
        buffer = b""
        with response, self.path.open("wb") as handle:
            while not self.should_stop():
                chunk = response.read1(65536) if hasattr(response, "read1") else response.read(65536)
                if not chunk:
                    break
                buffer += chunk
                # Each JPEG runs from its start-of-image to its end-of-image marker.
                while True:
                    start = buffer.find(b"\xff\xd8")
                    if start < 0:
                        buffer = buffer[-1:]
                        break
                    end = buffer.find(b"\xff\xd9", start + 2)
                    if end < 0:
                        buffer = buffer[start:]
                        if len(buffer) > 8 * 1024 * 1024:
                            raise RuntimeError("The stream did not deliver JPEG frames.")
                        break
                    self._write_frame(handle, buffer[start : end + 2])
                    buffer = buffer[end + 2 :]

    def _record_snapshots(self, response: Any) -> None:
        with self.path.open("wb") as handle:
            frame = response.read()
            response.close()
            while True:
                if frame:
                    self._write_frame(handle, frame)
                if self.should_stop():
                    return
                time.sleep(1 / SNAPSHOT_FPS)
                with urllib.request.urlopen(self.stream_url, timeout=CONNECT_TIMEOUT_SECONDS) as next_response:
                    frame = next_response.read()

    def _record_video(self, response: Any, content_type: str) -> None:
        self.kind = "video"
        self.content_type = content_type.split(";")[0] or "video/mp4"
        extension = "webm" if "webm" in self.content_type else "mp4"
        self.path = RECORDINGS_DIR / f"{self.recording_id}.{extension}"
        with response, self.path.open("wb") as handle:
            while not self.should_stop():
                chunk = response.read(65536)
                if not chunk:
                    break
                handle.write(chunk)
                self.frame_count += 1


def remove_file(path: Path, attempts: int = 60) -> None:
    """Deletes a recording file. Windows refuses while a player still has it open, so keep retrying."""
    for _ in range(attempts):
        try:
            path.unlink(missing_ok=True)
            return
        except PermissionError:
            time.sleep(1)


def register_recordings(
    app: Flask,
    db: Callable[[], Database],
    require_csrf: Callable[[Any], Any],
    on_frame: Callable[[int, bytes], None] | None = None,
    detector: Any = None,  # api.detection.PestDetector: its boxes are saved with each recording
) -> None:
    active: dict[int, Recorder] = {}
    lock = threading.Lock()
    # Deleted recordings: open playback streams stop at their next frame and release the file.
    deleted_ids: set[int] = set()

    def ensure_available() -> None:
        if not db().sqlite_path:
            raise RecordingUnavailable(
                "Recording needs the local Flask API (it stores video on this computer's disk)."
            )

    class RecordingUnavailable(RuntimeError):
        pass

    @app.errorhandler(RecordingUnavailable)
    def recording_unavailable(error: RecordingUnavailable) -> Any:
        return jsonify(error="recording_unavailable", message=str(error)), 503

    def finish(recorder: Recorder) -> None:
        with lock:
            if active.get(recorder.zone_id) is recorder:
                del active[recorder.zone_id]
        if detector is not None:
            detector.remove_listener(recorder.zone_id, recorder.save_boxes)
        size = recorder.path.stat().st_size if recorder.path.exists() else 0
        duration = recorder.last_frame_ms / 1000 if recorder.kind == "mjpeg" else recorder.elapsed_ms() / 1000
        if not recorder.frame_count:
            recorder.path.unlink(missing_ok=True)
            recorder.boxes_path.unlink(missing_ok=True)
            if not recorder.error:
                # Stopped before a single frame arrived: nothing worth keeping.
                db().execute("DELETE FROM recordings WHERE id = ?", [recorder.recording_id])
                return
        db().execute(
            """
            UPDATE recordings
            SET status = ?, kind = ?, file_name = ?, content_type = ?, ended_at = ?,
                duration_seconds = ?, frame_count = ?, size_bytes = ?, error = ?
            WHERE id = ?
            """,
            [
                "failed" if recorder.error and not recorder.frame_count else "completed",
                recorder.kind,
                recorder.path.name if recorder.frame_count else None,
                recorder.content_type,
                _now(),
                round(duration, 1),
                recorder.frame_count,
                size,
                recorder.error,
                recorder.recording_id,
            ],
        )

    def close_stale_rows() -> None:
        """Rows left 'recording' by a previous API process that stopped mid-recording."""
        database = cast(Database | None, app.extensions.get("agri_database"))
        if database is None or not database.sqlite_path:
            return
        try:
            rows = database.query("SELECT id, kind, file_name FROM recordings WHERE status = 'recording'")
        except Exception:
            return  # table not migrated yet
        # Never delete files here: only DELETE /api/recordings/<id> removes recording files.
        for row in rows:
            path = next(RECORDINGS_DIR.glob(f"{row['id']}.*"), RECORDINGS_DIR / f"{row['id']}.mjpg")
            frames, last_ms = scan_frames(path) if path.suffix == ".mjpg" else (1 if path.exists() else 0, 0)
            database.execute(
                """
                UPDATE recordings
                SET status = 'completed', kind = ?, content_type = ?, file_name = ?,
                    ended_at = COALESCE(ended_at, ?),
                    duration_seconds = CASE WHEN ? > 0 THEN ? ELSE duration_seconds END,
                    frame_count = ?, size_bytes = ?
                WHERE id = ?
                """,
                [
                    "mjpeg" if path.suffix == ".mjpg" else "video",
                    "image/jpeg" if path.suffix == ".mjpg" else f"video/{path.suffix.lstrip('.')}",
                    path.name if frames else None,
                    _now(),
                    last_ms,
                    round(last_ms / 1000, 1),
                    frames,
                    path.stat().st_size if path.exists() else 0,
                    row["id"],
                ],
            )

    close_stale_rows()

    def recording_payload(row: dict[str, Any]) -> dict[str, Any]:
        date, time_text = _display_time(row["started_at"])
        return {
            "id": row["id"],
            "zoneId": row["zone_id"],
            "zoneName": row["zone_name"],
            "camera": row["camera_name"],
            "streamUrl": row["stream_url"],
            "kind": row["kind"],
            "status": row["status"],
            "startedAt": row["started_at"],
            "endedAt": row["ended_at"],
            "date": date,
            "time": time_text,
            "durationSeconds": row["duration_seconds"] or 0,
            "frameCount": row["frame_count"] or 0,
            "sizeBytes": row["size_bytes"] or 0,
            "error": row["error"],
            "hasDetections": boxes_path(row["id"]).exists(),
        }

    recording_select = """
        SELECT r.*, z.name AS zone_name, COALESCE(c.name, 'Unknown camera') AS camera_name
        FROM recordings r
        JOIN zones z ON z.id = r.zone_id
        LEFT JOIN cameras c ON c.id = r.camera_id
    """

    def live_values(payload: dict[str, Any]) -> dict[str, Any]:
        """Fills in the duration/size of a recording that is still being written."""
        recorder = active.get(payload["zoneId"])
        if payload["status"] == "recording" and recorder and recorder.recording_id == payload["id"]:
            payload["durationSeconds"] = round(recorder.elapsed_ms() / 1000, 1)
            payload["frameCount"] = recorder.frame_count
            payload["sizeBytes"] = recorder.path.stat().st_size if recorder.path.exists() else 0
        return payload

    def get_recording(recording_id: int) -> dict[str, Any] | None:
        row = db().query_one(f"{recording_select} WHERE r.id = ?", [recording_id])
        return live_values(recording_payload(row)) if row else None

    def zone_id_from_body() -> int:
        return cast(int, integer(require_object(request.get_json(silent=True)), "zoneId", minimum=1))

    @app.post("/api/recordings/start")
    @require_csrf
    def start_recording() -> Any:
        """Starts recording a zone's saved stream, or keeps the current recording going (heartbeat)."""
        ensure_available()
        zone_id = zone_id_from_body()
        camera = db().query_one("SELECT id, stream_url FROM cameras WHERE zone_id = ?", [zone_id])
        if not camera:
            raise ValidationError("zoneId does not reference an existing camera.")
        stream_url = camera["stream_url"] or ""
        if not stream_url:
            return jsonify(error="no_stream", message="This zone has no stream URL saved in the database yet."), 409

        with lock:
            recorder = active.get(zone_id)
            if recorder and recorder.stream_url == stream_url and not recorder.should_stop():
                recorder.heartbeat()
                return jsonify(get_recording(recorder.recording_id))
            if recorder:
                recorder.stop()  # URL changed or file reached its maximum length

            result = db().execute(
                """
                INSERT INTO recordings (zone_id, camera_id, stream_url, status, started_at)
                VALUES (?, ?, ?, 'recording', ?)
                """,
                [zone_id, camera["id"], stream_url, _now()],
            )
            recorder = Recorder(cast(int, result.last_insert_rowid), zone_id, stream_url, finish)
            recorder.on_frame = on_frame
            if detector is not None:
                detector.add_listener(zone_id, recorder.save_boxes)
            active[zone_id] = recorder
            recorder.start()
        return jsonify(get_recording(recorder.recording_id)), 201

    @app.post("/api/recordings/stop")
    @require_csrf
    def stop_recording() -> Any:
        zone_id = zone_id_from_body()
        with lock:
            recorder = active.get(zone_id)
        if recorder:
            recorder.stop()
        return jsonify(zoneId=zone_id, stopped=bool(recorder))

    @app.get("/api/recordings/active")
    def active_recordings() -> Any:
        with lock:
            recorders = list(active.values())
        return jsonify(
            {
                str(r.zone_id): {"id": r.recording_id, "durationSeconds": round(r.elapsed_ms() / 1000, 1)}
                for r in recorders
                if not r.should_stop()
            }
        )

    @app.get("/api/recordings")
    def recordings() -> Any:
        clauses: list[str] = []
        args: list[Any] = []
        if request.args.get("zoneId"):
            try:
                clauses.append("r.zone_id = ?")
                args.append(int(cast(str, request.args["zoneId"])))
            except ValueError as exc:
                raise ValidationError("zoneId must be an integer.") from exc
        try:
            limit = min(max(int(request.args.get("limit", "200")), 1), 500)
        except ValueError as exc:
            raise ValidationError("limit must be an integer.") from exc
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = db().query(f"{recording_select}{where} ORDER BY r.started_at DESC LIMIT ?", [*args, limit])
        return jsonify([live_values(recording_payload(row)) for row in rows])

    def recording_file(recording_id: int) -> tuple[dict[str, Any], Path]:
        row = db().query_one("SELECT * FROM recordings WHERE id = ?", [recording_id])
        if not row:
            raise RecordingNotFound("Recording not found.")
        path = RECORDINGS_DIR / (row["file_name"] or f"{recording_id}.mjpg")
        if not path.exists():
            raise RecordingNotFound("The recording file is missing from instance/recordings.")
        return row, path

    class RecordingNotFound(RuntimeError):
        pass

    @app.errorhandler(RecordingNotFound)
    def recording_not_found(error: RecordingNotFound) -> Any:
        return jsonify(error="not_found", message=str(error)), 404

    def start_ms() -> int:
        try:
            return max(int(float(request.args.get("t", "0")) * 1000), 0)
        except ValueError as exc:
            raise ValidationError("t must be a number of seconds.") from exc

    @app.get("/api/recordings/<int:recording_id>/play")
    def play_recording(recording_id: int) -> Any:
        """MJPEG recordings replay at their recorded pace (use in an <img>); video files are sent as-is."""
        row, path = recording_file(recording_id)
        if row["kind"] == "video":
            return send_file(path, mimetype=row["content_type"] or "video/mp4", conditional=True)

        from_ms = start_ms()

        def stream() -> Iterator[bytes]:
            began = time.monotonic()
            for t_ms, frame in iter_frames(path, from_ms):
                delay = (t_ms - from_ms) / 1000 - (time.monotonic() - began)
                if delay > 0:
                    time.sleep(delay)
                if recording_id in deleted_ids:
                    return
                yield (
                    b"--" + BOUNDARY + b"\r\nContent-Type: image/jpeg\r\n"
                    + f"Content-Length: {len(frame)}\r\n\r\n".encode() + frame + b"\r\n"
                )

        return Response(
            stream(),
            mimetype=f"multipart/x-mixed-replace; boundary={BOUNDARY.decode()}",
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/api/recordings/<int:recording_id>/frame")
    def recording_frame(recording_id: int) -> Any:
        """The single frame at ?t=seconds (shown while paused or seeking)."""
        row, path = recording_file(recording_id)
        if row["kind"] == "video":
            raise ValidationError("Single frames are only available for MJPEG recordings.")
        frame = next((f for _, f in iter_frames(path, start_ms())), None)
        if frame is None:
            raise RecordingNotFound("No frame at that time.")
        return Response(frame, mimetype="image/jpeg", headers={"Cache-Control": "max-age=3600"})

    @app.delete("/api/recordings/<int:recording_id>")
    @require_csrf
    def delete_recording(recording_id: int) -> Any:
        row = db().query_one("SELECT * FROM recordings WHERE id = ?", [recording_id])
        if not row:
            raise RecordingNotFound("Recording not found.")
        if row["status"] == "recording":
            return jsonify(error="recording_in_progress", message="Stop the live feed before deleting this recording."), 409
        db().execute("DELETE FROM recordings WHERE id = ?", [recording_id])
        deleted_ids.add(recording_id)
        paths = [boxes_path(recording_id)] + ([RECORDINGS_DIR / row["file_name"]] if row["file_name"] else [])
        for path in paths:
            try:
                path.unlink(missing_ok=True)
            except PermissionError:
                # Still open in a player (Windows locks open files): delete it once it is released.
                threading.Thread(target=remove_file, args=(path,), daemon=True).start()
        return jsonify(id=recording_id, deleted=True)

    @app.get("/api/recordings/<int:recording_id>/boxes")
    def recording_boxes(recording_id: int) -> Any:
        """The pest boxes saved while this was recorded: [{t: ms, w, h, boxes: [...]}] in time order."""
        if not db().query_one("SELECT id FROM recordings WHERE id = ?", [recording_id]):
            raise RecordingNotFound("Recording not found.")
        entries = []
        path = boxes_path(recording_id)
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                try:
                    entries.append(json.loads(line))
                except ValueError:
                    pass  # partially written last line
        return jsonify(entries)
