/**
 * Mock data structured to mirror Flask/SQLite API responses.
 *
 * Flask endpoints this data represents:
 *   GET /api/zones          → zones[]
 *   GET /api/cameras        → cameras[]
 *   GET /api/detections     → detections[]
 *   GET /api/sprays         → sprayLogs[]
 *   GET /api/alerts         → alerts[]
 *   GET /api/system-status  → systemStatus
 *   GET /api/history        → historyEvents[]
 *   WS  /ws/stream          → real-time updates (zone + camera frames)
 */

import type { Zone, Camera, Detection, SprayLog, Alert, SystemStatus, HistoryEvent } from '../types';

export const zones: Zone[] = [
  {
    id: 1,
    name: 'Zone 1',
    cameraId: 'CAM-01',
    cameraStatus: 'online',
    detectionStatus: 'clear',
    sprayStatus: 'ready',
    confidence: 0,
    lastDetection: '08:14 AM',
    imageUrl: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=480&h=320&fit=crop&auto=format',
  },
  {
    id: 2,
    name: 'Zone 2',
    cameraId: 'CAM-02',
    cameraStatus: 'online',
    detectionStatus: 'detected',
    sprayStatus: 'spraying',
    pestClass: 'Aphid',
    confidence: 94.7,
    lastDetection: '10:32 AM',
    imageUrl: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=480&h=320&fit=crop&auto=format',
  },
  {
    id: 3,
    name: 'Zone 3',
    cameraId: 'CAM-03',
    cameraStatus: 'online',
    detectionStatus: 'clear',
    sprayStatus: 'ready',
    confidence: 0,
    lastDetection: '10:41 AM',
    imageUrl: 'https://images.unsplash.com/photo-1530836369250-ef72a3f5cda8?w=480&h=320&fit=crop&auto=format',
  },
  {
    id: 4,
    name: 'Zone 4',
    cameraId: 'CAM-04',
    cameraStatus: 'offline',
    detectionStatus: 'unknown',
    sprayStatus: 'disabled',
    imageUrl: '',
  },
];

export const cameras: Camera[] = [
  { id: 1, name: 'CAMERA 01', zone: 'Zone 1', zoneId: 1, status: 'online', signal: 'strong', lastUpdate: '2 seconds ago', ip: '192.168.1.101', frameRate: 30, resolution: '1920×1080' },
  { id: 2, name: 'CAMERA 02', zone: 'Zone 2', zoneId: 2, status: 'online', signal: 'strong', lastUpdate: '1 second ago', ip: '192.168.1.102', frameRate: 30, resolution: '1920×1080' },
  { id: 3, name: 'CAMERA 03', zone: 'Zone 3', zoneId: 3, status: 'online', signal: 'medium', lastUpdate: '3 seconds ago', ip: '192.168.1.103', frameRate: 24, resolution: '1280×720' },
  { id: 4, name: 'CAMERA 04', zone: 'Zone 4', zoneId: 4, status: 'offline', signal: 'none', lastUpdate: '5 minutes ago', ip: '192.168.1.104', frameRate: 0, resolution: '—' },
];

