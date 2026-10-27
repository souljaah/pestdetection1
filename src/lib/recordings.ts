import { useEffect, useState } from 'react';
import { ApiError, isRecord, isRecordArray, requestJson, startRecording, stopRecording } from './api';
import type { LiveBox } from './detection';
import { useApiResource } from './useApiResource';

/** One recorded Live Monitoring session, from GET /api/recordings (SQLite table recordings). */
export interface RecordingRecord {
  id: number;
  zoneId: number;
  zoneName: string;
  camera: string;
  streamUrl: string;
  kind: 'mjpeg' | 'video' | string;
  status: 'recording' | 'completed' | 'failed' | string;
  startedAt: string;
  endedAt: string | null;
  date: string;
  time: string;
  durationSeconds: number;
  frameCount: number;
  sizeBytes: number;
  error: string | null;
  hasDetections?: boolean; // the model found a pest while this was recorded
}

function isRecording(value: unknown): value is RecordingRecord {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    typeof value.zoneId === 'number' &&
    typeof value.zoneName === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.status === 'string' &&
    typeof value.startedAt === 'string' &&
    typeof value.durationSeconds === 'number'
  );
}

function isRecordings(value: unknown): value is RecordingRecord[] {
  return isRecordArray(value) && value.every(isRecording);
}

const NO_RECORDINGS: RecordingRecord[] = [];

/** All recordings, newest first. */
export function useRecordings() {
  return useApiResource('/api/recordings?limit=500', NO_RECORDINGS, isRecordings, 5000);
}

/** How often the Live Monitoring page tells the API the feed is still being watched. */
const HEARTBEAT_MS = 10000;

/**
 * Records a zone's stream on the server while its feed is live on screen.
 * The API stops on its own if the heartbeats stop (tab closed), so stopping here is best-effort.
 */
export function useAutoRecording(zoneId: string, isLive: boolean, streamUrl: string) {
  const [recording, setRecording] = useState<RecordingRecord | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isLive || !streamUrl) {
      setRecording(null);
      return;
    }
    let cancelled = false;
    const beat = async () => {
      try {
        const value = await startRecording(zoneId);
        if (cancelled) return;
        setRecording(isRecording(value) ? value : null);
        setError('');
      } catch (e) {
        if (cancelled) return;
        setRecording(null);
        setError(e instanceof ApiError ? e.message : 'Recording unavailable');
      }
    };
    void beat();
    const t = setInterval(() => void beat(), HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
      void stopRecording(zoneId).catch(() => {});
    };
  }, [zoneId, isLive, streamUrl]);

  return { recording, error };
}

/** Pest boxes saved with a recording: what the model saw at `t` ms into it (empty boxes = pest gone). */
export interface RecordedBoxes {
  t: number;
  w: number;
  h: number;
  boxes: LiveBox[];
}

function isRecordedBoxes(value: unknown): value is RecordedBoxes[] {
  return isRecordArray(value) && value.every(e => typeof e.t === 'number' && Array.isArray(e.boxes));
}

/** The boxes recorded with a recording (refreshed while it is still being recorded). */
export function useRecordingBoxes(id: number, inProgress: boolean): RecordedBoxes[] {
  const [entries, setEntries] = useState<RecordedBoxes[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const value = await requestJson<unknown>(`/api/recordings/${id}/boxes`);
        if (!cancelled && isRecordedBoxes(value)) setEntries(value);
      } catch {
        /* no boxes to show */
      }
    };
    setEntries([]);
    void load();
    if (!inProgress) return () => void (cancelled = true);
    const t = setInterval(() => void load(), 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [id, inProgress]);
  return entries;
}

/** Boxes on screen at `seconds` into a recording: the last result before it, unless that is over 1 s old. */
export function boxesAt(entries: RecordedBoxes[], seconds: number): RecordedBoxes | null {
  const ms = seconds * 1000;
  let lo = 0;
  let hi = entries.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].t <= ms) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found < 0) return null;
  const entry = entries[found];
  return entry.boxes.length && ms - entry.t <= 1000 ? entry : null;
}

/** Time ranges (seconds) in which pests were on screen, for marking the player's timeline. */
export function pestSegments(entries: RecordedBoxes[]): { start: number; end: number }[] {
  const segments: { start: number; end: number }[] = [];
  for (const e of entries) {
    const last = segments[segments.length - 1];
    if (e.boxes.length) {
      if (last && e.t / 1000 - last.end <= 1) last.end = e.t / 1000;
      else segments.push({ start: e.t / 1000, end: e.t / 1000 });
    }
  }
  return segments;
}

export function formatDuration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
