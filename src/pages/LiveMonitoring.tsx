import { useState, useEffect, useCallback } from 'react';
import {
  CAMERA_STREAMS,
  RETRY_SECONDS,
  StreamMedia,
  useCameraFeed,
  useZoneDetection,
  useZones,
  type CamState,
  type ZoneInfo,
} from '../lib/cameras';
import { formatDuration, useAutoRecording } from '../lib/recordings';
import { useLiveDetection } from '../lib/detection';
import DetectionBoxes from '../components/DetectionBoxes';

type Zone = ZoneInfo;

/* -------------------------------------------------------------------------- */
/*  Camera panel                                                               */
/* -------------------------------------------------------------------------- */
function CameraPanel({
  zone,
  onStateChange,
}: {
  zone: Zone;
  onStateChange: (zoneId: string, state: CamState) => void;
}) {
  const zoneId = String(zone.id);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [now, setNow] = useState(() => new Date());

  const { streamUrl, customUrl, setStreamUrl, saveError, camState, setCamState, src } = useCameraFeed(zoneId);
  const isLive = camState === 'live';
  const detection = useZoneDetection(zoneId, isLive);
  const isDetected = isLive && !!detection;
  // Every live session is recorded by the API so it can be rewatched on the Recordings page
  const { recording, error: recordError } = useAutoRecording(zoneId, isLive, streamUrl);
  // The YOLO model on the API checks the frames being recorded and returns a box per pest
  const model = useLiveDetection(zoneId, isLive && !!recording);
  const liveBoxes = model.zone;

  // Live clock — only runs while a feed is actually live
  useEffect(() => {
    if (!isLive) return;
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [isLive]);

  // Report state to the page header
  useEffect(() => {
    onStateChange(zoneId, camState);
  }, [zoneId, camState, onStateChange]);

  const startEditing = () => {
    setDraft(customUrl || CAMERA_STREAMS[zoneId] || '');
    setEditing(true);
  };

  const saveDraft = () => {
    setStreamUrl(draft.trim());
    setEditing(false);
  };

  const disconnect = () => {
    setStreamUrl('');
    setEditing(false);
  };

  const timestamp = now.toLocaleTimeString('en-US', {
    hour12: true,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const mixedContent =
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    streamUrl.startsWith('http:');

  const badge = {
    unconfigured: { text: '● NO CAMERA', color: '#4a7a58' },
    connecting: { text: '● CONNECTING', color: '#f97316' },
    live: { text: '● LIVE', color: '#4ade80' },
    error: { text: '● OFFLINE', color: '#ef4444' },
  }[camState];

  const box = detection?.box ?? { x: 0.28, y: 0.28, w: 0.35, h: 0.35 };

  const detectionValue = isDetected
    ? detection!.pestClass
    : isLive
    ? 'NONE'
    : '—';
  const detectionColor = isDetected ? '#ef4444' : isLive ? '#22c55e' : '#4a7a58';

  const cameraValue = {
    unconfigured: 'NOT CONNECTED',
    connecting: 'CONNECTING',
    live: 'ONLINE',
    error: 'OFFLINE',
  }[camState];
  const cameraColor = {
    unconfigured: '#4a7a58',
    connecting: '#f97316',
    live: '#22c55e',
    error: '#ef4444',
  }[camState];

  return (
    <div
      className={`rounded-xl overflow-hidden flex flex-col ${isDetected ? 'border-blink' : ''}`}
      style={{
        background: '#0a1a10',
        border: `1px solid ${isDetected ? '#ef4444' : '#1a3022'}`,
      }}
    >
      {/* Feed header */}
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1px solid #1a3022' }}>
        <div className="flex items-center gap-3">
          <span className="font-display text-sm font-700 text-green-100 uppercase tracking-wider">{zone.name}</span>
          <span className="font-mono text-xs text-green-600">{zone.cameraId}</span>
        </div>
        {isDetected ? (
          <span className="font-mono text-xs font-600 animate-pulse" style={{ color: '#ef4444' }}>
            ● PEST DETECTED
          </span>
        ) : (
          <span
            className={`font-mono text-xs font-600 ${isLive ? 'dot-online' : ''} ${camState === 'connecting' ? 'animate-pulse' : ''}`}
            style={{ color: badge.color }}
          >
            {badge.text}
          </span>
        )}
      </div>

      {/* Camera feed */}
      <div className="relative" style={{ aspectRatio: '16/9', background: '#050e07' }}>
        {/* Placeholder — shown until a stream is actually playing */}
        {!isLive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#1a3022" strokeWidth="1.5">
              <path d="M23 7l-7 5 7 5V7z" />
              <rect x="1" y="5" width="15" height="14" rx="2" />
            </svg>

            {camState === 'unconfigured' && (
              <>
                <span className="font-display text-sm tracking-wider uppercase" style={{ color: '#4a7a58' }}>
                  No Camera Connected
                </span>
                <span className="font-mono text-xs" style={{ color: '#2d4e38' }}>
                  Detection is inactive until a camera is added
                </span>
                {!editing && (
                  <button
                    onClick={startEditing}
                    className="font-mono text-xs font-600 px-3 py-1.5 rounded"
                    style={{ background: '#0f2417', border: '1px solid #1a3022', color: '#4ade80' }}
                  >
                    Connect camera
                  </button>
                )}
              </>
            )}

            {camState === 'connecting' && (
              <>
                <span className="font-display text-sm tracking-wider uppercase text-orange-500 animate-pulse">
                  Connecting…
                </span>
                <span className="font-mono text-xs break-all" style={{ color: '#4a7a58' }}>{streamUrl}</span>
              </>
            )}

            {camState === 'error' && (
              <>
                <span className="font-display text-sm tracking-wider uppercase text-red-700">No Signal</span>
                <span className="font-mono text-xs" style={{ color: '#4a7a58' }}>
                  Camera unreachable — retrying in {RETRY_SECONDS}s
                </span>
                {mixedContent && (
                  <span className="font-mono text-xs" style={{ color: '#f97316' }}>
                    This page is HTTPS but the stream is HTTP — the browser blocks it. Use an HTTPS stream or a backend proxy.
                  </span>
                )}
              </>
            )}
          </div>
        )}

        {/* Real stream — the placeholder above covers it until it plays */}
        <StreamMedia
          streamUrl={streamUrl}
          src={src}
          alt={`${zone.name} live feed`}
          live={isLive}
          onLive={() => setCamState('live')}
          onError={() => setCamState('error')}
        />

        {/* Overlays — only when a real feed is live */}
        {isLive && (
          <>
            {/* Scan line effect */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px)',
              }}
            />

            {/* Corner brackets */}
            {['top-2 left-2', 'top-2 right-2', 'bottom-2 left-2', 'bottom-2 right-2'].map((pos, i) => (
              <div
                key={i}
                className={`absolute ${pos} w-4 h-4 pointer-events-none`}
                style={{
                  borderTop: i < 2 ? '1px solid #22c55e80' : 'none',
                  borderBottom: i >= 2 ? '1px solid #22c55e80' : 'none',
                  borderLeft: i % 2 === 0 ? '1px solid #22c55e80' : 'none',
                  borderRight: i % 2 === 1 ? '1px solid #22c55e80' : 'none',
                }}
              />
            ))}

            {/* LIVE indicator */}
            <div
              className="absolute top-3 left-3 flex items-center gap-1.5 px-2 py-1 rounded"
              style={{ background: '#050e07c0' }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span className="font-mono text-xs font-600 text-red-400">LIVE</span>
            </div>

            {/* REC indicator — the API is saving this feed */}
            {recording && (
              <div
                className="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-1 rounded"
                style={{ background: '#050e07c0' }}
                title="This live feed is being recorded — rewatch it on the Recordings page"
              >
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="font-mono text-xs font-600 text-red-400">
                  REC {formatDuration((now.getTime() - new Date(recording.startedAt).getTime()) / 1000)}
                </span>
              </div>
            )}

            {/* Timestamp */}
            <div
              className="absolute bottom-3 left-3 font-mono text-xs px-2 py-1 rounded"
              style={{ background: '#050e07c0', color: '#4ade80' }}
            >
              {timestamp}
            </div>

            {/* Live model boxes — one per pest on the current frame */}
            {liveBoxes && liveBoxes.boxes.length > 0 && <DetectionBoxes detection={liveBoxes} />}

            {/* Pest bounding box — only drawn when the backend reports a real detection
                (the live model boxes above replace it while the model is running on this feed) */}
            {isDetected && !liveBoxes && (
              <div
                className="absolute border-2 border-red-500 rounded"
                style={{
                  top: `${box.y * 100}%`,
                  left: `${box.x * 100}%`,
                  width: `${box.w * 100}%`,
                  height: `${box.h * 100}%`,
                }}
              >
                <div
                  className="absolute -top-6 left-0 px-2 py-0.5 font-mono text-xs text-white rounded flex items-center gap-1"
                  style={{ background: '#ef4444', whiteSpace: 'nowrap' }}
                >
                  <span>⚠</span>
                  <span>
                    {detection!.pestClass} — {detection!.confidence.toFixed(1)}%
                  </span>
                </div>
                {['top-0 left-0', 'top-0 right-0', 'bottom-0 left-0', 'bottom-0 right-0'].map((p, i) => (
                  <div
                    key={i}
                    className={`absolute ${p} w-3 h-3`}
                    style={{
                      borderTop: i < 2 ? '2px solid #ef4444' : 'none',
                      borderBottom: i >= 2 ? '2px solid #ef4444' : 'none',
                      borderLeft: i % 2 === 0 ? '2px solid #ef4444' : 'none',
                      borderRight: i % 2 === 1 ? '2px solid #ef4444' : 'none',
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Stream source row */}
      <div className="px-3 py-2 flex items-center gap-2" style={{ borderTop: '1px solid #1a3022' }}>
        {editing ? (
          <>
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') saveDraft();
                if (e.key === 'Escape') setEditing(false);
              }}
              autoFocus
              placeholder="http://192.168.1.50:81/stream"
              className="flex-1 min-w-0 font-mono text-xs px-2 py-1.5 rounded outline-none"
              style={{ background: '#050e07', border: '1px solid #1a3022', color: '#bbf7d0' }}
            />
            <button
              onClick={saveDraft}
              className="font-mono text-xs font-600 px-3 py-1.5 rounded"
              style={{ background: '#15803d', color: '#f0fdf4' }}
            >
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="font-mono text-xs px-3 py-1.5 rounded"
              style={{ border: '1px solid #1a3022', color: '#4a7a58' }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <span className="font-mono text-xs shrink-0" style={{ color: '#4a7a58' }}>STREAM</span>
            <span className="font-mono text-xs truncate flex-1 min-w-0" style={{ color: streamUrl ? '#86efac' : '#2d4e38' }}>
              {streamUrl || 'not set'}
            </span>
            <button
              onClick={startEditing}
              className="font-mono text-xs px-2.5 py-1 rounded"
              style={{ border: '1px solid #1a3022', color: '#4ade80' }}
            >
              {streamUrl ? 'Change' : 'Connect'}
            </button>
            {customUrl && (
              <button
                onClick={disconnect}
                className="font-mono text-xs px-2.5 py-1 rounded"
                style={{ border: '1px solid #1a3022', color: '#ef4444' }}
              >
                Disconnect
              </button>
            )}
          </>
        )}
      </div>

      {saveError && (
        <div className="px-3 py-1.5 font-mono text-xs text-red-400" style={{ borderTop: '1px solid #1a3022' }}>
          {saveError}
        </div>
      )}

      {isLive && recording && (
        <div className="px-3 py-1.5 flex items-center gap-2 font-mono text-xs" style={{ borderTop: '1px solid #1a3022' }}>
          <span className="shrink-0" style={{ color: '#4a7a58' }}>AI MODEL</span>
          {liveBoxes ? (
            <span style={{ color: liveBoxes.boxes.length ? '#ef4444' : '#22c55e' }}>
              {liveBoxes.boxes.length
                ? `${liveBoxes.boxes.length} ${liveBoxes.boxes[0].pestClass.toLowerCase()}${liveBoxes.boxes.length > 1 ? 's' : ''} found`
                : `Scanning — no pest (≥ ${model.threshold}% confidence)`}
            </span>
          ) : (
            <span className="truncate" style={{ color: model.available ? '#f97316' : '#4a7a58' }}>
              {model.message || 'Starting…'}
            </span>
          )}
        </div>
      )}

      {isLive && recordError && (
        <div className="px-3 py-1.5 font-mono text-xs" style={{ borderTop: '1px solid #1a3022', color: '#f97316' }}>
          Not recording — {recordError}
        </div>
      )}

      {/* Status bar */}
      <div className="grid grid-cols-4 gap-px" style={{ borderTop: '1px solid #1a3022', background: '#1a3022' }}>
        {[
          { label: 'CAMERA', value: cameraValue, color: cameraColor },
          { label: 'DETECTION', value: detectionValue, color: detectionColor },
          {
            label: 'CONFIDENCE',
            value: isDetected ? `${detection!.confidence.toFixed(1)}%` : '—',
            color: isDetected ? '#f97316' : '#4a7a58',
          },
          // Spray hardware is not integrated yet, so it stays on standby
          { label: 'SPRAY', value: 'STANDBY', color: '#4a7a58' },
        ].map(item => (
          <div key={item.label} className="px-3 py-2" style={{ background: '#0a1a10' }}>
            <div className="font-mono text-xs mb-0.5" style={{ color: '#4a7a58' }}>{item.label}</div>
            <div className="font-mono text-xs font-600" style={{ color: item.color }}>{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                       */
/* -------------------------------------------------------------------------- */
export default function LiveMonitoring() {
  const zones = useZones();
  const [states, setStates] = useState<Record<string, CamState>>({});

  const handleStateChange = useCallback((zoneId: string, state: CamState) => {
    setStates(prev => (prev[zoneId] === state ? prev : { ...prev, [zoneId]: state }));
  }, []);

  const onlineCount = Object.values(states).filter(s => s === 'live').length;
  const anyOnline = onlineCount > 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-800 text-green-50 uppercase tracking-widest">Live Monitoring</h1>
          <p className="font-mono text-xs mt-1" style={{ color: '#4a7a58' }}>
            Camera feeds — {zones.length} Crop Zones
          </p>
        </div>
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{ background: '#0a1a10', border: '1px solid #1a3022' }}
        >
          <span
            className={`w-2 h-2 rounded-full ${anyOnline ? 'bg-green-500 animate-pulse' : ''}`}
            style={anyOnline ? undefined : { background: '#2d4e38' }}
          />
          <span className="font-mono text-xs font-600" style={{ color: anyOnline ? '#4ade80' : '#4a7a58' }}>
            {onlineCount} / {zones.length} CAMERAS ONLINE
          </span>
        </div>
      </div>

      {/* 2x2 grid on desktop, stack on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {zones.map(z => (
          <CameraPanel key={z.id} zone={z} onStateChange={handleStateChange} />
        ))}
      </div>

      {/* Integration note */}
      <div className="text-center font-mono text-xs py-2" style={{ color: '#2d4e38' }}>
        Add stream URLs in CAMERA_STREAMS (top of this file) or press “Connect” on a zone to test a camera directly.
      </div>
    </div>
  );
}