import { useState } from 'react';
import type { Page } from './types';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import LiveMonitoring from './pages/LiveMonitoring';
import Recordings from './pages/Recordings';
import DetectionLogs from './pages/DetectionLogs';
import SprayLogs from './pages/SprayLogs';
import History from './pages/History';
import CameraStatus from './pages/CameraStatus';
import SystemSettings from './pages/SystemSettings';

function PageContent({ page }: { page: Page }) {
  switch (page) {
    case 'dashboard': return <Dashboard />;
    case 'live-monitoring': return <LiveMonitoring />;
    case 'recordings': return <Recordings />;
    case 'detection-logs': return <DetectionLogs />;
    case 'spray-logs': return <SprayLogs />;
    case 'history': return <History />;
    case 'camera-status': return <CameraStatus />;
    case 'system-settings': return <SystemSettings />;
  }
}

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen" style={{ background: '#030a05' }}>
      <Sidebar
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <Header
        currentPage={currentPage}
        onMobileMenuToggle={() => setMobileOpen(v => !v)}
      />

      {/* Main content */}
      <main
        className="min-h-screen pt-14 lg:ml-64 transition-all duration-300"
        style={{ background: '#030a05' }}
      >
        <div className="p-4 lg:p-6">
          <PageContent page={currentPage} />
        </div>

        {/* Footer */}
        <div className="px-4 lg:px-6 py-4" style={{ borderTop: '1px solid #0d2115' }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-xs" style={{ color: '#2d4e38' }}>
              Smart Crop Monitoring System — AgriTech IoT Platform v2.4.1
            </span>
            <span className="font-mono text-xs" style={{ color: '#2d4e38' }}>
              Flask + SQLite Backend Ready — GET /api/system-status
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
