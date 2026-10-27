import { useState, useEffect, useCallback } from 'react';
import type { SignalStrength } from '../types';
import {
  CAM_STATUS,
  CAMERA_STREAMS,
  RETRY_SECONDS,
  StreamMedia,
  useCameraFeed,
  useCameraTelemetry,
  useZones,
  type CamState,
  type CameraTelemetry,
  type ZoneInfo,
} from '../lib/cameras';

type Zone = ZoneInfo;

const SIGNAL_COLOR: Record<SignalStrength, string> = {
  strong: '#22c55e',
  medium: '#eab308',
  weak: '#f97316',
  none: '#ef4444',
};

function SignalBars({ signal }: { signal: SignalStrength }) {
  const levels = { strong: 3, medium: 2, weak: 1, none: 0 };
  const filled = levels[signal];
  return (
    <div className="flex items-end gap-0.5 h-4">
      {[1, 2, 3].map(i => (
        <div key={i}
          className="w-2 rounded-sm transition-colors"
          style={{
            height: i === 1 ? 8 : i === 2 ? 11 : 14,
            background: i <= filled ? SIGNAL_COLOR[signal] : '#1a3022',
          }}
        />
      ))}
    </div>
  );
}

/** Host (and port) of the camera, taken from its stream URL. */
function addressOf(url: string) {
  if (!url) return '—';
  try {
    if (/^https?:\/\//i.test(url)) return new URL(url).host;
  } catch {
    /* fall through */
  }
  return 'Via server';
}

function CameraCard({
  zone,
  telemetry,
  onStateChange,
  onViewFeed,
}: {
  zone: Zone;
  telemetry?: CameraTelemetry;
  onStateChange: (zoneId: string, state: CamState) => void;
  onViewFeed?: (zoneId: string) => void;
}) {
  const zoneId = String(zone.id);
  const { streamUrl, customUrl, setStreamUrl, saveError, camState, setCamState, src, reconnect } = useCameraFeed(zoneId);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [lastConnected, setLastConnected] = useState<Date | null>(null);
  const [measuredRes, setMeasuredRes] = useState('');

  const isLive = camState === 'live';
  const isError = camState === 'error';
  const status = CAM_STATUS[camState];

  useEffect(() => {
    onStateChange(zoneId, camState);
  }, [zoneId, camState, onStateChange]);

  useEffect(() => {
    if (!streamUrl) {
      setMeasuredRes('');
      setLastConnected(null);
    }
  }, [streamUrl]);

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

  const signal = isLive ? telemetry?.signal : undefined;
  const fps = isLive ? telemetry?.fps : undefined;
  const resolution = isLive ? telemetry?.resolution ?? measuredRes : '';
  const mixedContent =
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    streamUrl.startsWith('http:');

  return (
    <div className="rounded-xl p-5 flex flex-col gap-4"
      style={{ background: '#0a1a10', border: `1px solid ${isError ? '#ef444430' : '#1a3022'}` }}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="font-display text-base font-700 text-green-100 uppercase tracking-wider">{zone.cameraId}</div>
          <div className="font-display text-xs text-green-600 uppercase tracking-wide mt-0.5">{zone.name}</div>
        </div>
        <span
          className={`font-mono text-xs font-600 px-2.5 py-1 rounded-full ${camState === 'connecting' ? 'animate-pulse' : ''}`}
          style={{
            background: `${status.color}20`,
            color: status.color,
            border: `1px solid ${status.color}40`,
          }}
        >
          {status.label}
        </span>
      </div>

      {/* Camera preview thumbnail */}
      <div className="relative h-28 rounded-lg overflow-hidden" style={{ background: '#050e07' }}>
        {!isLive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={isError ? '#ef444450' : '#1e3829'} strokeWidth="1.5">
              <path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" />
              {isError && <line x1="1" y1="1" x2="23" y2="23" stroke="#ef4444" />}
            </svg>
            <span
              className={`font-mono ${camState === 'connecting' ? 'animate-pulse' : ''}`}
              style={{ fontSize: 9, color: isError ? '#b91c1c' : camState === 'connecting' ? '#f97316' : '#4a7a58' }}
            >
              {camState === 'unconfigured' ? 'NO CAMERA CONNECTED' : camState === 'connecting' ? 'CONNECTING…' : 'NO SIGNAL'}
            </span>
          </div>
        )}

        <StreamMedia
          streamUrl={streamUrl}
          src={src}
          alt={`${zone.name} preview`}
          live={isLive}
          onLive={size => {
            setCamState('live');
            setLastConnected(new Date());
            if (size?.width && size?.height) setMeasuredRes(`${size.width}×${size.height}`);
          }}
          onError={() => setCamState('error')}
        />

        {isLive && (
          <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded"
            style={{ background: '#050e07c0' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 dot-online" />
            <span className="font-mono text-xs text-green-400" style={{ fontSize: 9 }}>LIVE</span>
          </div>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <div className="font-mono mb-1 tracking-wider" style={{ color: '#4a7a58' }}>SIGNAL</div>
          {signal ? (
            <div className="flex items-center gap-2">
              <SignalBars signal={signal} />
              <span className="font-mono font-500" style={{ color: SIGNAL_COLOR[signal] }}>{signal.toUpperCase()}</span>
            </div>
          ) : (
            <div className="font-mono" style={{ color: '#2d4e38' }}>—</div>
          )}
        </div>
        <div>
          <div className="font-mono mb-1 tracking-wider" style={{ color: '#4a7a58' }}>LAST CONNECTED</div>
          <div className="font-mono" style={{ color: lastConnected ? '#86efac' : '#2d4e38' }}>
            {lastConnected
              ? lastConnected.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' })
              : 'Never'}
          </div>
        </div>
        <div>
          <div className="font-mono mb-1 tracking-wider" style={{ color: '#4a7a58' }}>IP ADDRESS</div>
          <div className="font-mono truncate" style={{ color: streamUrl ? '#4ade80' : '#2d4e38' }}>{addressOf(streamUrl)}</div>
        </div>
        <div>
          <div className="font-mono mb-1 tracking-wider" style={{ color: '#4a7a58' }}>FPS / RES</div>
          <div className="font-mono" style={{ color: fps ? '#86efac' : '#2d4e38' }}>{fps ? `${fps} fps` : '—'}</div>
          <div className="font-mono" style={{ color: resolution ? '#4a7a58' : '#2d4e38', fontSize: 10 }}>{resolution || '—'}</div>
        </div>
      </div>

      {/* Actions / stream editor */}
      {editing ? (
        <div className="flex flex-col gap-2 pt-1">
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') saveDraft();
              if (e.key === 'Escape') setEditing(false);
            }}
            autoFocus
            placeholder="http://192.168.1.50:81/stream"
            className="w-full font-mono text-xs px-2.5 py-2 rounded-lg outline-none"
            style={{ background: '#050e07', border: '1px solid #1a3022', color: '#bbf7d0' }}
          />
          <div className="flex gap-2">
            <button
              onClick={saveDraft}
              className="flex-1 py-2 rounded-lg font-mono text-xs font-600 transition-all hover:opacity-90"
              style={{ background: '#15803d', color: '#f0fdf4' }}
            >
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-2 rounded-lg font-mono text-xs transition-all hover:opacity-90"
              style={{ background: '#0d2115', color: '#4a7a58', border: '1px solid #1a3022' }}
            >
              Cancel
            </button>
            {customUrl && (
              <button
                onClick={disconnect}
                className="px-3 py-2 rounded-lg font-mono text-xs transition-all hover:opacity-90"
                style={{ background: '#0d2115', color: '#ef4444', border: '1px solid #1a3022' }}
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex gap-2 pt-1">
          {camState === 'unconfigured' && (
            <button
              onClick={startEditing}
              className="flex-1 py-2 rounded-lg font-mono text-xs font-600 transition-all hover:opacity-90"
              style={{ background: '#22c55e20', color: '#4ade80', border: '1px solid #22c55e40' }}
            >
              Connect camera
            </button>
          )}
          {isError && (
            <button
              onClick={reconnect}
              className="flex-1 py-2 rounded-lg font-mono text-xs font-600 transition-all hover:opacity-90"
              style={{ background: '#22c55e20', color: '#4ade80', border: '1px solid #22c55e40' }}
            >
              Reconnect
            </button>
          )}
          {camState === 'connecting' && (
            <button
              disabled
              className="flex-1 py-2 rounded-lg font-mono text-xs font-600 opacity-60"
              style={{ background: '#0d2115', color: '#f97316', border: '1px solid #1a3022' }}
            >
              Connecting…
            </button>
          )}
          {isLive && onViewFeed && (
            <button
              onClick={() => onViewFeed(zoneId)}
              className="flex-1 py-2 rounded-lg font-mono text-xs font-600 transition-all hover:opacity-90"
              style={{ background: '#0d2115', color: '#4ade80', border: '1px solid #1a3022' }}
            >
              View Feed
            </button>
          )}
          {camState !== 'unconfigured' && (
            <button
              onClick={startEditing}
              className={`${isLive && !onViewFeed ? 'flex-1' : ''} px-3 py-2 rounded-lg font-mono text-xs transition-all hover:opacity-90`}
              style={{ background: '#0d2115', color: '#4a7a58', border: '1px solid #1a3022' }}
              title="Change stream URL"
            >
              ⚙ {isLive && !onViewFeed ? 'Configure' : ''}
            </button>
          )}
        </div>
      )}

      {saveError && (
        <div className="font-mono text-xs text-red-400">{saveError}</div>
      )}

      {isError && (
        <div className="rounded-lg px-3 py-2 flex items-start gap-2"
          style={{ background: '#ef444415', border: '1px solid #ef444430' }}>
          <span className="text-xs">⚠️</span>
          <span className="font-mono text-xs text-red-400">
            Camera unreachable — check power, network and stream URL. Retrying in {RETRY_SECONDS}s.
            {mixedContent && ' This page is HTTPS but the stream is HTTP, so the browser blocks it.'}
          </span>
        </div>
      )}
    </div>
  );
}

export default function CameraStatus({ onViewFeed }: { onViewFeed?: (zoneId: string) => void } = {}) {
  const [states, setStates] = useState<Record<string, CamState>>({});
  const handleStateChange = useCallback((zoneId: string, state: CamState) => {
    setStates(prev => (prev[zoneId] === state ? prev : { ...prev, [zoneId]: state }));
  }, []);

  const zones = useZones();
  const telemetry = useCameraTelemetry();

  const total = zones.length;
  const stateOf = (z: Zone): CamState | undefined => states[String(z.id)];
  const online = zones.filter(z => stateOf(z) === 'live').length;
  const offlineZones = zones.filter(z => stateOf(z) === 'error');
  const noneConnected = zones.every(z => (stateOf(z) ?? 'unconfigured') === 'unconfigured');

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-800 text-green-50 uppercase tracking-widest">Camera Status</h1>
          <p className="font-mono text-xs mt-1" style={{ color: '#4a7a58' }}>
            Camera module health and connectivity
          </p>
        </div>
        <div className="text-right">
          <div className="font-display text-3xl font-800" style={{ color: online > 0 ? '#4ade80' : '#4a7a58' }}>
            {online}/{total}
          </div>
          <div className="font-mono text-xs" style={{ color: '#4a7a58' }}>Cameras Online</div>
        </div>
      </div>

      {/* Nothing connected yet */}
      {noneConnected && (
        <div className="rounded-xl px-5 py-3 flex items-center gap-3"
          style={{ background: '#0a1a10', border: '1px solid #1a3022' }}>
          <div className="w-2 h-2 rounded-full" style={{ background: '#4a7a58' }} />
          <span className="font-mono text-xs" style={{ color: '#6b9478' }}>
            No cameras connected yet. Press “Connect camera” on a card, or set the stream URLs in CAMERA_STREAMS
            (src/lib/cameras.tsx).
          </span>
        </div>
      )}

      {/* Offline warning */}
      {offlineZones.length > 0 && (
        <div className="rounded-xl px-5 py-3 flex items-center gap-3"
          style={{ background: '#ef444410', border: '1px solid #ef444430' }}>
          <div className="w-2 h-2 rounded-full bg-red-500 dot-danger" />
          <span className="font-display text-sm font-600 text-red-400 uppercase tracking-wider">
            Warning: {offlineZones.length} Camera(s) Disconnected
          </span>
        </div>
      )}

      {/* Network summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {zones.map(z => {
          const st = stateOf(z) ?? 'unconfigured';
          const s = CAM_STATUS[st];
          return (
            <div key={z.id} className="rounded-lg px-4 py-3 flex items-center gap-3"
              style={{ background: '#0a1a10', border: `1px solid ${st === 'error' ? '#ef444430' : '#1a3022'}` }}>
              <div
                className={`w-2 h-2 rounded-full ${st === 'live' ? 'dot-online' : st === 'error' ? 'dot-danger' : ''} ${st === 'connecting' ? 'animate-pulse' : ''}`}
                style={{ background: s.color }}
              />
              <div>
                <div className="font-mono text-xs font-600" style={{ color: s.color }}>{z.cameraId}</div>
                <div className="font-mono text-xs" style={{ color: '#4a7a58' }}>{z.name}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Camera cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {zones.map(z => (
          <CameraCard
            key={z.id}
            zone={z}
            telemetry={telemetry[String(z.id)]}
            onStateChange={handleStateChange}
            onViewFeed={onViewFeed}
          />
        ))}
      </div>
    </div>
  );
}