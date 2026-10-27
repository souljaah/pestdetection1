import { useState, useEffect } from 'react';
import type { Page } from '../types';
import {
  useAllDetections,
  useBackendAlerts,
  useCameraAlerts,
  useCameraMonitor,
  useCameraStates,
  useSystemStatus,
  useZones,
  type AppAlert,
} from '../lib/cameras';

const PAGE_TITLES: Record<Page, string> = {
  'dashboard': 'Dashboard',
  'live-monitoring': 'Live Monitoring',
  'recordings': 'Recordings',
  'detection-logs': 'Detection Logs',
  'spray-logs': 'Spray Logs',
  'history': 'Historical Monitoring',
  'camera-status': 'Camera Status',
  'system-settings': 'System Settings',
};

interface HeaderProps {
  currentPage: Page;
  onMobileMenuToggle: () => void;
}

const isCritical = (a: AppAlert) => a.type === 'pest_detected' || a.type === 'camera_offline';
const needsAttention = (a: AppAlert) => isCritical(a) || a.type === 'camera_not_connected';

function alertStyle(a: AppAlert) {
  if (isCritical(a)) return { color: '#ef4444', dot: '🔴' };
  if (a.type === 'camera_not_connected') return { color: '#eab308', dot: '🟡' };
  if (a.type === 'spray_activated') return { color: '#f97316', dot: '🟠' };
  return { color: '#22c55e', dot: '🟢' };
}

