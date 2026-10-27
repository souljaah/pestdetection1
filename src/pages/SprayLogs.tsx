import { useState, useMemo } from 'react';
import { useSprayLogs, useZones } from '../lib/cameras';

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  active: { bg: '#f9731620', text: '#f97316', border: '#f9731640' },
  completed: { bg: '#22c55e15', text: '#4ade80', border: '#22c55e30' },
  failed: { bg: '#ef444420', text: '#ef4444', border: '#ef444440' },
  cancelled: { bg: '#6b947820', text: '#6b9478', border: '#6b947840' },
};
const FALLBACK_STATUS = STATUS_COLORS.cancelled;

const STATUSES = ['All', 'active', 'completed', 'failed', 'cancelled'];

export default function SprayLogs() {
  // Empty until the spray hardware + backend are connected
  const sprayLogs = useSprayLogs();
  const zones = useZones();
  const ZONES = ['All', ...zones.map(z => z.name)];

  const [search, setSearch] = useState('');
  const [zoneFilter, setZoneFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');

  // Same MM/DD/YYYY format as the log dates
  const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  const todayLogs = sprayLogs.filter(s => s.date === today);
  const totalDuration = sprayLogs.reduce((sum, s) => sum + s.duration, 0);
  const activeLogs = sprayLogs.filter(s => s.status === 'active');

  const filtered = useMemo(() => {
    return sprayLogs.filter(s => {
      if (search && !Object.values(s).some(v => String(v).toLowerCase().includes(search.toLowerCase()))) return false;
      if (zoneFilter !== 'All' && s.zoneName !== zoneFilter) return false;
      if (statusFilter !== 'All' && s.status !== statusFilter) return false;
      return true;
    });
  }, [sprayLogs, search, zoneFilter, statusFilter]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-800 text-green-50 uppercase tracking-widest">Spray Activation Logs</h1>
        <p className="font-mono text-xs mt-1" style={{ color: '#4a7a58' }}>
          Automated spray events — SQLite table: spray_logs
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Activations', value: sprayLogs.length, color: sprayLogs.length ? '#4ade80' : '#4a7a58' },
          { label: "Today's Activations", value: todayLogs.length, color: todayLogs.length ? '#4ade80' : '#4a7a58' },
          { label: 'Total Spray Duration', value: `${totalDuration}s`, color: totalDuration ? '#f97316' : '#4a7a58' },
          {
            label: 'Currently Spraying',
            value: activeLogs.length > 0 ? activeLogs.length : 'None',
            color: activeLogs.length > 0 ? '#f97316' : '#4a7a58',
          },
        ].map(c => (
          <div key={c.label} className="rounded-xl p-4" style={{ background: '#0a1a10', border: '1px solid #1a3022' }}>
            <div className="font-mono text-xs mb-1 tracking-wider uppercase" style={{ color: '#4a7a58' }}>{c.label}</div>
            <div className="font-display text-3xl font-800" style={{ color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Active spray alert */}
      {activeLogs.length > 0 && (
        <div className="rounded-xl px-5 py-4 flex items-center gap-4"
          style={{ background: '#f9731610', border: '1px solid #f9731640' }}>
          <div className="w-3 h-3 rounded-full bg-orange-500 animate-pulse" />
          <div>
            <div className="font-display text-sm font-700 text-orange-400 uppercase tracking-wider">Spray Active</div>
            {activeLogs.map(s => (
              <div key={s.id} className="font-mono text-xs text-orange-300 mt-0.5">
                {s.zoneName} — {s.trigger} — {s.duration}s duration
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="rounded-xl p-4 flex flex-wrap gap-4" style={{ background: '#0a1a10', border: '1px solid #1a3022' }}>
        <div className="flex flex-col gap-1 flex-1 min-w-48">
          <label className="font-mono text-xs tracking-wider uppercase" style={{ color: '#4a7a58' }}>Search</label>
          <div className="relative">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search spray logs..."
              className="w-full pl-8 pr-3 py-2 rounded-lg font-mono text-xs text-green-100 placeholder-green-900"
              style={{ background: '#0d2115', border: '1px solid #1a3022', outline: 'none' }} />
            <svg className="absolute left-2.5 top-2.5" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4a7a58" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
          </div>
        </div>

        {[
          { label: 'Zone', value: zoneFilter, set: setZoneFilter, opts: ZONES },
          { label: 'Status', value: statusFilter, set: setStatusFilter, opts: STATUSES },
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

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#0a1a10', border: '1px solid #1a3022' }}>
        <div className="px-5 py-3" style={{ borderBottom: '1px solid #1a3022' }}>
          <span className="font-mono text-xs text-green-500">{filtered.length} records</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[700px]">
            <thead>
              <tr style={{ borderBottom: '1px solid #1a3022' }}>
                {['ID', 'Crop Zone', 'Trigger', 'Duration', 'Date', 'Time', 'Status'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-mono tracking-wider uppercase" style={{ color: '#4a7a58' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => {
                const st = STATUS_COLORS[s.status] ?? FALLBACK_STATUS;
                return (
                  <tr key={s.id} style={{ borderBottom: '1px solid #0d2115' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#0d2115')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td className="px-4 py-3 font-mono text-green-700">#{s.id}</td>
                    <td className="px-4 py-3 font-display font-600 text-green-200 uppercase tracking-wide">{s.zoneName}</td>
                    <td className="px-4 py-3 font-mono text-orange-300">{s.trigger}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-600 text-blue-300">{s.duration}s</span>
                        <div className="h-1 w-12 rounded-full overflow-hidden" style={{ background: '#1a3022' }}>
                          <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(100, (s.duration / 10) * 100)}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-green-400">{s.date}</td>
                    <td className="px-4 py-3 font-mono text-green-400">{s.time}</td>
                    <td className="px-4 py-3">
                      <span className="font-mono px-2 py-0.5 rounded text-xs font-600"
                        style={{ background: st.bg, color: st.text, border: `1px solid ${st.border}` }}>
                        {s.status.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center font-mono text-xs" style={{ color: '#4a7a58' }}>
                    {sprayLogs.length === 0
                      ? 'No spray activations recorded yet. Events will appear here once the spray unit is connected and a pest is detected.'
                      : 'No records found matching your filters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}