export const detections: Detection[] = [
  { id: '001', zoneId: 2, zoneName: 'Zone 2', camera: 'Camera 02', pestClass: 'Aphid', confidence: 94.7, date: '09/21/2026', time: '10:32 AM', status: 'confirmed' },
  { id: '002', zoneId: 3, zoneName: 'Zone 3', camera: 'Camera 03', pestClass: 'Caterpillar', confidence: 91.2, date: '09/21/2026', time: '10:41 AM', status: 'confirmed' },
  { id: '003', zoneId: 1, zoneName: 'Zone 1', camera: 'Camera 01', pestClass: 'Whitefly', confidence: 87.5, date: '09/21/2026', time: '09:18 AM', status: 'confirmed' },
  { id: '004', zoneId: 2, zoneName: 'Zone 2', camera: 'Camera 02', pestClass: 'Aphid', confidence: 89.3, date: '09/21/2026', time: '08:55 AM', status: 'confirmed' },
  { id: '005', zoneId: 3, zoneName: 'Zone 3', camera: 'Camera 03', pestClass: 'Spider Mite', confidence: 76.1, date: '09/20/2026', time: '03:47 PM', status: 'false_positive' },
  { id: '006', zoneId: 1, zoneName: 'Zone 1', camera: 'Camera 01', pestClass: 'Thrip', confidence: 82.4, date: '09/20/2026', time: '01:22 PM', status: 'confirmed' },
  { id: '007', zoneId: 2, zoneName: 'Zone 2', camera: 'Camera 02', pestClass: 'Aphid', confidence: 96.1, date: '09/20/2026', time: '11:09 AM', status: 'confirmed' },
  { id: '008', zoneId: 3, zoneName: 'Zone 3', camera: 'Camera 03', pestClass: 'Caterpillar', confidence: 88.9, date: '09/19/2026', time: '02:34 PM', status: 'confirmed' },
  { id: '009', zoneId: 1, zoneName: 'Zone 1', camera: 'Camera 01', pestClass: 'Whitefly', confidence: 79.3, date: '09/19/2026', time: '10:11 AM', status: 'confirmed' },
  { id: '010', zoneId: 2, zoneName: 'Zone 2', camera: 'Camera 02', pestClass: 'Spider Mite', confidence: 71.8, date: '09/19/2026', time: '07:58 AM', status: 'false_positive' },
  { id: '011', zoneId: 3, zoneName: 'Zone 3', camera: 'Camera 03', pestClass: 'Aphid', confidence: 93.5, date: '09/18/2026', time: '04:20 PM', status: 'confirmed' },
  { id: '012', zoneId: 1, zoneName: 'Zone 1', camera: 'Camera 01', pestClass: 'Thrip', confidence: 85.7, date: '09/18/2026', time: '02:05 PM', status: 'confirmed' },
];

export const sprayLogs: SprayLog[] = [
  { id: '001', zoneId: 2, zoneName: 'Zone 2', trigger: 'Aphid Detected', duration: 5, date: '09/21/2026', time: '10:32 AM', status: 'active' },
  { id: '002', zoneId: 3, zoneName: 'Zone 3', trigger: 'Caterpillar Detected', duration: 7, date: '09/21/2026', time: '10:41 AM', status: 'completed' },
  { id: '003', zoneId: 1, zoneName: 'Zone 1', trigger: 'Whitefly Detected', duration: 6, date: '09/21/2026', time: '09:18 AM', status: 'completed' },
  { id: '004', zoneId: 2, zoneName: 'Zone 2', trigger: 'Aphid Detected', duration: 5, date: '09/21/2026', time: '08:55 AM', status: 'completed' },
  { id: '005', zoneId: 2, zoneName: 'Zone 2', trigger: 'Aphid Detected', duration: 5, date: '09/20/2026', time: '11:09 AM', status: 'completed' },
  { id: '006', zoneId: 1, zoneName: 'Zone 1', trigger: 'Thrip Detected', duration: 4, date: '09/20/2026', time: '01:22 PM', status: 'completed' },
  { id: '007', zoneId: 3, zoneName: 'Zone 3', trigger: 'Caterpillar Detected', duration: 8, date: '09/19/2026', time: '02:34 PM', status: 'completed' },
  { id: '008', zoneId: 1, zoneName: 'Zone 1', trigger: 'Whitefly Detected', duration: 6, date: '09/19/2026', time: '10:11 AM', status: 'failed' },
  { id: '009', zoneId: 3, zoneName: 'Zone 3', trigger: 'Aphid Detected', duration: 5, date: '09/18/2026', time: '04:20 PM', status: 'completed' },
];

