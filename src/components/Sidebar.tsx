import { useEffect, useState } from 'react';
import type { Page } from '../types';

const NAV_ITEMS: { id: Page; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '⬛' },
  { id: 'live-monitoring', label: 'Live Monitoring', icon: '📹' },
  { id: 'recordings', label: 'Recordings', icon: '⏺️' },
  { id: 'detection-logs', label: 'Detection Logs', icon: '📋' },
  { id: 'spray-logs', label: 'Spray Logs', icon: '💧' },
  { id: 'history', label: 'History', icon: '📊' },
  { id: 'camera-status', label: 'Camera Status', icon: '🎥' },
  { id: 'system-settings', label: 'System Settings', icon: '⚙️' },
];

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export default function Sidebar({ currentPage, onNavigate, mobileOpen, onMobileClose }: SidebarProps) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const formatted = time.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = time.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  const handleNav = (page: Page) => {
    onNavigate(page);
    onMobileClose();
  };

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={onMobileClose}
        />
      )}

      <aside
        className={[
          'fixed top-0 left-0 h-full z-40 flex flex-col',
          'w-64 transition-transform duration-300',
          'lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
        style={{ background: '#050e07', borderRight: '1px solid #1a3022' }}
      >
        {/* Logo */}
        <div className="p-5 pb-4" style={{ borderBottom: '1px solid #1a3022' }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-2xl">🌿</span>
            <div className="font-display text-green-400 text-xs tracking-widest font-700 uppercase">Smart Crop</div>
          </div>
          <div className="font-display text-green-50 text-sm leading-tight tracking-wider font-700 uppercase pl-8">
            Monitoring System
          </div>
          <div className="font-mono text-xs mt-2 pl-8" style={{ color: '#4a7a58' }}>v2.4.1 — AgriTech IoT</div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 overflow-y-auto">
          <div className="px-4 mb-2">
            <span className="font-mono text-xs tracking-widest uppercase" style={{ color: '#3d6650' }}>Navigation</span>
          </div>
          {NAV_ITEMS.map(item => {
            const active = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNav(item.id)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all duration-150 group"
                style={{
                  background: active ? 'linear-gradient(90deg, #22c55e20, transparent)' : 'transparent',
                  borderLeft: active ? '2px solid #22c55e' : '2px solid transparent',
                  color: active ? '#22c55e' : '#86a98c',
                }}
              >
                <span className="text-base">{item.icon}</span>
                <span
                  className="font-display text-sm font-600 tracking-wide uppercase transition-colors"
                  style={{ color: active ? '#22c55e' : undefined }}
                >
                  {item.label}
                </span>
                {item.id === 'live-monitoring' && (
                  <span className="ml-auto">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 dot-online" />
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-4" style={{ borderTop: '1px solid #1a3022' }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-block w-2 h-2 rounded-full bg-green-400 dot-online" />
            <span className="font-mono text-xs text-green-400 font-600">SYSTEM ONLINE</span>
          </div>
          <div className="font-mono text-xs mb-1" style={{ color: '#4a7a58' }}>{dateStr}</div>
          <div className="font-mono text-sm font-600 text-green-300 mb-3">{formatted}</div>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-md"
            style={{ background: '#0a1a10', border: '1px solid #1a3022' }}
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-700 font-display"
              style={{ background: '#166534', color: '#4ade80' }}
            >
              Admin
            </div>
            <div>
              <div className="text-xs font-600 text-green-100">Admin</div>
              <div className="font-mono text-xs" style={{ color: '#4a7a58' }}>Alejandro L</div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
