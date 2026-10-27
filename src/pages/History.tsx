import { useState, useMemo, type ReactNode } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import {
  PEST_CLASSES,
  mentionsPest,
  samePest,
  useDetectionLogs,
  useSprayLogs,
  useSystemEvents,
  useZones,
  type HistoryEvent,
} from '../lib/cameras';

const EVENT_ICONS: Record<string, string> = {
  detection: '🔴',
  spray_start: '🟠',
  spray_end: '🟢',
  camera: '🔵',
  system: '⚪',
};

const EVENT_COLORS: Record<string, string> = {
  detection: '#ef4444',
  spray_start: '#f97316',
  spray_end: '#22c55e',
  camera: '#3b82f6',
  system: '#6b9478',
};

const ZONE_LINE_COLORS = ['#4ade80', '#f97316', '#3b82f6', '#eab308', '#a855f7', '#ec4899'];

const PEST_OPTIONS = ['All', ...PEST_CLASSES];

const chartStyle = {
  backgroundColor: 'transparent',
  border: 'none',
};

const tooltipStyle = {
  contentStyle: { background: '#0d2115', border: '1px solid #1a3022', borderRadius: 6, fontFamily: 'JetBrains Mono', fontSize: 11 },
  labelStyle: { color: '#4ade80' },
  itemStyle: { color: '#86efac' },
};

