import { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import type { SignalStrength } from '../types';
import { zones as defaultZones } from '../data/mockData';
import { ApiError, isRecord, isRecordArray, setZoneStream } from './api';
import { useApiResource } from './useApiResource';

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */
export type CamState = 'unconfigured' | 'connecting' | 'live' | 'error';

/** Shape your backend/AI model should return for a detection. Box values are 0–1 (fractions of the frame). */
export interface Detection {
  pestClass: string;
  confidence: number;
  box?: { x: number; y: number; w: number; h: number };
}

/** Values only the camera hardware/backend can report. Anything missing is shown as "—". */
export interface CameraTelemetry {
  signal?: SignalStrength;
  fps?: number;
  resolution?: string; // e.g. '1280×720' — overrides the size measured from the stream
}

/** The only pest classes the system detects. Change the list here and every filter follows. */
export const PEST_CLASSES = ['Aphid', 'Whitefly', 'Leafhopper', 'Mealybug'] as const;

const pestStem = (p: string) =>
  p.toLowerCase().replace(/[^a-z]/g, '').replace(/(ies|y|s)$/, '');

/** True if two pest names are the same class, ignoring case and singular/plural ('Aphids' = 'Aphid'). */
export const samePest = (a: string, b: string) => pestStem(a) === pestStem(b);

/** True if free text (e.g. 'Whiteflies detected') mentions the pest class. */
export const mentionsPest = (text: string, pest: string) => text.toLowerCase().includes(pestStem(pest));

/** One crop zone and its camera, from GET /api/zones (SQLite tables zones + cameras). */
export interface ZoneInfo {
  id: number;
  name: string;
  cameraId: string;
  cameraStatus: string;
  sprayStatus: string;
  streamUrl: string;
}

/** One row of the "Recent Detections" table (comes from your backend). */
export interface DetectionRecord {
  id: string | number;
  zoneName: string;
  camera: string;
  pestClass: string;
  confidence: number;
  date: string; // e.g. '09/21/2026'
  time: string;
  status: string; // e.g. 'confirmed' | 'needs_review'
  zoneId?: number;
}

/** One row of the Spray Logs page (comes from your backend). */
export interface SprayRecord {
  id: string | number;
  zoneName: string;
  trigger: string; // e.g. 'Aphid detected'
  duration: number; // seconds
  date: string; // e.g. '09/21/2026'
  time: string;
  status: 'active' | 'completed' | 'failed' | 'cancelled' | string;
}

/** One entry of the History timeline. Detections and sprays are built from their logs; this is for the rest. */
export interface HistoryEvent {
  id: string | number;
  type: 'detection' | 'spray_start' | 'spray_end' | 'camera' | 'system' | string;
  date: string; // 'MM/DD/YYYY' or 'YYYY-MM-DD'
  time: string;
  zone: string; // zone name, or 'System' for system-wide events (always shown regardless of zone filter)
  event: string; // e.g. 'Camera disconnected'
  detail: string;
}

/** Health of one hardware/backend service, as reported by your backend. */
export interface ServiceStatus {
  ok: boolean;
  detail?: string; // e.g. 'YOLOv8 — running on CPU'
}

/** Shape of what GET /api/system-status should return. Any service left out shows as "not connected". */
export interface SystemStatus {
  controller?: ServiceStatus;
  model?: ServiceStatus;
  sprayController?: ServiceStatus;
  database?: ServiceStatus;
  network?: ServiceStatus;
}

/** One entry in the header's alerts list. */
export interface AppAlert {
  id: string | number;
  type: 'pest_detected' | 'camera_offline' | 'spray_activated' | 'system' | string;
  message: string; // e.g. 'Spray activated — Zone 2'
  detail: string;
  timestamp?: string; // display text, e.g. '10:42 AM' (omit if unknown)
}

/* -------------------------------------------------------------------------- */
/*  CONFIG — this is where you plug in your real cameras (one place only)      */
/* -------------------------------------------------------------------------- */
/**
 * Map each zone id to its camera stream URL. A zone left out (or empty) shows
 * "No Camera Connected" on both the Dashboard and Live Monitoring.
 * URLs entered with "Connect" are saved in the database (cameras.stream_url) and take priority.
 *
 * Supported stream types (auto-detected from the URL):
 *  - MJPEG over HTTP  (ESP32-CAM, IP cams, MJPEG-Streamer)  e.g. http://192.168.1.50:81/stream
 *  - Video files/HLS  (.mp4, .webm, .m3u8)                  e.g. http://192.168.1.60/live/index.m3u8
 *
 * Example:
 *   export const CAMERA_STREAMS: Record<string, string> = {
 *     'zone-1': 'http://192.168.1.50:81/stream',
 *     'zone-2': '/api/cameras/stream/zone-2',
 *   };
 */
export const CAMERA_STREAMS: Record<string, string> = {};

/** Seconds to wait before retrying a stream that failed/disconnected. */
export const RETRY_SECONDS = 5;

// Browser copy of the stream URLs saved in the database. It makes a saved URL show at once and
// keeps cameras working while the API is unreachable; the database stays the source of truth.
const STORAGE_KEY = 'agri.cameraUrls';
// Zone ids whose URL changed while the database could not be reached (retried automatically).
const PENDING_KEY = 'agri.cameraUrls.pending';
// Set once URLs saved before the database existed have been handed over to it.
const MIGRATED_KEY = 'agri.cameraUrls.migrated';

export const CAM_STATUS: Record<CamState, { label: string; color: string }> = {
  unconfigured: { label: 'NOT CONNECTED', color: '#4a7a58' },
  connecting: { label: 'CONNECTING', color: '#f97316' },
  live: { label: 'ONLINE', color: '#22c55e' },
  error: { label: 'OFFLINE', color: '#ef4444' },
};

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */
function readSavedUrls(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

/* -------------------------------------------------------------------------- */
/*  Global camera-state store — lets any component (e.g. the header) see       */
/*  camera health, no matter which page is open                                */
/* -------------------------------------------------------------------------- */
interface StoreSnap {
  feed: Record<string, CamState>; // state of a stream a page is currently showing
  probe: Record<string, CamState>; // last background check while no page shows that camera
  urls: number; // bumps whenever a stream URL is added/changed/removed
}
let snap: StoreSnap = { feed: {}, probe: {}, urls: 0 };
const listeners = new Set<() => void>();

function emit(next: Partial<StoreSnap>) {
  snap = { ...snap, ...next };
  listeners.forEach(l => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
function getSnap() {
  return snap;
}
function setFeedState(zoneId: string, state: CamState | null) {
  if (snap.feed[zoneId] === (state ?? undefined)) return;
  const feed = { ...snap.feed };
  if (state) feed[zoneId] = state;
  else delete feed[zoneId];
  emit({ feed });
}
function setProbeState(zoneId: string, state: CamState | null) {
  if (snap.probe[zoneId] === (state ?? undefined)) return;
  const probe = { ...snap.probe };
  if (state) probe[zoneId] = state;
  else delete probe[zoneId];
  emit({ probe });
}
function resetZone(zoneId: string) {
  const probe = { ...snap.probe };
  delete probe[zoneId];
  emit({ probe, urls: snap.urls + 1 });
}

function writeLocalUrl(zoneId: string, url: string) {
  try {
    const all = readSavedUrls();
    if (url) all[zoneId] = url;
    else delete all[zoneId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable — the database copy still applies */
  }
  resetZone(zoneId);
}

function readPending(): Set<string> {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function setPending(zoneId: string, pending: boolean) {
  try {
    const all = readPending();
    if (pending) all.add(zoneId);
    else all.delete(zoneId);
    localStorage.setItem(PENDING_KEY, JSON.stringify([...all]));
  } catch {
    /* storage unavailable */
  }
}

/** Last database error per zone id, shown under that zone's stream editor. */
const saveErrors: Record<string, string> = {};

/** Writes one zone's URL to the database. Returns true once the database has saved it. */
async function pushUrl(zoneId: string, url: string): Promise<boolean> {
  try {
    await setZoneStream(zoneId, url);
    setPending(zoneId, false);
    delete saveErrors[zoneId];
    return true;
  } catch (error) {
    // Only a 4xx carrying Flask's error code is a real refusal; a bare 404/502 from the web
    // server means the API was not reached, so keep the URL queued and retry.
    const rejected = error instanceof ApiError && error.status >= 400 && error.status < 500 && !!error.code;
    if (rejected) {
      // The API refused this value (e.g. not an http(s) URL): don't retry; the next sync restores the saved one.
      setPending(zoneId, false);
      saveErrors[zoneId] = `Not saved — ${error.message}`;
    } else {
      setPending(zoneId, true);
      const reason = error instanceof ApiError ? error.message.replace(/\.$/, '') : 'API unavailable';
      saveErrors[zoneId] = `Not saved to the database — ${reason}. Using it in this browser; it will be saved when the API is back.`;
    }
    return false;
  } finally {
    emit({ urls: snap.urls + 1 });
  }
}

/** Saves (or clears, with '') a zone's stream URL: in this browser at once, then in the database. */
function saveUrl(zoneId: string, url: string) {
  writeLocalUrl(zoneId, url);
  setPending(zoneId, true);
  void pushUrl(zoneId, url);
}

let syncing = false;

/** Applies a fresh /api/zones response: retries unsaved URLs, then mirrors the database locally. */
async function syncStreams(zoneList: ZoneInfo[]) {
  if (syncing) return;
  syncing = true;
  try {
    let migrated = true;
    try {
      migrated = localStorage.getItem(MIGRATED_KEY) === '1';
    } catch {
      /* storage unavailable */
    }
    const local = readSavedUrls();
    const pending = readPending();
    for (const z of zoneList) {
      const id = String(z.id);
      const localUrl = local[id] || '';
      // URLs saved in this browser before the database existed are handed over once
      const legacy = !migrated && !z.streamUrl && !!localUrl;
      if (pending.has(id) || legacy) {
        if (localUrl !== z.streamUrl) await pushUrl(id, localUrl);
        else setPending(id, false);
      } else if (localUrl !== z.streamUrl) {
        writeLocalUrl(id, z.streamUrl);
      }
    }
    try {
      localStorage.setItem(MIGRATED_KEY, '1');
    } catch {
      /* storage unavailable */
    }
  } finally {
    syncing = false;
  }
}

/** How many of the given zones have a camera stream URL set (in code or saved in the browser). */
export function getConfiguredCameraCount(zoneIds: string[]): number {
  const saved = readSavedUrls();
  return zoneIds.filter(id => !!(saved[id] || CAMERA_STREAMS[id])).length;
}

export function isVideoUrl(url: string) {
  return /\.(mp4|webm|m3u8)(\?|$)/i.test(url);
}

function withRetryParam(url: string, n: number) {
  if (n === 0) return url;
  return `${url}${url.includes('?') ? '&' : '?'}_r=${n}`;
}

/* -------------------------------------------------------------------------- */
/*  Camera feed hook + media element                                           */
/* -------------------------------------------------------------------------- */
/** Owns the stream URL, connection state and auto-reconnect for one zone. */
export function useCameraFeed(zoneId: string) {
  const { urls } = useSyncExternalStore(subscribe, getSnap);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const customUrl = useMemo(() => readSavedUrls()[zoneId] || '', [zoneId, urls]);
  const saveError = saveErrors[zoneId] ?? '';
  const streamUrl = customUrl || CAMERA_STREAMS[zoneId] || '';

  const [camState, setCamState] = useState<CamState>(streamUrl ? 'connecting' : 'unconfigured');
  const [retryKey, setRetryKey] = useState(0);

  // Publish this feed's state so the header/alerts can see it on every page
  const lastState = useRef<CamState>(camState);
  lastState.current = camState;
  useEffect(() => {
    setFeedState(zoneId, camState);
  }, [zoneId, camState]);
  useEffect(
    () => () => {
      setFeedState(zoneId, null);
      // Remember the last known result until the next background check
      if (lastState.current === 'live' || lastState.current === 'error') setProbeState(zoneId, lastState.current);
    },
    [zoneId],
  );

  // Reset whenever the stream URL changes
  useEffect(() => {
    setRetryKey(0);
    setCamState(streamUrl ? 'connecting' : 'unconfigured');
  }, [streamUrl]);

  // Auto-reconnect after an error
  useEffect(() => {
    if (camState !== 'error' || !streamUrl) return;
    const t = setTimeout(() => {
      setRetryKey(k => k + 1);
      setCamState('connecting');
    }, RETRY_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [camState, streamUrl]);

  /** Save (or clear, with '') a stream URL for this zone. */
  const setStreamUrl = useCallback(
    (url: string) => {
      saveUrl(zoneId, url);
    },
    [zoneId],
  );

  /** Manually retry now instead of waiting for the auto-reconnect. */
  const reconnect = useCallback(() => {
    if (!streamUrl) return;
    setRetryKey(k => k + 1);
    setCamState('connecting');
  }, [streamUrl]);

  const src = streamUrl ? withRetryParam(streamUrl, retryKey) : '';

  return { streamUrl, customUrl, setStreamUrl, saveError, camState, setCamState, src, reconnect };
}

/** Renders the real stream (img for MJPEG, video for mp4/webm/HLS). Invisible until it is actually playing. */
export function StreamMedia({
  streamUrl,
  src,
  alt,
  live,
  onLive,
  onError,
}: {
  streamUrl: string;
  src: string;
  alt: string;
  live: boolean;
  onLive: (size?: { width: number; height: number }) => void;
  onError: () => void;
}) {
  if (!streamUrl) return null;
  const cls = 'absolute inset-0 w-full h-full object-cover';
  const style = { opacity: live ? 1 : 0 };

  return isVideoUrl(streamUrl) ? (
    <video
      key={src}
      src={src}
      autoPlay
      muted
      playsInline
      className={cls}
      style={style}
      onPlaying={e => onLive({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })}
      onError={onError}
      onStalled={onError}
    />
  ) : (
    <img
      key={src}
      src={src}
      alt={alt}
      className={cls}
      style={style}
      onLoad={e => onLive({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
      onError={onError}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  Detection and operational data supplied by the Flask API                    */
/* -------------------------------------------------------------------------- */
/** The four crop zones (same as the database seed), shown until/unless the API answers. */
// The existing zone list from src/data/mockData.ts; only the names/ids are used, never its sample statuses.
const DEFAULT_ZONES: ZoneInfo[] = defaultZones.map(z => ({
  id: z.id,
  name: z.name,
  cameraId: z.cameraId,
  cameraStatus: 'offline',
  sprayStatus: 'ready',
  streamUrl: '',
}));

function isZones(value: unknown): value is ZoneInfo[] {
  return isRecordArray(value) && value.every(row =>
    typeof row.id === 'number' &&
    typeof row.name === 'string' &&
    typeof row.cameraId === 'string' &&
    typeof row.cameraStatus === 'string' &&
    typeof row.sprayStatus === 'string' &&
    typeof row.streamUrl === 'string'
  );
}

/** Crop zones and their cameras from the database (the four default zones until it answers). */
export function useZones(): ZoneInfo[] {
  const zoneList = useApiResource('/api/zones', DEFAULT_ZONES, isZones, 15000).data;
  useEffect(() => {
    if (zoneList !== DEFAULT_ZONES) void syncStreams(zoneList);
  }, [zoneList]);
  return zoneList.length ? zoneList : DEFAULT_ZONES;
}

const NO_DETECTIONS: Record<string, Detection> = {};
const NO_HISTORY: DetectionRecord[] = [];

function isDetection(value: unknown): value is Detection {
  return (
    isRecord(value) &&
    typeof value.pestClass === 'string' &&
    typeof value.confidence === 'number' &&
    (value.box === undefined ||
      (isRecord(value.box) &&
        typeof value.box.x === 'number' &&
        typeof value.box.y === 'number' &&
        typeof value.box.w === 'number' &&
        typeof value.box.h === 'number'))
  );
}

function isDetectionMap(value: unknown): value is Record<string, Detection> {
  return isRecord(value) && Object.values(value).every(isDetection);
}

function isDetectionRecords(value: unknown): value is DetectionRecord[] {
  return isRecordArray(value) && value.every(row =>
    (typeof row.id === 'string' || typeof row.id === 'number') &&
    typeof row.zoneName === 'string' &&
    typeof row.camera === 'string' &&
    typeof row.pestClass === 'string' &&
    typeof row.confidence === 'number' &&
    typeof row.date === 'string' &&
    typeof row.time === 'string' &&
    typeof row.status === 'string'
  );
}

function isTelemetryMap(value: unknown): value is Record<string, CameraTelemetry> {
  return isRecord(value) && Object.values(value).every(row =>
    isRecord(row) &&
    (row.signal == null || ['strong', 'medium', 'weak', 'none'].includes(String(row.signal))) &&
    (row.fps == null || typeof row.fps === 'number') &&
    (row.resolution == null || typeof row.resolution === 'string')
  );
}

function isSprayRecords(value: unknown): value is SprayRecord[] {
  return isRecordArray(value) && value.every(row =>
    (typeof row.id === 'string' || typeof row.id === 'number') &&
    typeof row.zoneName === 'string' &&
    typeof row.trigger === 'string' &&
    typeof row.duration === 'number' &&
    typeof row.date === 'string' &&
    typeof row.time === 'string' &&
    typeof row.status === 'string'
  );
}

function isHistoryEvents(value: unknown): value is HistoryEvent[] {
  return isRecordArray(value) && value.every(row =>
    (typeof row.id === 'string' || typeof row.id === 'number') &&
    typeof row.type === 'string' &&
    typeof row.date === 'string' &&
    typeof row.time === 'string' &&
    typeof row.zone === 'string' &&
    typeof row.event === 'string' &&
    typeof row.detail === 'string'
  );
}

function isSystemStatus(value: unknown): value is SystemStatus {
  return isRecord(value) &&
    ['controller', 'model', 'sprayController', 'database', 'network'].every(key => {
      const status = value[key];
      return status === undefined || (isRecord(status) && typeof status.ok === 'boolean');
    });
}

function isAlerts(value: unknown): value is AppAlert[] {
  return isRecordArray(value) && value.every(row =>
    (typeof row.id === 'string' || typeof row.id === 'number') &&
    typeof row.type === 'string' &&
    typeof row.message === 'string' &&
    typeof row.detail === 'string'
  );
}

/**
 * Current detection per zone id, refreshed for Dashboard and Live Monitoring.
 */
export function useAllDetections(): Record<string, Detection> {
  return useApiResource('/api/detections/current', NO_DETECTIONS, isDetectionMap, 2000).data;
}

/** Detection for one zone. Only reported while that zone's camera is live. */
export function useZoneDetection(zoneId: string, enabled = true): Detection | null {
  const all = useAllDetections();
  return enabled ? all[zoneId] ?? null : null;
}

/**
 * Today's detection log for the "Recent Detections" table (newest first).
 */
export function useDetectionHistory(): DetectionRecord[] {
  return useApiResource('/api/detections?range=today&limit=100', NO_HISTORY, isDetectionRecords, 10000).data;
}

/**
 * The full detection log for the Detection Logs page.
 */
export function useDetectionLogs(): DetectionRecord[] {
  return useApiResource('/api/detections?limit=500', NO_HISTORY, isDetectionRecords, 15000).data;
}

/**
 * Hardware-reported values per zone id (signal strength, fps, resolution).
 */
const NO_TELEMETRY: Record<string, CameraTelemetry> = {};
export function useCameraTelemetry(): Record<string, CameraTelemetry> {
  return useApiResource('/api/cameras/telemetry', NO_TELEMETRY, isTelemetryMap, 15000).data;
}

/**
 * Spray activation log for the Spray Logs page.
 */
const NO_SPRAYS: SprayRecord[] = [];
export function useSprayLogs(): SprayRecord[] {
  return useApiResource('/api/sprays?limit=500', NO_SPRAYS, isSprayRecords, 15000).data;
}

/**
 * Camera/system events for the History timeline.
 */
const NO_EVENTS: HistoryEvent[] = [];
export function useSystemEvents(): HistoryEvent[] {
  return useApiResource('/api/events?limit=500', NO_EVENTS, isHistoryEvents, 15000).data;
}

/**
 * Hardware/backend health for System Settings.
 */
const NO_STATUS: SystemStatus = {};
export function useSystemStatus(): SystemStatus {
  const resource = useApiResource('/api/system-status', NO_STATUS, isSystemStatus, 15000);
  if (resource.error) {
    return {
      ...resource.data,
      database: { ok: false, detail: 'Database status unavailable' },
      network: { ok: false, detail: resource.error.message },
    };
  }
  return resource.data;
}

/**
 * Alerts the backend raises on its own (spray activated, camera offline, system faults).
 * Pest-detection alerts are built from useAllDetections(), so don't repeat them here.
 * Returned by Flask and merged with live browser-generated detection alerts.
 */
const NO_ALERTS: AppAlert[] = [];
export function useBackendAlerts(): AppAlert[] {
  return useApiResource('/api/alerts?limit=100', NO_ALERTS, isAlerts, 10000).data;
}

/* -------------------------------------------------------------------------- */
/*  Background camera monitoring + camera alerts                               */
/* -------------------------------------------------------------------------- */
const PROBE_INTERVAL_MS = 15000;
const PROBE_TIMEOUT_MS = 6000;

/** Opens the stream just long enough to see whether it delivers a frame, then closes it. */
function probeStream(url: string): Promise<boolean> {
  return new Promise(resolve => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cleanup = () => {};
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      cleanup();
      resolve(ok);
    };

    if (isVideoUrl(url)) {
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'metadata';
      v.onloadedmetadata = () => finish(true);
      v.onerror = () => finish(false);
      cleanup = () => {
        v.removeAttribute('src');
        v.load();
      };
      v.src = url;
    } else {
      const img = new Image();
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      cleanup = () => {
        img.src = '';
      };
      img.src = url;
    }
    timer = setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
  });
}

/**
 * Call once in something that is always mounted (the Header). Every 15 s it checks each
 * configured camera that no page is currently showing, so a dropped connection is noticed
 * on any page. A check opens the stream for a moment and closes it again.
 */
export function useCameraMonitor(zoneIds: string[]) {
  const key = zoneIds.join('|');
  const { urls } = useSyncExternalStore(subscribe, getSnap);

  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split('|') : [];

    const run = async () => {
      if (document.hidden) return; // don't poll while the tab is in the background
      const saved = readSavedUrls();
      await Promise.all(
        ids.map(async id => {
          const url = saved[id] || CAMERA_STREAMS[id] || '';
          if (!url) {
            setProbeState(id, null);
            return;
          }
          if (snap.feed[id]) return; // a page is already showing this camera
          const ok = await probeStream(withRetryParam(url, Date.now()));
          if (cancelled || snap.feed[id]) return;
          setProbeState(id, ok ? 'live' : 'error');
        }),
      );
    };

    run();
    const t = setInterval(run, PROBE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [key, urls]);
}

/** Best-known connection state per zone id, from any page's feed or the background check. */
export function useCameraStates(zoneIds: string[]): Record<string, CamState> {
  const s = useSyncExternalStore(subscribe, getSnap);
  const saved = readSavedUrls();
  const out: Record<string, CamState> = {};
  zoneIds.forEach(id => {
    const configured = !!(saved[id] || CAMERA_STREAMS[id]);
    out[id] = !configured ? 'unconfigured' : s.feed[id] ?? s.probe[id] ?? 'connecting';
  });
  return out;
}

/** Alerts for cameras that are offline or have no connection set up. */
export function useCameraAlerts(
  zoneList: { id: string | number; name: string; cameraId: string | number }[],
): AppAlert[] {
  const states = useCameraStates(zoneList.map(z => String(z.id)));
  return zoneList.flatMap<AppAlert>(z => {
    const st = states[String(z.id)];
    if (st === 'error') {
      return [{
        id: `cam-offline-${z.id}`,
        type: 'camera_offline',
        message: `Camera offline — ${z.name}`,
        detail: `${z.cameraId} is not responding. Check power, network and the stream URL.`,
      }];
    }
    if (st === 'unconfigured') {
      return [{
        id: `cam-none-${z.id}`,
        type: 'camera_not_connected',
        message: `Camera not connected — ${z.name}`,
        detail: `${z.cameraId} has no stream set. Add one on the Camera Status page.`,
      }];
    }
    return [];
  });
}