export const alerts: Alert[] = [
  { id: 'a1', type: 'pest_detected', message: 'PEST DETECTED', detail: 'Zone 2 detected Aphid — Confidence: 94.7%', timestamp: '10:32 AM' },
  { id: 'a2', type: 'spray_activated', message: 'SPRAY ACTIVATED', detail: 'Zone 2 sprayer activated for 5 seconds', timestamp: '10:32 AM' },
  { id: 'a3', type: 'pest_detected', message: 'PEST DETECTED', detail: 'Zone 3 detected Caterpillar — Confidence: 91.2%', timestamp: '10:41 AM' },
  { id: 'a4', type: 'spray_completed', message: 'SPRAY COMPLETED', detail: 'Zone 3 spraying completed successfully', timestamp: '10:41 AM' },
  { id: 'a5', type: 'camera_offline', message: 'CAMERA OFFLINE', detail: 'Camera 04 (Zone 4) has disconnected', timestamp: '10:05 AM' },
];

export const systemStatus: SystemStatus = {
  controller: true,
  camerasOnline: 3,
  camerasTotal: 4,
  modelRunning: true,
  sprayController: true,
  database: true,
  network: true,
};

export const historyEvents: HistoryEvent[] = [
  { id: 'h1', time: '10:41 AM', zone: 'Zone 3', event: 'Pest Detected', detail: 'Caterpillar — 91.2% confidence', type: 'detection' },
  { id: 'h2', time: '10:41 AM', zone: 'Zone 3', event: 'Sprayer Activated', detail: '7 seconds duration', type: 'spray_start' },
  { id: 'h3', time: '10:41 AM', zone: 'Zone 3', event: 'Spraying Completed', detail: 'Spray cycle finished successfully', type: 'spray_end' },
  { id: 'h4', time: '10:32 AM', zone: 'Zone 2', event: 'Pest Detected', detail: 'Aphid — 94.7% confidence', type: 'detection' },
  { id: 'h5', time: '10:32 AM', zone: 'Zone 2', event: 'Sprayer Activated', detail: '5 seconds duration', type: 'spray_start' },
  { id: 'h6', time: '10:05 AM', zone: 'Zone 4', event: 'Camera Offline', detail: 'Camera 04 disconnected from network', type: 'camera' },
  { id: 'h7', time: '09:18 AM', zone: 'Zone 1', event: 'Pest Detected', detail: 'Whitefly — 87.5% confidence', type: 'detection' },
  { id: 'h8', time: '09:18 AM', zone: 'Zone 1', event: 'Sprayer Activated', detail: '6 seconds duration', type: 'spray_start' },
  { id: 'h9', time: '09:18 AM', zone: 'Zone 1', event: 'Spraying Completed', detail: 'Spray cycle finished successfully', type: 'spray_end' },
  { id: 'h10', time: '08:00 AM', zone: 'System', event: 'System Online', detail: 'All modules initialized successfully', type: 'system' },
];

export const detectionChartData = [
  { hour: '00:00', zone1: 0, zone2: 0, zone3: 0 },
  { hour: '02:00', zone1: 0, zone2: 1, zone3: 0 },
  { hour: '04:00', zone1: 0, zone2: 0, zone3: 0 },
  { hour: '06:00', zone1: 0, zone2: 0, zone3: 0 },
  { hour: '08:00', zone1: 1, zone2: 1, zone3: 0 },
  { hour: '09:00', zone1: 1, zone2: 0, zone3: 0 },
  { hour: '10:00', zone1: 0, zone2: 1, zone3: 1 },
  { hour: '11:00', zone1: 0, zone2: 0, zone3: 0 },
  { hour: '12:00', zone1: 0, zone2: 0, zone3: 0 },
  { hour: '14:00', zone1: 0, zone2: 0, zone3: 0 },
  { hour: '16:00', zone1: 0, zone2: 0, zone3: 0 },
];

export const sprayChartData = [
  { zone: 'Zone 1', activations: 3 },
  { zone: 'Zone 2', activations: 4 },
  { zone: 'Zone 3', activations: 3 },
  { zone: 'Zone 4', activations: 0 },
];

export const pestChartData = [
  { pest: 'Aphid', count: 5 },
  { pest: 'Caterpillar', count: 3 },
  { pest: 'Whitefly', count: 2 },
  { pest: 'Thrip', count: 2 },
  { pest: 'Spider Mite', count: 2 },
];