export default function Header({ currentPage, onMobileMenuToggle }: HeaderProps) {
  const [time, setTime] = useState(new Date());
  const [showAlerts, setShowAlerts] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const dateStr = time.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

  // ----- Real data (all empty until the camera, detection model and backend are connected) -----
  const zones = useZones();
  const detections = useAllDetections();
  const backendAlerts = useBackendAlerts();
  const status = useSystemStatus();

  // Camera connection: checked in the background on every page, so a dropped or missing camera raises an alert
  const zoneIds = zones.map(z => String(z.id));
  useCameraMonitor(zoneIds);
  const cameraAlerts = useCameraAlerts(zones);
  const cameraStates = useCameraStates(zoneIds);

  // Pest alerts come from live detections; spray / camera / system alerts come from the backend
  const alerts: AppAlert[] = [
    ...zones
      .filter(z => detections[String(z.id)])
      .map<AppAlert>(z => {
        const d = detections[String(z.id)];
        return {
          id: `pest-${z.id}`,
          type: 'pest_detected',
          message: `Pest detected — ${z.name}`,
          detail: `${d.pestClass} (${d.confidence.toFixed(1)}%)`,
          timestamp: 'Now',
        };
      }),
    ...cameraAlerts,
    ...backendAlerts,
  ];
  const attentionCount =alerts.filter(needsAttention).length;
  const hasCritical = alerts.some(isCritical);

  // System status reflects what the backend reports; nothing is assumed
  const services = Object.values(status).filter(Boolean);
  const system =
    services.length === 0
      ? { text: 'AWAITING DEVICES', color: '#4a7a58', pulse: false }
      : services.some(s => !s!.ok)
      ? { text: 'SYSTEM FAULT', color: '#ef4444', pulse: false }
      : { text: 'SYSTEM ONLINE', color: '#4ade80', pulse: true };
  // A camera that dropped takes priority over an otherwise healthy system
  if (zoneIds.some(id => cameraStates[id] === 'error') && system.text !== 'SYSTEM FAULT') {
    system.text = 'CAMERA OFFLINE';
    system.color = '#ef4444';
    system.pulse = false;
  }

  return (
    <header
      className="fixed top-0 left-0 lg:left-64 right-0 z-20 flex items-center justify-between px-4 lg:px-6 h-14"
      style={{ background: '#060f08', borderBottom: '1px solid #1a3022' }}
    >
      {/* Left: hamburger + title */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMobileMenuToggle}
          aria-label="Open menu"
          className="lg:hidden p-1.5 rounded text-green-400 hover:text-green-300"
          style={{ background: '#0a1a10' }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect y="2" width="18" height="2" rx="1" fill="currentColor" />
            <rect y="8" width="18" height="2" rx="1" fill="currentColor" />
            <rect y="14" width="18" height="2" rx="1" fill="currentColor" />
          </svg>
        </button>

        <div>
          <div className="font-display text-xs text-green-600 tracking-widest uppercase hidden sm:block">
            Smart Crop Monitoring System
          </div>
          <div className="font-display text-base font-700 text-green-100 tracking-wide uppercase">
            {PAGE_TITLES[currentPage]}
          </div>
        </div>
      </div>

      {/* Right: status + date/time + alerts + profile */}
      <div className="flex items-center gap-3 lg:gap-5">
        {/* System status */}
        <div className="hidden md:flex items-center gap-2">
          <span
            className={`inline-block w-2 h-2 rounded-full ${system.pulse ? 'dot-online' : ''}`}
            style={{ background: system.color }}
          />
          <span className="font-mono text-xs font-600" style={{ color: system.color }}>{system.text}</span>
        </div>

        {/* Date/time */}
        <div className="hidden lg:block text-right">
          <div className="font-mono text-xs text-green-600">{dateStr}</div>
          <div className="font-mono text-sm font-600 text-green-300">{timeStr}</div>
        </div>

        {/* Alerts bell */}
        <div className="relative">
          <button
            onClick={() => setShowAlerts(v => !v)}
            aria-label="Alerts"
            className="relative p-1.5 rounded transition-colors"
            style={{ background: '#0a1a10', border: '1px solid #1a3022' }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#4ade80" strokeWidth="1.5">
              <path d="M8 1a5 5 0 0 1 5 5v3l1.5 2h-13L3 9V6a5 5 0 0 1 5-5z" />
              <path d="M6.5 13.5a1.5 1.5 0 0 0 3 0" />
            </svg>
            {attentionCount > 0 && (
              <span
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full font-mono text-xs flex items-center justify-center font-700"
                style={{ background: hasCritical ? '#ef4444' : '#eab308', color: hasCritical ? 'white' : '#1a1300', fontSize: 9 }}
              >
                {attentionCount}
              </span>
            )}
          </button>

          {showAlerts && (
            <div
              className="absolute right-0 top-10 w-80 rounded-lg overflow-hidden z-50"
              style={{ background: '#0a1a10', border: '1px solid #1a3022', boxShadow: '0 8px 32px #000a' }}
            >
              <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderBottom: '1px solid #1a3022' }}>
                <span className="font-display text-sm font-700 text-green-100 uppercase tracking-wider">Alerts</span>
                <button onClick={() => setShowAlerts(false)} aria-label="Close alerts" className="text-green-600 hover:text-green-400 text-xs">✕</button>
              </div>
              {alerts.length === 0 && (
                <div className="px-4 py-6 text-center font-mono text-xs" style={{ color: '#4a7a58' }}>
                  No alerts. Pest detections and system events will appear here.
                </div>
              )}
              {alerts.map(a => {
                const { color, dot } = alertStyle(a);
                return (
                  <div key={a.id} className="px-4 py-3" style={{ borderBottom: '1px solid #0d2115' }}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span>{dot}</span>
                      <span className="font-mono text-xs font-600" style={{ color }}>{a.message}</span>
                      {a.timestamp && (
                        <span className="ml-auto font-mono text-xs" style={{ color: '#4a7a58' }}>{a.timestamp}</span>
                      )}
                    </div>
                    <div className="text-xs text-green-400 pl-5">{a.detail}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* User */}
        <div className="w-8 h-8 rounded-full flex items-center justify-center font-display text-xs font-700"
          style={{ background: '#166534', color: '#4ade80' }}>
          AD
        </div>
      </div>
    </header>
  );
}