import { useEffect, useSyncExternalStore } from 'react';
import { isRecord, requestJson } from './api';

/** One box found by the YOLO model on the API (api/detection.py). x/y/w/h are 0–1 fractions of the frame. */
export interface LiveBox {
  pestClass: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LiveZoneDetection {
  boxes: LiveBox[];
  width: number | null; // frame size the model saw, used to line the boxes up with the picture
  height: number | null;
  ageSeconds: number;
}

/** Shape of GET /api/detections/live. */
export interface LiveDetections {
  available: boolean;
  message: string;
  threshold: number;
  zones: Record<string, LiveZoneDetection>;
}

const EMPTY: LiveDetections = { available: false, message: '', threshold: 0, zones: {} };
const POLL_MS = 400;

function isLiveDetections(value: unknown): value is LiveDetections {
  return (
    isRecord(value) &&
    typeof value.available === 'boolean' &&
    typeof value.message === 'string' &&
    isRecord(value.zones)
  );
}

// One shared poll for every camera panel, running only while at least one live feed needs it.
let snap: LiveDetections = EMPTY;
let users = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight = false;
const listeners = new Set<() => void>();

async function poll() {
  timer = undefined;
  inFlight = true;
  try {
    const value = await requestJson<unknown>('/api/detections/live', { timeoutMs: 3000 });
    snap = isLiveDetections(value) ? value : EMPTY;
  } catch {
    snap = EMPTY;
  }
  inFlight = false;
  listeners.forEach(l => l());
  if (users > 0) timer = setTimeout(poll, POLL_MS);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** The model's current boxes for one zone (only polled while `enabled`, i.e. its feed is live). */
export function useLiveDetection(zoneId: string, enabled: boolean) {
  const all = useSyncExternalStore(subscribe, () => snap);

  useEffect(() => {
    if (!enabled) return;
    users += 1;
    if (!inFlight && !timer) void poll();
    return () => {
      users -= 1;
      if (users === 0 && timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    };
  }, [enabled]);

  return {
    zone: enabled ? all.zones[zoneId] ?? null : null,
    available: all.available,
    message: all.message,
    threshold: all.threshold,
  };
}

/** Maps a box from frame fractions to a container that shows the whole frame (`object-fit: contain`). */
export function containBox(box: LiveBox, frameW: number | null, frameH: number | null, containerAspect = 16 / 9) {
  if (!frameW || !frameH) return box;
  const aspect = frameW / frameH;
  if (aspect < containerAspect) {
    const scale = aspect / containerAspect; // bars left and right
    return { ...box, x: (1 - scale) / 2 + box.x * scale, w: box.w * scale };
  }
  const scale = containerAspect / aspect; // bars top and bottom
  return { ...box, y: (1 - scale) / 2 + box.y * scale, h: box.h * scale };
}

/**
 * Maps a box from frame fractions to fractions of a container that shows the frame with
 * `object-fit: cover` (the camera panels are 16:9; a 4:3 camera is cropped top and bottom).
 */
export function coverBox(box: LiveBox, frameW: number | null, frameH: number | null, containerAspect = 16 / 9) {
  if (!frameW || !frameH) return box;
  const aspect = frameW / frameH;
  if (aspect < containerAspect) {
    const scale = containerAspect / aspect; // picture is taller than the panel
    return { ...box, y: box.y * scale - (scale - 1) / 2, h: box.h * scale };
  }
  const scale = aspect / containerAspect; // picture is wider than the panel
  return { ...box, x: box.x * scale - (scale - 1) / 2, w: box.w * scale };
}
