import { useState, useEffect, useCallback } from 'react';
import {
  CAM_STATUS,
  StreamMedia,
  useAllDetections,
  useCameraAlerts,
  useCameraFeed,
  useDetectionHistory,
  useZoneDetection,
  useZones,
  type CamState,
  type ZoneInfo,
} from '../lib/cameras';

type Zone = ZoneInfo;

function SummaryCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl p-5 flex flex-col gap-1" style={{ background: '#0a1a10', border: '1px solid #1a3022' }}>
      <span className="font-mono text-xs tracking-widest uppercase" style={{ color: '#4a7a58' }}>{label}</span>
      <span
        className="font-display text-4xl font-800 tracking-tight"
        style={{ color: accent ?? '#e8f5e9' }}
      >{value}</span>
      {sub && <span className="font-mono text-xs" style={{ color: accent ?? '#6b9478' }}>{sub}</span>}
    </div>
  );
}

function ZoneCard({
  zone,
  lastDetection,
  onStateChange,
}: {
  zone: Zone;
  lastDetection?: string;
  onStateChange: (zoneId: string, state: CamState) => void;
}) {
  const zoneId = String(zone.id);
  const { streamUrl, camState, setCamState, src } = useCameraFeed(zoneId);
  const isLive = camState === 'live';
  const detection = useZoneDetection(zoneId, isLive);
  const isDetected = isLive && !!detection;
  const status = CAM_STATUS[camState];
  const box = detection?.box ?? { x: 0.28, y: 0.28, w: 0.35, h: 0.35 };

  useEffect(() => {
    onStateChange(zoneId, camState);
  }, [zoneId, camState, onStateChange]);

  return (
    <div
      className={`rounded-xl overflow-hidden flex flex-col ${isDetected ? 'border-blink' : ''}`}
      style={{
        background: '#0a1a10',
        border: `1px solid ${isDetected ? '#ef4444' : '#1a3022'}`,
      }}
    >
      {/* Camera preview */}
      <div className="relative h-44 overflow-hidden" style={{ background: '#050e07' }}>
        {/* Placeholder — shown until a stream is actually playing */}
        {!isLive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#1a3022" strokeWidth="1.5">
              <path d="M23 7l-7 5 7 5V7z" />
              <rect x="1" y="5" width="15" height="14" rx="2" />
              {camState === 'error' && <line x1="1" y1="1" x2="23" y2="23" stroke="#ef4444" />}
            </svg>
            {camState === 'unconfigured' && (
              <>
                <span className="font-mono text-xs" style={{ color: '#4a7a58' }}>NO CAMERA CONNECTED</span>
                <span className="font-mono" style={{ color: '#2d4e38', fontSize: 10 }}>
                  Add a stream in Live Monitoring
                </span>
              </>
            )}
            {camState === 'connecting' && (
              <span className="font-mono text-xs text-orange-500 animate-pulse">CONNECTING…</span>
            )}
            {camState === 'error' && (
              <>
                <span className="font-mono text-xs text-red-500">CAMERA OFFLINE</span>
                <span className="font-mono" style={{ color: '#4a7a58', fontSize: 10 }}>Retrying automatically</span>
              </>
            )}
          </div>
        )}

        {/* Real stream */}
        <StreamMedia
          streamUrl={streamUrl}
          src={src}
          alt={`${zone.name} camera feed`}
          live={isLive}
          onLive={() => setCamState('live')}
          onError={() => setCamState('error')}
        />

        {/* Overlays — only when a real feed is live */}
        {isLive && (
          <>
            <div className="absolute inset-0 pointer-events-none" style={{
              background: 'linear-gradient(180deg, transparent 60%, #050e07 100%)',
            }} />
            <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-md"
              style={{ background: '#050e07d0' }}>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 dot-online" />
              <span className="font-mono text-xs text-green-400">LIVE</span>
            </div>
            <div className="absolute top-2 right-2 px-2 py-1 rounded-md font-mono text-xs text-green-300"
              style={{ background: '#050e07d0' }}>
              {zone.cameraId}
            </div>
            {isDetected && (
              <div
                className="absolute border-2 border-red-500 rounded"
                style={{
                  top: `${box.y * 100}%`,
                  left: `${box.x * 100}%`,
                  width: `${box.w * 100}%`,
                  height: `${box.h * 100}%`,
                }}
              >
                <div className="absolute -top-5 left-0 px-1.5 py-0.5 font-mono text-xs text-white rounded"
                  style={{ background: '#ef4444', fontSize: 9, whiteSpace: 'nowrap' }}>
                  {detection!.pestClass} {detection!.confidence.toFixed(1)}%
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Info */}
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="font-display text-base font-700 text-green-50 uppercase tracking-wider">{zone.name}</span>
          {isDetected && (
            <span className="font-mono text-xs font-600 px-2 py-0.5 rounded"
              style={{ background: '#ef444420', color: '#ef4444', border: '1px solid #ef444440' }}>
              PEST DETECTED
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="font-mono mb-0.5" style={{ color: '#4a7a58' }}>CAMERA</div>
            <div className="flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full ${isLive ? 'dot-online' : ''}`}
                style={{ background: status.color }}
              />
              <span className="font-mono font-500" style={{ color: status.color }}>{status.label}</span>
            </div>
          </div>
          <div>
            <div className="font-mono mb-0.5" style={{ color: '#4a7a58' }}>SPRAY</div>
            {/* Spray hardware is not integrated yet */}
            <span className="font-mono font-500" style={{ color: '#4a7a58' }}>STANDBY</span>
          </div>
          {isDetected && (
            <>
              <div>
                <div className="font-mono mb-0.5" style={{ color: '#4a7a58' }}>PEST</div>
                <div className="font-mono text-red-400 font-500">{detection!.pestClass}</div>
              </div>
              <div>
                <div className="font-mono mb-0.5" style={{ color: '#4a7a58' }}>CONFIDENCE</div>
                <div className="font-mono font-600" style={{ color: '#f97316' }}>{detection!.confidence.toFixed(1)}%</div>
              </div>
            </>
          )}
          <div className="col-span-2">
            <div className="font-mono mb-0.5" style={{ color: '#4a7a58' }}>LAST DETECTION</div>
            <div className="font-mono" style={{ color: lastDetection ? '#bbf7d0' : '#2d4e38' }}>
              {lastDetection ?? 'None recorded'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [states, setStates] = useState<Record<string, CamState>>({});
  const handleStateChange = useCallback((zoneId: string, state: CamState) => {
    setStates(prev => (prev[zoneId] === state ? prev : { ...prev, [zoneId]: state }));
  }, []);

  const zones = useZones();
  const allDetections = useAllDetections();
  const history = useDetectionHistory();
  const cameraAlerts = useCameraAlerts(zones);

  const total = zones.length;
  const stateOf = (z: Zone) => states[String(z.id)];
  const onlineCount = zones.filter(z => stateOf(z) === 'live').length;
  const detectedZones = zones.filter(z => stateOf(z) === 'live' && allDetections[String(z.id)]);

  // System status is derived from real camera connections
  const system =
    onlineCount === 0
      ? { value: 'STANDBY', sub: 'Waiting for cameras', accent: '#4a7a58' }
      : onlineCount === total
      ? { value: 'ONLINE', sub: 'All cameras streaming', accent: '#22c55e' }
      : { value: 'PARTIAL', sub: `${onlineCount} of ${total} cameras online`, accent: '#f97316' };

  // Alerts are generated from what is actually happening — nothing is hardcoded
  const alerts = [
    ...detectedZones.map(z => ({
      key: `pest-${z.id}`,
      color: '#ef4444',
      dot: '🔴',
      message: `Pest detected — ${z.name}`,
      detail: `${allDetections[String(z.id)].pestClass} (${allDetections[String(z.id)].confidence.toFixed(1)}%)`,
    })),
    ...cameraAlerts.map(a => ({
      key: String(a.id),
      color: a.type === 'camera_offline' ? '#ef4444' : '#eab308',
      dot: a.type === 'camera_offline' ? '🔴' : '🟡',
      message: a.message,
      detail: a.detail,
    })),
  ];

  const todayLabel = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="font-display text-3xl font-800 text-green-50 uppercase tracking-widest">
          Smart Crop Monitoring System
        </h1>
        <p className="font-mono text-sm mt-1" style={{ color: '#4a7a58' }}>
          Real-Time Pest Detection &amp; Automated Crop Protection
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard label="Total Crop Zones" value={total} sub="Zones registered" accent="#4ade80" />
        <SummaryCard
          label="Active Detections"
          value={detectedZones.length}
          sub={
            detectedZones.length > 0
              ? 'Pest events now'
              : onlineCount > 0
              ? 'All zones clear'
              : 'No camera feed yet'
          }
          accent={detectedZones.length > 0 ? '#ef4444' : onlineCount > 0 ? '#22c55e' : '#4a7a58'}
        />
        {/* Spray hardware is not integrated yet */}
        <SummaryCard label="Spray Status" value="STANDBY" sub="No spray unit connected" accent="#4a7a58" />
        <SummaryCard label="System Status" value={system.value} sub={system.sub} accent={system.accent} />
      </div>

      {/* Live alerts */}
      <div className="rounded-xl p-4" style={{ background: '#0a1a10', border: '1px solid #1a3022' }}>
        <div className="font-display text-xs tracking-widest uppercase text-green-500 mb-3">Live Alerts</div>
        {alerts.length === 0 ? (
          <div className="font-mono text-xs" style={{ color: '#4a7a58' }}>
            No active alerts. Pest detections and camera outages will appear here.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {alerts.map(a => (
              <div
                key={a.key}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                style={{ background: `${a.color}10`, border: `1px solid ${a.color}30` }}
              >
                <span>{a.dot}</span>
                <div>
                  <div className="font-mono font-600" style={{ color: a.color }}>{a.message}</div>
                  <div style={{ color: '#86a98c' }}>{a.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Zone cards */}
      <div>
        <div className="font-display text-xs tracking-widest uppercase text-green-500 mb-3">
          Real-Time Crop Zone Monitor
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {zones.map(z => (
            <ZoneCard
              key={z.id}
              zone={z}
              lastDetection={history.find(d => d.zoneName === z.name)?.time}
              onStateChange={handleStateChange}
            />
          ))}
        </div>
      </div>

      {/* Recent detections quick table */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#0a1a10', border: '1px solid #1a3022' }}>
        <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid #1a3022' }}>
          <span className="font-display text-xs tracking-widest uppercase text-green-500">Recent Detections</span>
          <span className="font-mono text-xs text-green-600">Today, {todayLabel}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid #1a3022' }}>
                {['ID', 'Zone', 'Camera', 'Pest', 'Confidence', 'Time', 'Status'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-mono tracking-wider uppercase"
                    style={{ color: '#4a7a58' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center font-mono" style={{ color: '#4a7a58' }}>
                    No detections recorded yet. Pest detections will be listed here once a camera and the
                    detection model are running.
                  </td>
                </tr>
              ) : (
                history.map(d => (
                  <tr key={d.id} className="hover:bg-green-950/30 transition-colors" style={{ borderBottom: '1px solid #0d2115' }}>
                    <td className="px-4 py-2.5 font-mono text-green-600">#{d.id}</td>
                    <td className="px-4 py-2.5 font-display font-600 text-green-200 uppercase tracking-wide">{d.zoneName}</td>
                    <td className="px-4 py-2.5 font-mono text-green-400">{d.camera}</td>
                    <td className="px-4 py-2.5 font-mono text-red-400">{d.pestClass}</td>
                    <td className="px-4 py-2.5 font-mono font-600 text-orange-400">{d.confidence.toFixed(1)}%</td>
                    <td className="px-4 py-2.5 font-mono text-green-400">{d.time}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono px-2 py-0.5 rounded text-xs"
                        style={{
                          background: d.status === 'confirmed' ? '#22c55e20' : '#f9731620',
                          color: d.status === 'confirmed' ? '#4ade80' : '#f97316',
                        }}>
                        {d.status.replace('_', ' ').toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}