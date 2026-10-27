import { useEffect, useRef, useState } from 'react';
import { getSettings, updateSettings, type ApiSettings } from '../lib/api';
import {
  getConfiguredCameraCount,
  useSystemStatus,
  useZones,
  type ServiceStatus,
} from '../lib/cameras';

/* ------------------------------ health rows ------------------------------- */
type Health = 'ok' | 'fault' | 'idle';

const HEALTH_STYLE: Record<Health, { color: string; label: string }> = {
  ok: { color: '#22c55e', label: 'OPERATIONAL' },
  fault: { color: '#ef4444', label: 'FAULT' },
  idle: { color: '#4a7a58', label: 'NOT CONNECTED' },
};

function StatusRow({ label, state, sub, text }: { label: string; state: Health; sub?: string; text?: string }) {
  const style = HEALTH_STYLE[state];
  return (
    <div className="flex items-center justify-between py-3" style={{ borderBottom: '1px solid #0d2115' }}>
      <div className="flex items-center gap-3">
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center ${state === 'ok' ? 'dot-online' : state === 'fault' ? 'dot-danger' : ''}`}
          style={{ background: `${style.color}15`, border: `1px solid ${style.color}30` }}
        >
          {state === 'ok' && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={style.color} strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
          )}
          {state === 'fault' && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={style.color} strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          )}
          {state === 'idle' && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={style.color} strokeWidth="2.5"><line x1="6" y1="12" x2="18" y2="12" /></svg>
          )}
        </div>
        <div>
          <div className="font-display text-sm font-600 text-green-100 uppercase tracking-wide">{label}</div>
          {sub && <div className="font-mono text-xs" style={{ color: '#4a7a58' }}>{sub}</div>}
        </div>
      </div>
      <span className="font-mono text-xs font-600" style={{ color: style.color }}>
        {text ?? style.label}
      </span>
    </div>
  );
}

/** Turns what the backend reports (or nothing yet) into a row. */
function serviceRow(status: ServiceStatus | undefined, waiting: string): { state: Health; sub: string } {
  if (!status) return { state: 'idle', sub: waiting };
  return { state: status.ok ? 'ok' : 'fault', sub: status.detail ?? '' };
}

/* -------------------------------- settings -------------------------------- */
// Shown until GET /api/settings answers; these match the schema.sql defaults.
const DEFAULT_SETTINGS: ApiSettings = {
  threshold: 85,
  sprayDuration: 5,
  autoSpray: true,
  notifications: true,
};

/* ---------------------------------- page ---------------------------------- */
export default function SystemSettings() {
  const [threshold, setThreshold] = useState(DEFAULT_SETTINGS.threshold);
  const [sprayDuration, setSprayDuration] = useState(DEFAULT_SETTINGS.sprayDuration);
  const [autoSpray, setAutoSpray] = useState(DEFAULT_SETTINGS.autoSpray);
  const [notifications, setNotifications] = useState(DEFAULT_SETTINGS.notifications);
  const [saved, setSaved] = useState(false);
  const [saveNote, setSaveNote] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);
  const saving = useRef(false); // ignores repeat clicks while a save is in progress

  useEffect(() => {
    let active = true;
    getSettings()
      .then(settings => {
        if (!active) return;
        setThreshold(settings.threshold);
        setSprayDuration(settings.sprayDuration);
        setAutoSpray(settings.autoSpray);
        setNotifications(settings.notifications);
      })
      .catch(error => {
        if (!active) return;
        setSaveFailed(true);
        setSaveNote(`Could not load settings — ${error instanceof Error ? error.message : 'API unavailable'}`);
      });
    return () => {
      active = false;
    };
  }, []);

  // Hardware/backend health from the Flask API (/api/system-status).
  const status = useSystemStatus();
  const zones = useZones();
  const totalCameras = zones.length;
  const configuredCameras = getConfiguredCameraCount(zones.map(z => String(z.id)));

  const handleSave = async () => {
    if (saving.current) return;
    saving.current = true;
    try {
      const stored = await updateSettings({ threshold, sprayDuration, autoSpray, notifications });
      setThreshold(stored.threshold);
      setSprayDuration(stored.sprayDuration);
      setAutoSpray(stored.autoSpray);
      setNotifications(stored.notifications);
      setSaveFailed(false);
      setSaveNote('Saved to the database');
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        setSaveNote('');
      }, 2500);
    } catch (error) {
      setSaveFailed(true);
      setSaveNote(`Not saved — ${error instanceof Error ? error.message : 'API unavailable'}`);
    } finally {
      saving.current = false;
    }
  };

  const controller = serviceRow(status.controller, 'Waiting for device');
  const model = serviceRow(status.model, 'Waiting for detection service');
  const sprayCtl = serviceRow(status.sprayController, 'Waiting for spray unit');
  const database = serviceRow(status.database, 'Waiting for backend');
  const network = serviceRow(status.network, 'Waiting for Flask API');

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="font-display text-2xl font-800 text-green-50 uppercase tracking-widest">System Settings</h1>
        <p className="font-mono text-xs mt-1" style={{ color: '#4a7a58' }}>
          System health, configuration, and API integration
        </p>
      </div>

      {/* System health */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#0a1a10', border: '1px solid #1a3022' }}>
        <div className="px-5 py-3.5" style={{ borderBottom: '1px solid #1a3022' }}>
          <span className="font-display text-xs tracking-widest uppercase text-green-500">System Health</span>
        </div>
        <div className="px-5">
          <StatusRow label="Embedded Controller" {...controller} />
          <StatusRow
            label="Camera Modules"
            state={configuredCameras === 0 ? 'idle' : configuredCameras === totalCameras ? 'ok' : 'idle'}
            text={configuredCameras === 0 ? undefined : `${configuredCameras}/${totalCameras} CONFIGURED`}
            sub={
              configuredCameras === 0
                ? 'No camera streams added — set them up on the Camera Status page'
                : 'Live connection status is shown on the Camera Status page'
            }
          />
          <StatusRow label="Pest Detection Model" {...model} />
          <StatusRow label="Spray Controller" {...sprayCtl} />
          <StatusRow label="SQLite Database" {...database} />
          <StatusRow label="Network" {...network} />
        </div>
      </div>

      {/* Detection settings */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#0a1a10', border: '1px solid #1a3022' }}>
        <div className="px-5 py-3.5" style={{ borderBottom: '1px solid #1a3022' }}>
          <span className="font-display text-xs tracking-widest uppercase text-green-500">Detection Configuration</span>
        </div>
        <div className="px-5 py-4 space-y-5">
          {/* Confidence threshold */}
          <div>
            <div className="flex justify-between mb-2">
              <label className="font-mono text-xs tracking-wider uppercase" style={{ color: '#4a7a58' }}>
                Detection Confidence Threshold
              </label>
              <span className="font-mono text-sm font-600 text-green-400">{threshold}%</span>
            </div>
            <input type="range" min={50} max={99} value={threshold} onChange={e => setThreshold(Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{ background: `linear-gradient(90deg, #22c55e ${((threshold - 50) / 49) * 100}%, #1a3022 ${((threshold - 50) / 49) * 100}%)` }}
            />
            <div className="flex justify-between font-mono text-xs mt-1" style={{ color: '#4a7a58' }}>
              <span>50%</span><span>Low confidence alerts ignored below this value</span><span>99%</span>
            </div>
          </div>

          {/* Spray duration */}
          <div>
            <div className="flex justify-between mb-2">
              <label className="font-mono text-xs tracking-wider uppercase" style={{ color: '#4a7a58' }}>
                Default Spray Duration
              </label>
              <span className="font-mono text-sm font-600 text-orange-400">{sprayDuration}s</span>
            </div>
            <input type="range" min={1} max={30} value={sprayDuration} onChange={e => setSprayDuration(Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{ background: `linear-gradient(90deg, #f97316 ${((sprayDuration - 1) / 29) * 100}%, #1a3022 ${((sprayDuration - 1) / 29) * 100}%)` }}
            />
            <div className="flex justify-between font-mono text-xs mt-1" style={{ color: '#4a7a58' }}>
              <span>1s</span><span>30s</span>
            </div>
          </div>

          {/* Toggles */}
          <div className="flex flex-col gap-4">
            {[
              { label: 'Auto Spray Activation', sub: 'Automatically trigger sprayer when pest detected', value: autoSpray, set: setAutoSpray },
              { label: 'Real-Time Notifications', sub: 'Push alerts for detections and system events', value: notifications, set: setNotifications },
            ].map(t => (
              <div key={t.label} className="flex items-center justify-between py-3" style={{ borderTop: '1px solid #0d2115' }}>
                <div>
                  <div className="font-display text-sm font-600 text-green-100 uppercase tracking-wide">{t.label}</div>
                  <div className="font-mono text-xs mt-0.5" style={{ color: '#4a7a58' }}>{t.sub}</div>
                </div>
                <button
                  role="switch"
                  aria-checked={t.value}
                  aria-label={t.label}
                  onClick={() => t.set(v => !v)}
                  className="relative w-11 h-6 rounded-full transition-colors duration-200"
                  style={{ background: t.value ? '#22c55e' : '#1a3022' }}
                >
                  <div className="absolute top-1 w-4 h-4 rounded-full transition-transform duration-200"
                    style={{ background: 'white', transform: t.value ? 'translateX(22px)' : 'translateX(4px)' }} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* API Integration */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#0a1a10', border: '1px solid #1a3022' }}>
        <div className="px-5 py-3.5" style={{ borderBottom: '1px solid #1a3022' }}>
          <span className="font-display text-xs tracking-widest uppercase text-green-500">Flask API Integration</span>
        </div>
        <div className="px-5 py-4 space-y-2">
          <p className="font-mono text-xs mb-3" style={{ color: '#4a7a58' }}>
            Endpoints for embedded device communication:
          </p>
          {[
            { method: 'GET', path: '/api/cameras', desc: 'Camera status and metadata' },
            { method: 'GET', path: '/api/cameras/stream/{id}', desc: 'Live video stream for one camera (MJPEG)' },
            { method: 'GET', path: '/api/detections', desc: 'Pest detection records from SQLite' },
            { method: 'POST', path: '/api/detections', desc: 'Submit new detection from embedded device' },
            { method: 'GET', path: '/api/sprays', desc: 'Spray activation log' },
            { method: 'POST', path: '/api/sprays/trigger', desc: 'Trigger spray for a specific zone' },
            { method: 'GET', path: '/api/system-status', desc: 'Full system health check' },
            { method: 'WS', path: '/ws/stream', desc: 'Real-time camera frames + detection events' },
          ].map(e => (
            <div key={`${e.method}-${e.path}`} className="flex items-center gap-3 py-2 rounded-lg px-3"
              style={{ background: '#0d2115', border: '1px solid #1a3022' }}>
              <span className="font-mono text-xs font-600 w-10 text-center rounded px-1 py-0.5"
                style={{
                  background: e.method === 'GET' ? '#22c55e20' : e.method === 'POST' ? '#3b82f620' : '#f9731620',
                  color: e.method === 'GET' ? '#4ade80' : e.method === 'POST' ? '#60a5fa' : '#f97316',
                }}>
                {e.method}
              </span>
              <span className="font-mono text-xs text-green-300 w-48 shrink-0">{e.path}</span>
              <span className="font-mono text-xs" style={{ color: '#4a7a58' }}>{e.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Save button */}
      <div className="flex items-center justify-end gap-4">
        <span className="font-mono text-xs" style={{ color: saveFailed ? '#ef4444' : '#4a7a58' }}>
          {saveNote || 'Stored in the SQLite table system_settings'}
        </span>
        <button onClick={handleSave}
          className="px-6 py-2.5 rounded-lg font-display text-sm font-700 uppercase tracking-wider transition-all"
          style={{
            background: saved ? '#22c55e40' : '#22c55e',
            color: saved ? '#4ade80' : '#030a05',
            border: `1px solid ${saved ? '#22c55e' : 'transparent'}`,
          }}>
          {saved ? '✓ Settings Saved' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
