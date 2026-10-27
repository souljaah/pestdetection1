import { useEffect, useMemo, useState } from 'react';
import { useZones } from '../lib/cameras';
import { ApiError, deleteRecording } from '../lib/api';
import {
  boxesAt,
  formatBytes,
  formatDuration,
  pestSegments,
  useRecordingBoxes,
  useRecordings,
  type RecordingRecord,
} from '../lib/recordings';
import DetectionBoxes from '../components/DetectionBoxes';

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  recording: { bg: '#ef444420', text: '#f87171', border: '#ef444440' },
  completed: { bg: '#22c55e15', text: '#4ade80', border: '#22c55e30' },
  failed: { bg: '#6b947820', text: '#6b9478', border: '#6b947840' },
};
const FALLBACK_STATUS = STATUS_COLORS.failed;

/* -------------------------------------------------------------------------- */
/*  Player                                                                     */
/* -------------------------------------------------------------------------- */
/**
 * MJPEG recordings are replayed by the API at their recorded pace (an <img> stream starting at ?t=).
 * Pausing shows the single frame at the current position; seeking restarts the stream there.
 */
function MjpegPlayer({ rec }: { rec: RecordingRecord }) {
  const duration = rec.durationSeconds;
  const [playing, setPlaying] = useState(true);
  const [position, setPosition] = useState(0);
  // Where (and when) the current stream started, so the position can follow it
  const [anchor, setAnchor] = useState({ pos: 0, at: performance.now(), key: 0 });
  // Pest boxes the model found while this was recorded, drawn at the matching moment
  const recordedBoxes = useRecordingBoxes(rec.id, rec.status === 'recording');
  const [showBoxes, setShowBoxes] = useState(true);
  const boxesNow = showBoxes ? boxesAt(recordedBoxes, position) : null;
  const segments = useMemo(() => pestSegments(recordedBoxes), [recordedBoxes]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      const pos = anchor.pos + (performance.now() - anchor.at) / 1000;
      if (pos >= duration && rec.status !== 'recording') {
        setPosition(duration);
        setPlaying(false);
      } else {
        setPosition(Math.min(pos, duration));
      }
    }, 100);
    return () => clearInterval(t);
  }, [playing, anchor, duration, rec.status]);

  const playFrom = (pos: number) => {
    const start = pos >= duration ? 0 : pos;
    setPosition(start);
    setAnchor(a => ({ pos: start, at: performance.now(), key: a.key + 1 }));
    setPlaying(true);
  };

  const seek = (pos: number) => {
    if (playing) playFrom(pos);
    else setPosition(pos);
  };

  const t = position.toFixed(1);
  const src = playing
    ? `/api/recordings/${rec.id}/play?t=${anchor.pos.toFixed(1)}&_k=${anchor.key}`
    : `/api/recordings/${rec.id}/frame?t=${t}`;

  return (
    <>
      <div className="relative" style={{ aspectRatio: '16/9', background: '#050e07' }}>
        <img key={src} src={src} alt={`${rec.zoneName} recording`} className="absolute inset-0 w-full h-full object-contain" />
        {boxesNow && (
          <DetectionBoxes detection={{ boxes: boxesNow.boxes, width: boxesNow.w, height: boxesNow.h }} fit="contain" />
        )}
        <div
          className="absolute bottom-3 left-3 font-mono text-xs px-2 py-1 rounded"
          style={{ background: '#050e07c0', color: '#4ade80' }}
        >
          {new Date(new Date(rec.startedAt).getTime() + position * 1000).toLocaleTimeString('en-US', { hour12: true })}
        </div>
      </div>
      <div className="flex items-center gap-3 px-4 py-3" style={{ borderTop: '1px solid #1a3022' }}>
        <button
          onClick={() => (playing ? setPlaying(false) : playFrom(position))}
          className="font-mono text-xs font-600 px-3 py-1.5 rounded shrink-0"
          style={{ background: '#15803d', color: '#f0fdf4', minWidth: 64 }}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <span className="font-mono text-xs shrink-0" style={{ color: '#86efac' }}>{formatDuration(position)}</span>
        <div className="flex-1 min-w-0 relative">
          <input
            type="range"
            min={0}
            max={Math.max(duration, 0.1)}
            step={0.1}
            value={position}
            onChange={e => seek(Number(e.target.value))}
            className="w-full accent-green-500"
          />
          {/* Red marks where the model saw a pest */}
          <div className="absolute left-0 right-0 -bottom-1 h-1 pointer-events-none">
            {segments.map((s, i) => (
              <div
                key={i}
                className="absolute h-full rounded-full bg-red-500"
                style={{
                  left: `${(s.start / Math.max(duration, 0.1)) * 100}%`,
                  width: `max(3px, ${((s.end - s.start) / Math.max(duration, 0.1)) * 100}%)`,
                }}
              />
            ))}
          </div>
        </div>
        <span className="font-mono text-xs shrink-0" style={{ color: '#4a7a58' }}>{formatDuration(duration)}</span>
        {recordedBoxes.length > 0 && (
          <button
            onClick={() => setShowBoxes(v => !v)}
            className="font-mono text-xs px-2 py-1 rounded shrink-0"
            style={{ border: '1px solid #1a3022', color: showBoxes ? '#ef4444' : '#4a7a58' }}
            title="Show the pest boxes the model found while recording"
          >
            Boxes {showBoxes ? 'on' : 'off'}
          </button>
        )}
      </div>
    </>
  );
}

