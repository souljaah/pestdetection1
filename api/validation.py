from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


class ValidationError(ValueError):
    pass


DETECTION_STATUSES = {"confirmed", "pending", "false_positive"}
SPRAY_STATUSES = {"active", "completed", "failed", "cancelled"}


def require_object(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValidationError("Request body must be a JSON object.")
    return value


def required_text(
    data: dict[str, Any], key: str, *, maximum: int = 120
) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{key} is required.")
    value = value.strip()
    if len(value) > maximum:
        raise ValidationError(f"{key} must be at most {maximum} characters.")
    return value


def integer(
    data: dict[str, Any],
    key: str,
    *,
    minimum: int | None = None,
    maximum: int | None = None,
    required: bool = True,
) -> int | None:
    value = data.get(key)
    if value is None and not required:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValidationError(f"{key} must be an integer.")
    if minimum is not None and value < minimum:
        raise ValidationError(f"{key} must be at least {minimum}.")
    if maximum is not None and value > maximum:
        raise ValidationError(f"{key} must be at most {maximum}.")
    return value


def number(
    data: dict[str, Any],
    key: str,
    *,
    minimum: float,
    maximum: float,
) -> float:
    value = data.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValidationError(f"{key} must be a number.")
    value = float(value)
    if value < minimum or value > maximum:
        raise ValidationError(f"{key} must be between {minimum} and {maximum}.")
    return value


def boolean(data: dict[str, Any], key: str) -> bool:
    value = data.get(key)
    if not isinstance(value, bool):
        raise ValidationError(f"{key} must be a boolean.")
    return value


def choice(data: dict[str, Any], key: str, allowed: set[str], default: str) -> str:
    value = data.get(key, default)
    if not isinstance(value, str) or value not in allowed:
        raise ValidationError(f"{key} must be one of: {', '.join(sorted(allowed))}.")
    return value


def timestamp(data: dict[str, Any], key: str) -> str:
    value = data.get(key)
    if value is None:
        return datetime.now(timezone.utc).isoformat()
    if not isinstance(value, str):
        raise ValidationError(f"{key} must be an ISO 8601 timestamp.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValidationError(f"{key} must be an ISO 8601 timestamp.") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def optional_stream_url(data: dict[str, Any], key: str) -> str | None:
    """An http(s) URL or a same-origin path; empty/null clears the stream."""
    value = data.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValidationError(f"{key} must be a string.")
    value = value.strip()
    if not value:
        return None
    if len(value) > 2048:
        raise ValidationError(f"{key} must be at most 2048 characters.")
    lowered = value.lower()
    if not (lowered.startswith(("http://", "https://")) or value.startswith("/")):
        raise ValidationError(f"{key} must start with http://, https:// or /.")
    return value


def optional_box(data: dict[str, Any]) -> tuple[float | None, ...]:
    value = data.get("box")
    if value is None:
        return (None, None, None, None)
    value = require_object(value)
    coordinates = tuple(number(value, key, minimum=0, maximum=1) for key in ("x", "y", "w", "h"))
    if coordinates[0] + coordinates[2] > 1 or coordinates[1] + coordinates[3] > 1:
        raise ValidationError("box must fit within normalized frame coordinates.")
    return coordinates