/* ------------------------------ date helpers ------------------------------ */
function isoLocal(d: Date) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Accepts 'MM/DD/YYYY' (log format) or 'YYYY-MM-DD' and returns 'YYYY-MM-DD'. */
function toISO(date: string) {
  if (date.includes('/')) {
    const [m, d, y] = date.split('/');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return date;
}

function timeKey(t: string) {
  const m = t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!m) return 0;
  let h = +m[1];
  const ap = m[4]?.toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 3600 + +m[2] * 60 + +(m[3] || 0);
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  if (!fy || !ty) return out;
  const cur = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  while (cur <= end && out.length < 92) {
    out.push(isoLocal(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function prettyDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function ChartEmpty({ height, children }: { height: number; children: ReactNode }) {
  return (
    <div
      className="flex items-center justify-center text-center rounded-lg px-4"
      style={{ height, border: '1px dashed #1a3022' }}
    >
      <span className="font-mono text-xs" style={{ color: '#4a7a58' }}>{children}</span>
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */
export default function History() {
  // All empty until cameras, the detection model, spray unit and backend are connected
  const detections = useDetectionLogs();
  const sprays = useSprayLogs();
  const systemEvents = useSystemEvents();
  const zones = useZones();
  const ZONE_NAMES = useMemo(() => zones.map(z => z.name), [zones]);

  const now = new Date();
  const weekAgo = new Date();
  weekAgo.setDate(now.getDate() - 6);

  const [zoneFilter, setZoneFilter] = useState('All');
  const [pestFilter, setPestFilter] = useState('All');
  const [dateFrom, setDateFrom] = useState(isoLocal(weekAgo));
  const [dateTo, setDateTo] = useState(isoLocal(now));

  const inRange = (date: string) => {
    const iso = toISO(date);
    return iso >= dateFrom && iso <= dateTo;
  };
  const zoneOk = (zone: string) => zoneFilter === 'All' || zone === zoneFilter;

  // Records after applying the filters (used by the charts)
  const fDetections = useMemo(
    () => detections.filter(d => inRange(d.date) && zoneOk(d.zoneName) && (pestFilter === 'All' || samePest(d.pestClass, pestFilter))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detections, dateFrom, dateTo, zoneFilter, pestFilter],
  );
  const fSprays = useMemo(
    () => sprays.filter(s => inRange(s.date) && zoneOk(s.zoneName) && (pestFilter === 'All' || mentionsPest(s.trigger, pestFilter))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sprays, dateFrom, dateTo, zoneFilter, pestFilter],
  );

  const visibleZones = zoneFilter === 'All' ? ZONE_NAMES : ZONE_NAMES.filter(n => n === zoneFilter);

  // Chart 1: detections per day, one line per zone
  const detectionsByDay = useMemo(() => {
    return daysBetween(dateFrom, dateTo).map(day => {
      const row: Record<string, string | number> = { day: day.slice(5).replace('-', '/') };
      ZONE_NAMES.forEach(n => {
        row[n] = fDetections.filter(d => toISO(d.date) === day && d.zoneName === n).length;
      });
      return row;
    });
  }, [fDetections, dateFrom, dateTo]);

  // Chart 2: spray activations per zone
  const spraysByZone = useMemo(
    () => visibleZones.map(n => ({ zone: n, activations: fSprays.filter(s => s.zoneName === n).length })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fSprays, zoneFilter],
  );

  // Chart 3: most frequent pests
  const topPests = useMemo(() => {
    const counts: Record<string, number> = {};
    fDetections.forEach(d => { counts[d.pestClass] = (counts[d.pestClass] || 0) + 1; });
    return Object.entries(counts)
      .map(([pest, count]) => ({ pest, count }))
      .sort((a, b) => b.count - a.count);
  }, [fDetections]);

  // Timeline: built from the real logs (+ camera/system events from the backend)
  const allEvents: (HistoryEvent & { sort: string; key: number })[] = useMemo(() => {
    const events: HistoryEvent[] = [
      ...detections.map<HistoryEvent>(d => ({
        id: `det-${d.id}`,
        type: 'detection',
        date: d.date,
        time: d.time,
        zone: d.zoneName,
        event: 'Pest detected',
        detail: `${d.pestClass} — ${d.confidence.toFixed(1)}% confidence (${d.camera})`,
      })),
      ...sprays.map<HistoryEvent>(s => ({
        id: `spray-${s.id}`,
        type: s.status === 'active' ? 'spray_start' : s.status === 'completed' ? 'spray_end' : 'system',
        date: s.date,
        time: s.time,
        zone: s.zoneName,
        event:
          s.status === 'active' ? 'Spray activated'
          : s.status === 'completed' ? 'Spray completed'
          : s.status === 'failed' ? 'Spray failed'
          : 'Spray cancelled',
        detail: `${s.trigger} — ${s.duration}s`,
      })),
      ...systemEvents,
    ];
    return events
      .map(e => ({ ...e, sort: toISO(e.date), key: timeKey(e.time) }))
      .sort((a, b) => (a.sort === b.sort ? b.key - a.key : b.sort.localeCompare(a.sort)));
  }, [detections, sprays, systemEvents]);

  const filteredEvents = allEvents.filter(e => {
    if (!inRange(e.date)) return false;
    if (zoneFilter !== 'All' && e.zone !== zoneFilter && e.zone !== 'System') return false;
    if (pestFilter !== 'All' && !mentionsPest(e.detail, pestFilter)) return false;
    return true;
  });

  const inputStyle = {
    background: '#0d2115',
    border: '1px solid #1a3022',
    color: '#e8f5e9',
    outline: 'none',
    fontFamily: 'JetBrains Mono',
    fontSize: 12,
  };

  const noDataMsg = 'No data yet. This chart fills in once detections and sprays are recorded.';
  const noMatchMsg = 'No data for the selected filters.';
  const emptyMsg = detections.length + sprays.length === 0 ? noDataMsg : noMatchMsg;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-800 text-green-50 uppercase tracking-widest">Historical Monitoring</h1>
        <p className="font-mono text-xs mt-1" style={{ color: '#4a7a58' }}>
          Trends, analytics, and timeline — {prettyDate(dateFrom)} to {prettyDate(dateTo)}
        </p>
      </div>

      {/* Filters */}
      <div className="rounded-xl p-4 flex flex-wrap gap-4" style={{ background: '#0a1a10', border: '1px solid #1a3022' }}>
        <div className="flex flex-col gap-1">
          <label className="font-mono text-xs tracking-wider uppercase" style={{ color: '#4a7a58' }}>Date From</label>
          <input type="date" value={dateFrom} max={dateTo} onChange={e => setDateFrom(e.target.value)}
            className="px-3 py-2 rounded-lg text-xs" style={inputStyle} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-mono text-xs tracking-wider uppercase" style={{ color: '#4a7a58' }}>Date To</label>
          <input type="date" value={dateTo} min={dateFrom} onChange={e => setDateTo(e.target.value)}
            className="px-3 py-2 rounded-lg text-xs" style={inputStyle} />
        </div>
        {[
          { label: 'Zone', value: zoneFilter, set: setZoneFilter, opts: ['All', ...ZONE_NAMES] },
          { label: 'Pest', value: pestFilter, set: setPestFilter, opts: PEST_OPTIONS },
        ].map(f => (
          <div key={f.label} className="flex flex-col gap-1">
            <label className="font-mono text-xs tracking-wider uppercase" style={{ color: '#4a7a58' }}>{f.label}</label>
            <select value={f.value} onChange={e => f.set(e.target.value)}
              className="px-3 py-2 rounded-lg font-mono text-xs text-green-100 appearance-none"
              style={{ background: '#0d2115', border: '1px solid #1a3022', outline: 'none' }}>
              {f.opts.map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Line chart: detections over time */}
        <div className="rounded-xl p-5" style={{ background: '#0a1a10', border: '1px solid #1a3022' }}>
          <div className="font-display text-xs tracking-widest uppercase text-green-500 mb-4">
            Pest Detections — Per Day
          </div>
          {fDetections.length === 0 ? (
            <ChartEmpty height={200}>{emptyMsg}</ChartEmpty>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={detectionsByDay} style={chartStyle}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a3022" />
                <XAxis dataKey="day" tick={{ fontFamily: 'JetBrains Mono', fontSize: 10, fill: '#4a7a58' }} />
                <YAxis allowDecimals={false} tick={{ fontFamily: 'JetBrains Mono', fontSize: 10, fill: '#4a7a58' }} />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontFamily: 'JetBrains Mono', fontSize: 10 }} />
                {visibleZones.map(n => {
                  const color = ZONE_LINE_COLORS[ZONE_NAMES.indexOf(n) % ZONE_LINE_COLORS.length];
                  return (
                    <Line key={n} type="monotone" dataKey={n} name={n} stroke={color} strokeWidth={1.5}
                      dot={{ r: 3, fill: color }} />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Bar chart: spray activations by zone */}
        <div className="rounded-xl p-5" style={{ background: '#0a1a10', border: '1px solid #1a3022' }}>
          <div className="font-display text-xs tracking-widest uppercase text-green-500 mb-4">
            Spray Activations by Zone
          </div>
          {fSprays.length === 0 ? (
            <ChartEmpty height={200}>{emptyMsg}</ChartEmpty>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={spraysByZone} style={chartStyle}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a3022" />
                <XAxis dataKey="zone" tick={{ fontFamily: 'JetBrains Mono', fontSize: 10, fill: '#4a7a58' }} />
                <YAxis allowDecimals={false} tick={{ fontFamily: 'JetBrains Mono', fontSize: 10, fill: '#4a7a58' }} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="activations" name="Activations" fill="#f97316" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Bar chart: top pests */}
        <div className="rounded-xl p-5 lg:col-span-2" style={{ background: '#0a1a10', border: '1px solid #1a3022' }}>
          <div className="font-display text-xs tracking-widest uppercase text-green-500 mb-4">
            Most Frequently Detected Pests
          </div>
          {topPests.length === 0 ? (
            <ChartEmpty height={180}>{emptyMsg}</ChartEmpty>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(180, topPests.length * 36)}>
              <BarChart data={topPests} layout="vertical" style={chartStyle}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a3022" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontFamily: 'JetBrains Mono', fontSize: 10, fill: '#4a7a58' }} />
                <YAxis type="category" dataKey="pest" tick={{ fontFamily: 'JetBrains Mono', fontSize: 10, fill: '#86efac' }} width={90} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="count" name="Detections" fill="#ef4444" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#0a1a10', border: '1px solid #1a3022' }}>
        <div className="px-5 py-3" style={{ borderBottom: '1px solid #1a3022' }}>
          <span className="font-display text-xs tracking-widest uppercase text-green-500">Event Timeline</span>
        </div>
        <div className="p-5 space-y-0">
          {filteredEvents.length === 0 && (
            <div className="py-6 text-center font-mono text-xs" style={{ color: '#4a7a58' }}>
              {allEvents.length === 0
                ? 'No events recorded yet. Detections, spray activations and camera events will appear here as the system runs.'
                : 'No events match the selected filters.'}
            </div>
          )}
          {filteredEvents.map((e, i) => (
            <div key={e.id} className="flex gap-4 relative">
              {/* Timeline line */}
              {i < filteredEvents.length - 1 && (
                <div className="absolute left-[18px] top-8 bottom-0 w-px" style={{ background: '#1a3022' }} />
              )}
              {/* Icon circle */}
              <div className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center z-10 text-base"
                style={{
                  background: `${EVENT_COLORS[e.type] ?? EVENT_COLORS.system}20`,
                  border: `1px solid ${EVENT_COLORS[e.type] ?? EVENT_COLORS.system}40`,
                }}>
                {EVENT_ICONS[e.type] ?? EVENT_ICONS.system}
              </div>
              {/* Content */}
              <div className="pb-5 flex-1">
                <div className="flex items-center gap-3 mb-0.5">
                  <span className="font-mono text-xs font-600" style={{ color: EVENT_COLORS[e.type] ?? EVENT_COLORS.system }}>
                    {e.date} {e.time}
                  </span>
                  <span className="font-display text-xs font-600 text-green-300 uppercase tracking-wide">{e.zone}</span>
                </div>
                <div className="font-display text-sm font-700 text-green-100">{e.event}</div>
                <div className="font-mono text-xs mt-0.5" style={{ color: '#6b9478' }}>{e.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}