function Player({ rec, onDelete }: { rec: RecordingRecord; onDelete: () => void }) {
  const playable = rec.frameCount > 0;
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#0a1a10', border: '1px solid #1a3022' }}>
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1px solid #1a3022' }}>
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-display text-sm font-700 text-green-100 uppercase tracking-wider">{rec.zoneName}</span>
          <span className="font-mono text-xs text-green-600 truncate">
            {rec.date} {rec.time}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {rec.kind === 'video' && playable && (
            <a
              href={`/api/recordings/${rec.id}/play`}
              download={`recording-${rec.id}`}
              className="font-mono text-xs px-2.5 py-1 rounded"
              style={{ border: '1px solid #1a3022', color: '#4ade80' }}
            >
              Download
            </a>
          )}
          {rec.status !== 'recording' && (
            <button
              onClick={onDelete}
              className="font-mono text-xs px-2.5 py-1 rounded"
              style={{ border: '1px solid #1a3022', color: '#ef4444' }}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {!playable ? (
        <div
          className="flex flex-col items-center justify-center gap-2 px-4 text-center"
          style={{ aspectRatio: '16/9', background: '#050e07' }}
        >
          <span className="font-display text-sm tracking-wider uppercase" style={{ color: '#4a7a58' }}>
            Nothing to play
          </span>
          <span className="font-mono text-xs" style={{ color: '#2d4e38' }}>
            {rec.error ? `The stream could not be recorded — ${rec.error}` : 'No frames were saved for this session.'}
          </span>
        </div>
      ) : rec.kind === 'video' ? (
        <video
          key={rec.id}
          src={`/api/recordings/${rec.id}/play`}
          controls
          autoPlay
          muted
          playsInline
          className="w-full"
          style={{ aspectRatio: '16/9', background: '#050e07' }}
        />
      ) : (
        <MjpegPlayer key={rec.id} rec={rec} />
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px" style={{ borderTop: '1px solid #1a3022', background: '#1a3022' }}>
        {[
          { label: 'CAMERA', value: rec.camera },
          { label: 'DURATION', value: formatDuration(rec.durationSeconds) },
          { label: 'SIZE', value: formatBytes(rec.sizeBytes) },
          { label: 'STATUS', value: rec.status.toUpperCase() },
        ].map(item => (
          <div key={item.label} className="px-3 py-2" style={{ background: '#0a1a10' }}>
            <div className="font-mono text-xs mb-0.5" style={{ color: '#4a7a58' }}>{item.label}</div>
            <div className="font-mono text-xs font-600 truncate" style={{ color: '#86efac' }}>{item.value}</div>
          </div>
        ))}
      </div>
      <div className="px-3 py-2 font-mono text-xs truncate" style={{ borderTop: '1px solid #1a3022', color: '#4a7a58' }}>
        SOURCE <span style={{ color: '#86efac' }}>{rec.streamUrl}</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                       */
/* -------------------------------------------------------------------------- */
export default function Recordings() {
  const { data: recordings, error, refetch } = useRecordings();
  const zones = useZones();
  const ZONES = ['All', ...zones.map(z => z.name)];

  const [zoneFilter, setZoneFilter] = useState('All');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [actionError, setActionError] = useState('');

  const filtered = useMemo(
    () => recordings.filter(r => zoneFilter === 'All' || r.zoneName === zoneFilter),
    [recordings, zoneFilter],
  );
  const selected = recordings.find(r => r.id === selectedId) ?? null;

  const totalSeconds = recordings.reduce((sum, r) => sum + r.durationSeconds, 0);
  const totalBytes = recordings.reduce((sum, r) => sum + r.sizeBytes, 0);
  const recordingNow = recordings.filter(r => r.status === 'recording');

  const remove = async (rec: RecordingRecord) => {
    if (!window.confirm(`Delete the ${rec.zoneName} recording from ${rec.date} ${rec.time}? This cannot be undone.`)) return;
    // Close the player first so its stream releases the file
    if (selectedId === rec.id) setSelectedId(null);
    try {
      await deleteRecording(rec.id);
      setActionError('');
      await refetch();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Delete failed');
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-800 text-green-50 uppercase tracking-widest">Recordings</h1>
        <p className="font-mono text-xs mt-1" style={{ color: '#4a7a58' }}>
          Live Monitoring sessions, recorded automatically — SQLite table: recordings
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Recordings', value: recordings.length, color: recordings.length ? '#4ade80' : '#4a7a58' },
          { label: 'Total Length', value: formatDuration(totalSeconds), color: totalSeconds ? '#4ade80' : '#4a7a58' },
          { label: 'Disk Used', value: formatBytes(totalBytes), color: totalBytes ? '#f97316' : '#4a7a58' },
          {
            label: 'Recording Now',
            value: recordingNow.length > 0 ? recordingNow.length : 'None',
            color: recordingNow.length > 0 ? '#f87171' : '#4a7a58',
          },
        ].map(c => (
          <div key={c.label} className="rounded-xl p-4" style={{ background: '#0a1a10', border: '1px solid #1a3022' }}>
            <div className="font-mono text-xs mb-1 tracking-wider uppercase" style={{ color: '#4a7a58' }}>{c.label}</div>
            <div className="font-display text-3xl font-800" style={{ color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {(error || actionError) && (
        <div className="rounded-xl px-4 py-3 font-mono text-xs text-red-400" style={{ background: '#ef444410', border: '1px solid #ef444440' }}>
          {actionError || error?.message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
        {/* List */}
        <div className="lg:col-span-2 rounded-xl overflow-hidden" style={{ background: '#0a1a10', border: '1px solid #1a3022' }}>
          <div className="px-4 py-3 flex items-center justify-between gap-3" style={{ borderBottom: '1px solid #1a3022' }}>
            <span className="font-mono text-xs text-green-500">{filtered.length} recordings</span>
            <select
              value={zoneFilter}
              onChange={e => setZoneFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg font-mono text-xs text-green-100 appearance-none"
              style={{ background: '#0d2115', border: '1px solid #1a3022', outline: 'none' }}
            >
              {ZONES.map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div className="max-h-[560px] overflow-y-auto">
            {filtered.map(r => {
              const st = STATUS_COLORS[r.status] ?? FALLBACK_STATUS;
              const active = r.id === selected?.id;
              return (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className="w-full text-left px-4 py-3 flex items-center gap-3"
                  style={{
                    borderBottom: '1px solid #0d2115',
                    background: active ? '#0d2115' : 'transparent',
                    borderLeft: active ? '2px solid #22c55e' : '2px solid transparent',
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-sm font-600 text-green-200 uppercase tracking-wide">{r.zoneName}</div>
                    <div className="font-mono text-xs text-green-500">
                      {r.date} {r.time}
                      {r.hasDetections && <span className="ml-2 font-600 text-red-400">⚠ PEST</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono text-xs text-green-300">{formatDuration(r.durationSeconds)}</div>
                    <span
                      className="font-mono px-1.5 py-0.5 rounded text-xs font-600"
                      style={{ background: st.bg, color: st.text, border: `1px solid ${st.border}` }}
                    >
                      {r.status === 'recording' ? '● REC' : r.status.toUpperCase()}
                    </span>
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-4 py-8 text-center font-mono text-xs" style={{ color: '#4a7a58' }}>
                {recordings.length === 0
                  ? 'No recordings yet. Open Live Monitoring with a connected camera — every live feed is recorded here automatically.'
                  : 'No recordings for this zone.'}
              </div>
            )}
          </div>
        </div>

        {/* Player */}
        <div className="lg:col-span-3">
          {selected ? (
            <Player rec={selected} onDelete={() => void remove(selected)} />
          ) : (
            <div
              className="rounded-xl flex items-center justify-center px-4 text-center font-mono text-xs"
              style={{ aspectRatio: '16/9', background: '#0a1a10', border: '1px solid #1a3022', color: '#4a7a58' }}
            >
              Select a recording to rewatch it
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
