export type CameraStatus = 'online' | 'offline';
export type DetectionStatus = 'clear' | 'detected' | 'unknown';
export type SprayStatus = 'ready' | 'spraying' | 'disabled';
export type SignalStrength = 'strong' | 'medium' | 'weak' | 'none';

export interface Zone {
  id: number;
  name: string;
  cameraId: string;
  cameraStatus: CameraStatus;
  detectionStatus: DetectionStatus;
  sprayStatus: SprayStatus;
  pestClass?: string;
  confidence?: number;
  lastDetection?: string;
  imageUrl: string;
}

export interface Detection {
  id: string;
  zoneId: number;
  zoneName: string;
  camera: string;
  pestClass: string;
  confidence: number;
  date: string;
  time: string;
  status: 'confirmed' | 'pending' | 'false_positive';
}

export interface SprayLog {
  id: string;
  zoneId: number;
  zoneName: string;
  trigger: string;
  duration: number;
  date: string;
  time: string;
  status: 'completed' | 'active' | 'failed' | 'cancelled';
}

export interface Camera {
  id: number;
  name: string;
  zone: string;
  zoneId: number;
  status: CameraStatus;
  signal: SignalStrength;
  lastUpdate: string;
  ip: string;
  frameRate: number;
  resolution: string;
}

export interface Alert {
  id: string;
  type: 'pest_detected' | 'spray_activated' | 'spray_completed' | 'camera_offline';
  message: string;
  detail: string;
  timestamp: string;
}

export interface SystemStatus {
  controller: boolean;
  camerasOnline: number;
  camerasTotal: number;
  modelRunning: boolean;
  sprayController: boolean;
  database: boolean;
  network: boolean;
}

export interface HistoryEvent {
  id: string;
  time: string;
  zone: string;
  event: string;
  detail: string;
  type: 'detection' | 'spray_start' | 'spray_end' | 'camera' | 'system';
}

export type Page =
  | 'dashboard'
  | 'live-monitoring'
  | 'recordings'
  | 'detection-logs'
  | 'spray-logs'
  | 'history'
  | 'camera-status'
  | 'system-settings';
