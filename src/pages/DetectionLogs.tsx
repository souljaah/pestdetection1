import { useState, useMemo } from 'react';
import { PEST_CLASSES as PESTS, samePest, useDetectionLogs, useZones } from '../lib/cameras';

const PEST_CLASSES = ['All', ...PESTS];
const STATUSES = ['All', 'confirmed', 'false_positive'];

function SelectFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="font-mono text-xs tracking-wider uppercase" style={{ color: '#4a7a58' }}>{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="px-3 py-2 rounded-lg font-mono text-xs text-green-100 appearance-none"
        style={{ background: '#0d2115', border: '1px solid #1a3022', outline: 'none' }}
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

export default function DetectionLogs() {
  // Empty until the camera + detection model + backend are running
  const detections = useDetectionLogs();
  const zones = useZones();
  const ZONES = ['All', ...zones.map(z => z.name)];

  const [search, setSearch] = useState('');
  const [pestFilter, setPestFilter] = useState('All');
  const [zoneFilter, setZoneFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [sortBy, setSortBy] = useState<'confidence' | 'date'>('date');
  const [page, setPage] = useState(1);
  const PER_PAGE = 8;

  const filtered = useMemo(() => {
    let rows = detections.filter(d => {
      if (search && !Object.values(d).some(v => String(v).toLowerCase().includes(search.toLowerCase()))) return false;
      if (pestFilter !== 'All' && !samePest(d.pestClass, pestFilter)) return false;
      if (zoneFilter !== 'All' && d.zoneName !== zoneFilter) return false;
      if (statusFilter !== 'All' && d.status !== statusFilter) return false;
      return true;
    });
    rows = [...rows].sort((a, b) =>
      sortBy === 'confidence' ? b.confidence - a.confidence
        : (b.date + b.time).localeCompare(a.date + a.time)
    );
    return rows;
  }, [detections, search, pestFilter, zoneFilter, statusFilter, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const currentPage = Math.min(page, totalPages); // stays valid if records change
  const pageRows = filtered.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-800 text-green-50 uppercase tracking-widest">Pest Detection Logs</h1>
        <p className="font-mono text-xs mt-1" style={{ color: '#4a7a58' }}>
          {detections.length} total records — SQLite table: detections
        </p>
      </div>

      {/* Filters */}
      <div className="rounded-xl p-4" style={{ background: '#0a1a10', border: '1px solid #1a3022' }}>
        <div className="flex flex-wrap gap-4">
          {/* Search */}
          <div className="flex flex-col gap-1 flex-1 min-w-48">
            <label className="font-mono text-xs tracking-wider uppercase" style={{ color: '#4a7a58' }}>Search</label>
            <div className="relative">
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search records..."
                className="w-full pl-8 pr-3 py-2 rounded-lg font-mono text-xs text-green-100 placeholder-green-900"
                style={{ background: '#0d2115', border: '1px solid #1a3022', outline: 'none' }}
              />
              <svg className="absolute left-2.5 top-2.5" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4a7a58" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
            </div>
          </div>

          <SelectFilter label="Crop Zone" value={zoneFilter} onChange={v => { setZoneFilter(v); setPage(1); }} options={ZONES} />
          <SelectFilter label="Pest Class" value={pestFilter} onChange={v => { setPestFilter(v); setPage(1); }} options={PEST_CLASSES} />
          <SelectFilter label="Status" value={statusFilter} onChange={v => { setStatusFilter(v); setPage(1); }} options={STATUSES} />

          {/* Sort */}
          <div className="flex flex-col gap-1">
            <label className="font-mono text-xs tracking-wider uppercase" style={{ color: '#4a7a58' }}>Sort By</label>
            <div className="flex gap-1.5">
              {(['date', 'confidence'] as const).map(s => (
                <button key={s} onClick={() => { setSortBy(s); setPage(1); }}
                  className="px-3 py-2 rounded-lg font-mono text-xs transition-colors"
                  style={{
                    background: sortBy === s ? '#22c55e20' : '#0d2115',
                    border: `1px solid ${sortBy === s ? '#22c55e40' : '#1a3022'}`,
                    color: sortBy === s ? '#22c55e' : '#6b9478',
                  }}>
                  {s === 'date' ? 'Date' : 'Confidence'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#0a1a10', border: '1px solid #1a3022' }}>
        <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid #1a3022' }}>
          <span className="font-mono text-xs text-green-500">{filtered.length} records found</span>
          <span className="font-mono text-xs" style={{ color: '#4a7a58' }}>Page {currentPage} of {totalPages}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[700px]">
            <thead>
              <tr style={{ borderBottom: '1px solid #1a3022' }}>
                {['ID', 'Crop Zone', 'Camera', 'Pest Class', 'Confidence', 'Date', 'Time', 'Status'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-mono tracking-wider uppercase"
                    style={{ color: '#4a7a58' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map(d => (
                <tr key={d.id} className="transition-colors" style={{ borderBottom: '1px solid #0d2115' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#0d2115')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td className="px-4 py-3 font-mono text-green-700">#{d.id}</td>
                  <td className="px-4 py-3 font-display font-600 text-green-200 uppercase tracking-wide">{d.zoneName}</td>
                  <td className="px-4 py-3 font-mono text-green-400">{d.camera}</td>
                  <td className="px-4 py-3 font-mono font-600 text-red-400">{d.pestClass}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-600" style={{ color: d.confidence >= 90 ? '#ef4444' : d.confidence >= 80 ? '#f97316' : '#eab308' }}>
                        {d.confidence.toFixed(1)}%
                      </span>
                      <div className="h-1 w-16 rounded-full overflow-hidden" style={{ background: '#1a3022' }}>
                        <div className="h-full rounded-full" style={{ width: `${d.confidence}%`, background: d.confidence >= 90 ? '#ef4444' : '#f97316' }} />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-green-400">{d.date}</td>
                  <td className="px-4 py-3 font-mono text-green-400">{d.time}</td>
                  <td className="px-4 py-3">
                    <span className="font-mono px-2 py-0.5 rounded text-xs"
                      style={{
                        background: d.status === 'confirmed' ? '#22c55e15' : '#f9731615',
                        color: d.status === 'confirmed' ? '#4ade80' : '#f97316',
                        border: `1px solid ${d.status === 'confirmed' ? '#22c55e30' : '#f9731630'}`,
                      }}>
                      {d.status.replace('_', ' ').toUpperCase()}
                    </span>
                  </td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center font-mono text-xs" style={{ color: '#4a7a58' }}>
                    {detections.length === 0
                      ? 'No pest detections recorded yet. Records will appear here once a camera is connected and the detection model is running.'
                      : 'No records found matching your filters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-5 py-3 flex items-center justify-between" style={{ borderTop: '1px solid #1a3022' }}>
          <button onClick={() => setPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1}
            className="px-3 py-1.5 rounded font-mono text-xs transition-colors disabled:opacity-30"
            style={{ background: '#0d2115', border: '1px solid #1a3022', color: '#22c55e' }}>
            ← Prev
          </button>
          <div className="flex gap-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button key={p} onClick={() => setPage(p)}
                className="w-7 h-7 rounded font-mono text-xs transition-colors"
                style={{
                  background: p === currentPage ? '#22c55e20' : '#0d2115',
                  border: `1px solid ${p === currentPage ? '#22c55e40' : '#1a3022'}`,
                  color: p === currentPage ? '#22c55e' : '#6b9478',
                }}>
                {p}
              </button>
            ))}
          </div>
          <button onClick={() => setPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages}
            className="px-3 py-1.5 rounded font-mono text-xs transition-colors disabled:opacity-30"
            style={{ background: '#0d2115', border: '1px solid #1a3022', color: '#22c55e' }}>
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}