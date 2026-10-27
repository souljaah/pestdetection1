from __future__ import annotations

import hmac
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from functools import wraps
from typing import Any, Callable, TypeVar, cast
from urllib.parse import urlparse

from flask import Flask, jsonify, make_response, request
from werkzeug.exceptions import HTTPException

from api.db import SCHEMA_PATH, Database, DatabaseConfigurationError
from api.detection import register_detection
from api.recordings import register_recordings
from api.validation import (
    DETECTION_STATUSES,
    SPRAY_STATUSES,
    ValidationError,
    boolean,
    choice,
    integer,
    number,
    optional_box,
    optional_stream_url,
    require_object,
    required_text,
    timestamp,
)

F = TypeVar("F", bound=Callable[..., Any])


def _display_time(value: str) -> tuple[str, str]:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.strftime("%m/%d/%Y"), parsed.strftime("%I:%M %p")


def _limit() -> int:
    raw = request.args.get("limit", "100")
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValidationError("limit must be an integer.") from exc
    if value < 1 or value > 500:
        raise ValidationError("limit must be between 1 and 500.")
    return value


def _json_body() -> dict[str, Any]:
    return require_object(request.get_json(silent=True))


def create_app(test_config: dict[str, Any] | None = None) -> Flask:
    app = Flask(__name__)
    app.config.from_mapping(
        DEVICE_API_KEY=os.getenv("DEVICE_API_KEY", ""),
        SQLITE_PATH=None,
        CURRENT_DETECTION_WINDOW_SECONDS=int(
            os.getenv("CURRENT_DETECTION_WINDOW_SECONDS", "30")
        ),
        # Create/upgrade the schema on startup for a local SQLite file (idempotent).
        AUTO_MIGRATE=os.getenv("AUTO_MIGRATE", "1") == "1",
        ALLOWED_ORIGINS={
            value.strip()
            for value in os.getenv("ALLOWED_ORIGINS", "").split(",")
            if value.strip()
        },
    )
    if test_config:
        app.config.update(test_config)

    try:
        database = Database.from_environment(app.config.get("SQLITE_PATH"))
        app.config["DATABASE_ERROR"] = None
    except DatabaseConfigurationError as exc:
        database = None
        app.config["DATABASE_ERROR"] = str(exc)

    if database is not None and database.sqlite_path and app.config["AUTO_MIGRATE"]:
        database.execute_script(SCHEMA_PATH.read_text(encoding="utf-8"))

    app.extensions["agri_database"] = database

    def db() -> Database:
        configured = cast(Database | None, app.extensions["agri_database"])
        if configured is None:
            raise DatabaseConfigurationError(
                cast(str, app.config["DATABASE_ERROR"])
            )
        return configured

    def require_device_key(view: F) -> F:
        @wraps(view)
        def wrapped(*args: Any, **kwargs: Any) -> Any:
            expected = cast(str, app.config["DEVICE_API_KEY"])
            supplied = request.headers.get("Authorization", "")
            token = supplied[7:] if supplied.startswith("Bearer ") else request.headers.get("X-API-Key", "")
            if not expected:
                return jsonify(error="server_not_configured", message="DEVICE_API_KEY is not configured."), 503
            if not token or not hmac.compare_digest(token, expected):
                return jsonify(error="unauthorized", message="A valid device API key is required."), 401
            return view(*args, **kwargs)

        return cast(F, wrapped)

    def csrf_failure() -> Any:
        """Return an error response unless the request carries a valid same-origin CSRF token."""
        cookie_token = request.cookies.get("agri_csrf", "")
        header_token = request.headers.get("X-CSRF-Token", "")
        if not cookie_token or not header_token or not hmac.compare_digest(cookie_token, header_token):
            return jsonify(error="forbidden", message="A valid CSRF token is required."), 403

        origin = request.headers.get("Origin")
        if origin:
            parsed = urlparse(origin)
            if parsed.netloc != request.host and origin not in app.config["ALLOWED_ORIGINS"]:
                return jsonify(error="forbidden", message="Origin is not allowed."), 403
        return None

    def require_csrf(view: F) -> F:
        """Dashboard writes: same-origin cookie/header CSRF protection."""

        @wraps(view)
        def wrapped(*args: Any, **kwargs: Any) -> Any:
            return csrf_failure() or view(*args, **kwargs)

        return cast(F, wrapped)

    def issue_csrf(payload: dict[str, Any]) -> Any:
        csrf_token = secrets.token_urlsafe(32)
        payload["csrfToken"] = csrf_token
        response = make_response(jsonify(payload))
        response.set_cookie(
            "agri_csrf",
            csrf_token,
            secure=request.is_secure,
            httponly=False,
            samesite="Strict",
            max_age=3600,
        )
        return response

    def not_found_error(message: str) -> Any:
        return jsonify(error="not_found", message=message), 404

    @app.after_request
    def restricted_cors(response: Any) -> Any:
        origin = request.headers.get("Origin")
        if origin and origin in app.config["ALLOWED_ORIGINS"]:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-API-Key, X-CSRF-Token"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, OPTIONS"
        return response

    @app.errorhandler(ValidationError)
    def validation_error(error: ValidationError) -> Any:
        return jsonify(error="validation_error", message=str(error)), 400

    @app.errorhandler(sqlite3.IntegrityError)
    def integrity_error(_: sqlite3.IntegrityError) -> Any:
        # A CHECK/FOREIGN KEY/UNIQUE constraint rejected the write; nothing was saved.
        return jsonify(error="constraint_violation", message="The data violates a database constraint."), 400

    @app.errorhandler(DatabaseConfigurationError)
    def database_configuration_error(error: DatabaseConfigurationError) -> Any:
        return jsonify(error="database_unavailable", message=str(error)), 503

    @app.errorhandler(404)
    def not_found(_: Any) -> Any:
        return jsonify(error="not_found", message="API route not found."), 404

    @app.errorhandler(Exception)
    def unexpected_error(error: Exception) -> Any:
        if isinstance(error, HTTPException):
            return jsonify(error="request_error", message=error.description), error.code
        app.logger.exception("Unhandled API error")
        return jsonify(error="internal_error", message="An unexpected server error occurred."), 500

    @app.get("/api/health")
    def health() -> Any:
        if app.config["DATABASE_ERROR"]:
            return jsonify(status="degraded", database=False, message=app.config["DATABASE_ERROR"]), 503
        try:
            healthy = db().ping()
        except Exception:
            app.logger.exception("Database health check failed")
            return jsonify(status="degraded", database=False), 503
        if healthy:
            try:
                missing_tables = db().missing_tables()
                missing_columns = db().missing_columns()
            except Exception:
                app.logger.exception("Database schema check failed")
                return jsonify(status="degraded", database=True, schema=False), 503
            if missing_tables or missing_columns:
                return jsonify(
                    status="degraded",
                    database=True,
                    schema=False,
                    missingTables=missing_tables,
                    missingColumns=missing_columns,
                    message="Database schema migration is required.",
                ), 503
        return jsonify(status="ok" if healthy else "degraded", database=healthy), 200 if healthy else 503

    @app.get("/api/csrf")
    def csrf_token() -> Any:
        return issue_csrf({})

    @app.get("/api/zones")
    def zones() -> Any:
        rows = db().query(
            """
            SELECT z.id, z.name, z.spray_status, c.camera_code, c.status AS camera_status,
                   c.stream_url,
                   COALESCE(
                     (SELECT d.pest_class FROM detections d
                      WHERE d.zone_id = z.id ORDER BY d.detected_at DESC LIMIT 1),
                     ''
                   ) AS pest_class,
                   (SELECT d.confidence FROM detections d
                    WHERE d.zone_id = z.id ORDER BY d.detected_at DESC LIMIT 1) AS confidence,
                   (SELECT d.detected_at FROM detections d
                    WHERE d.zone_id = z.id ORDER BY d.detected_at DESC LIMIT 1) AS last_detection
            FROM zones z LEFT JOIN cameras c ON c.zone_id = z.id ORDER BY z.id
            """
        )
        payload = []
        for row in rows:
            last = row["last_detection"]
            payload.append(
                {
                    "id": row["id"],
                    "name": row["name"],
                    "cameraId": row["camera_code"],
                    "cameraStatus": row["camera_status"] or "offline",
                    "detectionStatus": "detected" if row["pest_class"] else "clear",
                    "sprayStatus": row["spray_status"],
                    "pestClass": row["pest_class"] or None,
                    "confidence": row["confidence"],
                    "lastDetection": _display_time(last)[1] if last else None,
                    "imageUrl": "",
                    "streamUrl": row["stream_url"] or "",
                }
            )
        return jsonify(payload)

    @app.put("/api/zones/<int:zone_id>/stream")
    @require_csrf
    def update_zone_stream(zone_id: int) -> Any:
        stream_url = optional_stream_url(_json_body(), "streamUrl")
        result = db().execute(
            """
            UPDATE cameras
            SET stream_url = ?, status = CASE WHEN ? IS NULL THEN 'offline' ELSE status END,
                updated_at = CURRENT_TIMESTAMP
            WHERE zone_id = ?
            """,
            [stream_url, stream_url, zone_id],
        )
        if result.rows_affected == 0:
            return not_found_error("No camera exists for that zone.")
        return jsonify(zoneId=zone_id, streamUrl=stream_url or "")

    @app.get("/api/cameras")
    def cameras() -> Any:
        rows = db().query(
            """
            SELECT c.*, z.name AS zone_name
            FROM cameras c JOIN zones z ON z.id = c.zone_id ORDER BY c.id
            """
        )
        return jsonify(
            [
                {
                    "id": row["id"],
                    "name": row["name"],
                    "zone": row["zone_name"],
                    "zoneId": row["zone_id"],
                    "status": row["status"],
                    "signal": row["signal"],
                    "lastUpdate": row["last_seen_at"],
                    "ip": row["ip_address"],
                    "frameRate": row["frame_rate"] or 0,
                    "resolution": row["resolution"] or "—",
                    "streamUrl": row["stream_url"] or "",
                }
                for row in rows
            ]
        )

    @app.get("/api/cameras/telemetry")
    def camera_telemetry() -> Any:
        rows = db().query("SELECT zone_id, signal, frame_rate, resolution FROM cameras ORDER BY zone_id")
        return jsonify(
            {
                str(row["zone_id"]): {
                    "signal": row["signal"],
                    "fps": row["frame_rate"],
                    "resolution": row["resolution"],
                }
                for row in rows
            }
        )

    def detection_payload(row: dict[str, Any]) -> dict[str, Any]:
        date, time = _display_time(row["detected_at"])
        payload: dict[str, Any] = {
            "id": str(row["id"]),
            "zoneId": row["zone_id"],
            "zoneName": row["zone_name"],
            "camera": row["camera_name"],
            "pestClass": row["pest_class"],
            "confidence": row["confidence"],
            "status": row["status"],
            "date": date,
            "time": time,
            "detectedAt": row["detected_at"],
        }
        if row["box_x"] is not None:
            payload["box"] = {
                "x": row["box_x"],
                "y": row["box_y"],
                "w": row["box_w"],
                "h": row["box_h"],
            }
        return payload

    detection_select = """
        SELECT d.*, z.name AS zone_name, COALESCE(c.name, 'Unknown camera') AS camera_name
        FROM detections d
        JOIN zones z ON z.id = d.zone_id
        LEFT JOIN cameras c ON c.id = d.camera_id
    """

    @app.get("/api/detections")
    def detections() -> Any:
        clauses: list[str] = []
        args: list[Any] = []
        if request.args.get("range") == "today":
            clauses.append("d.detected_at >= ?")
            args.append(datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00+00:00"))
        if request.args.get("zoneId"):
            try:
                zone_id = int(cast(str, request.args["zoneId"]))
            except ValueError as exc:
                raise ValidationError("zoneId must be an integer.") from exc
            clauses.append("d.zone_id = ?")
            args.append(zone_id)
        status = request.args.get("status")
        if status:
            if status not in DETECTION_STATUSES:
                raise ValidationError("Invalid detection status.")
            clauses.append("d.status = ?")
            args.append(status)
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        args.append(_limit())
        rows = db().query(f"{detection_select}{where} ORDER BY d.detected_at DESC LIMIT ?", args)
        return jsonify([detection_payload(row) for row in rows])

    @app.get("/api/detections/current")
    def current_detections() -> Any:
        cutoff = datetime.now(timezone.utc) - timedelta(
            seconds=app.config["CURRENT_DETECTION_WINDOW_SECONDS"]
        )
        rows = db().query(
            f"""
            {detection_select}
            JOIN (
              SELECT zone_id, MAX(detected_at) AS latest
              FROM detections
              WHERE status != 'false_positive' AND detected_at >= ?
              GROUP BY zone_id
            ) latest ON latest.zone_id = d.zone_id AND latest.latest = d.detected_at
            """,
            [cutoff.isoformat()],
        )
        return jsonify(
            {
                str(row["zone_id"]): {
                    "pestClass": row["pest_class"],
                    "confidence": row["confidence"],
                    **(
                        {
                            "box": {
                                "x": row["box_x"],
                                "y": row["box_y"],
                                "w": row["box_w"],
                                "h": row["box_h"],
                            }
                        }
                        if row["box_x"] is not None
                        else {}
                    ),
                }
                for row in rows
            }
        )

    @app.post("/api/detections")
    @require_device_key
    def create_detection() -> Any:
        data = _json_body()
        zone_id = cast(int, integer(data, "zoneId", minimum=1))
        pest_class = required_text(data, "pestClass", maximum=80)
        confidence = number(data, "confidence", minimum=0, maximum=100)
        status = choice(data, "status", DETECTION_STATUSES, "confirmed")
        detected_at = timestamp(data, "detectedAt")
        box_x, box_y, box_w, box_h = optional_box(data)
        zone = db().query_one(
            """
            SELECT z.name, c.id AS camera_id
            FROM zones z LEFT JOIN cameras c ON c.zone_id = z.id WHERE z.id = ?
            """,
            [zone_id],
        )
        if not zone:
            raise ValidationError("zoneId does not reference an existing zone.")
        detail = f"{pest_class} — {confidence:.1f}% confidence"
        # The detection, its history event and its alert are saved together or not at all.
        result, _, _ = db().batch(
            [
                (
                    """
                    INSERT INTO detections
                      (zone_id, camera_id, pest_class, confidence, status, box_x, box_y, box_w, box_h, detected_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [zone_id, zone["camera_id"], pest_class, confidence, status, box_x, box_y, box_w, box_h, detected_at],
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
        row = db().query_one(f"{detection_select} WHERE d.id = ?", [result.last_insert_rowid])
        return jsonify(detection_payload(cast(dict[str, Any], row))), 201

    def spray_payload(row: dict[str, Any]) -> dict[str, Any]:
        date, time = _display_time(row["activated_at"])
        return {
            "id": str(row["id"]),
            "zoneId": row["zone_id"],
            "zoneName": row["zone_name"],
            "trigger": row["trigger"],
            "duration": row["duration"],
            "status": row["status"],
            "date": date,
            "time": time,
            "activatedAt": row["activated_at"],
        }

    spray_select = """
        SELECT s.*, z.name AS zone_name
        FROM spray_logs s JOIN zones z ON z.id = s.zone_id
    """

    @app.get("/api/sprays")
    def sprays() -> Any:
        rows = db().query(f"{spray_select} ORDER BY s.activated_at DESC LIMIT ?", [_limit()])
        return jsonify([spray_payload(row) for row in rows])

    @app.post("/api/sprays/trigger")
    @require_device_key
    def trigger_spray() -> Any:
        data = _json_body()
        zone_id = cast(int, integer(data, "zoneId", minimum=1))
        trigger = required_text(data, "trigger", maximum=160)
        duration = cast(int, integer(data, "duration", minimum=1, maximum=30))
        status = choice(data, "status", SPRAY_STATUSES, "active")
        activated_at = timestamp(data, "activatedAt")
        zone = db().query_one("SELECT name FROM zones WHERE id = ?", [zone_id])
        if not zone:
            raise ValidationError("zoneId does not reference an existing zone.")
        # The spray log, its history event and its alert are saved together or not at all.
        result, _, _ = db().batch(
            [
                (
                    """
                    INSERT INTO spray_logs (zone_id, trigger, duration, status, activated_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    [zone_id, trigger, duration, status, activated_at],
                ),
                (
                    """
                    INSERT INTO system_events (zone_id, event_type, event, detail, occurred_at)
                    VALUES (?, 'spray_start', 'Sprayer Activated', ?, ?)
                    """,
                    [zone_id, f"{duration} seconds duration", activated_at],
                ),
                (
                    """
                    INSERT INTO alerts (zone_id, alert_type, message, detail, created_at)
                    VALUES (?, 'spray_activated', 'SPRAY ACTIVATED', ?, ?)
                    """,
                    [zone_id, f"{zone['name']} sprayer activated for {duration} seconds", activated_at],
                ),
            ]
        )
        row = db().query_one(f"{spray_select} WHERE s.id = ?", [result.last_insert_rowid])
        return jsonify(spray_payload(cast(dict[str, Any], row))), 201

    @app.get("/api/events")
    def events() -> Any:
        rows = db().query(
            """
            SELECT e.*, COALESCE(z.name, 'System') AS zone_name
            FROM system_events e LEFT JOIN zones z ON z.id = e.zone_id
            ORDER BY e.occurred_at DESC LIMIT ?
            """,
            [_limit()],
        )
        return jsonify(
            [
                {
                    "id": str(row["id"]),
                    "type": row["event_type"],
                    "date": _display_time(row["occurred_at"])[0],
                    "time": _display_time(row["occurred_at"])[1],
                    "zone": row["zone_name"],
                    "event": row["event"],
                    "detail": row["detail"],
                }
                for row in rows
            ]
        )

    @app.get("/api/alerts")
    def alerts() -> Any:
        rows = db().query(
            """
            SELECT a.*, COALESCE(z.name, 'System') AS zone_name
            FROM alerts a LEFT JOIN zones z ON z.id = a.zone_id
            WHERE a.acknowledged = 0 ORDER BY a.created_at DESC LIMIT ?
            """,
            [_limit()],
        )
        return jsonify(
            [
                {
                    "id": str(row["id"]),
                    "type": row["alert_type"],
                    "message": row["message"],
                    "detail": row["detail"],
                    "timestamp": _display_time(row["created_at"])[1],
                    "zoneName": row["zone_name"],
                }
                for row in rows
            ]
        )

    @app.get("/api/system-status")
    def system_status() -> Any:
        database_ok = db().ping()
        counts = db().query_one(
            """
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) AS online
            FROM cameras
            """
        ) or {"total": 0, "online": 0}
        return jsonify(
            {
                "controller": {"ok": False, "detail": "No controller heartbeat reported"},
                "model": {"ok": False, "detail": "No detection service heartbeat reported"},
                "sprayController": {"ok": False, "detail": "No spray controller heartbeat reported"},
                "database": {"ok": database_ok, "detail": f"{db().backend_name} connected" if database_ok else "Database unavailable"},
                "network": {"ok": True, "detail": "Flask API responding"},
                "camerasOnline": counts["online"] or 0,
                "camerasTotal": counts["total"],
            }
        )

    def settings_payload(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "threshold": row["threshold"],
            "sprayDuration": row["spray_duration"],
            "autoSpray": bool(row["auto_spray"]),
            "notifications": bool(row["notifications"]),
        }

    @app.get("/api/settings")
    def get_settings() -> Any:
        row = db().query_one("SELECT * FROM system_settings WHERE id = 1")
        return issue_csrf(settings_payload(cast(dict[str, Any], row)))

    @app.put("/api/settings")
    @require_csrf
    def update_settings() -> Any:
        data = _json_body()
        threshold = cast(int, integer(data, "threshold", minimum=50, maximum=99))
        spray_duration = cast(int, integer(data, "sprayDuration", minimum=1, maximum=30))
        auto_spray = boolean(data, "autoSpray")
        notifications = boolean(data, "notifications")
        db().execute(
            """
            UPDATE system_settings
            SET threshold = ?, spray_duration = ?, auto_spray = ?, notifications = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = 1
            """,
            [threshold, spray_duration, auto_spray, notifications],
        )
        row = db().query_one("SELECT * FROM system_settings WHERE id = 1")
        return jsonify(settings_payload(cast(dict[str, Any], row)))

    detector = register_detection(app, db)
    register_recordings(app, db, require_csrf, on_frame=detector.feed, detector=detector)

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("API_PORT", "5001")), debug=True)
