// ─── Core Types ───

export interface Point2D {
  x: number;
  y: number;
}

export interface Shot {
  id: string;
  cameraPosition: Point2D;   // Raw camera coordinates
  screenPosition: Point2D;   // Mapped to screen/projector coordinates via homography
  score: number;
  timestamp: number;
  tracePoints: Point2D[];    // Aiming trace in screen coordinates
}

export interface ShotGroup {
  shots: Shot[];
  meanPoint: Point2D;
  spread: number;            // Bounding circle radius in pixels
  totalScore: number;
}

// ─── Target Types ───

export interface ScoringRing {
  score: number;
  radiusPercent: number;     // Radius as % of target radius (0-1). 1.0 = outer edge
}

export interface TargetConfig {
  id: string;
  name: string;
  scoringRings: ScoringRing[];
  gaugingMethod: 'inward' | 'outward';
  // Visual style
  ringColors?: string[];     // Colors for each ring band
  bullseyeColor?: string;
  backgroundColor?: string;
}

// ─── Projection Types ───

export interface ProjectionConfig {
  /** Which display to project on (0 = primary, 1 = second monitor, etc.) */
  displayIndex: number;
  /** Projector/screen resolution */
  width: number;
  height: number;
  /** Target size as percentage of the shorter screen dimension */
  targetSizePercent: number;
  /** Target center offset from screen center (pixels) */
  targetOffset: Point2D;
  /** Hit marker radius in pixels */
  hitMarkerSize: number;
}

// ─── Calibration Types ───

export interface CalibrationPoint {
  screen: Point2D;           // Where the marker was projected on screen
  camera: Point2D;           // Where the camera saw it
}

export interface CalibrationProfile {
  id: string;
  name: string;
  /** 3x3 homography matrix (camera → screen), stored row-major as 9 numbers */
  homography: number[];
  /** The 4 calibration point pairs used to compute the homography */
  calibrationPoints: CalibrationPoint[];
  /** Manual fine-tune offset applied after homography (screen pixels) */
  manualOffset: Point2D;
  /** Reprojection error in pixels (quality metric) */
  reprojectionError: number;
  createdAt: number;
}

// ─── Detection Types ───

export type DetectionMode = 'flash' | 'dwell' | 'hybrid';

export interface DetectionConfig {
  mode: DetectionMode;
  brightnessThreshold: number;    // 0-255
  flashSpikeMultiplier: number;   // How much brighter than baseline to trigger
  dwellRadius: number;            // Pixels - how still the dot must be
  dwellTime: number;              // ms - how long it must stay still
  blurRadius: number;             // Gaussian blur kernel size (odd number)
  minBrightness: number;          // Minimum brightness to track at all
}

// ─── Session Types ───

export interface Session {
  id: string;
  name: string;
  shooterProfile: string;
  targetConfig: TargetConfig;
  calibrationProfile: CalibrationProfile;
  shots: Shot[];
  startTime: number;
  endTime?: number;
  mode: 'practice' | 'competition';
}

// ─── Camera Types ───

export interface CameraDevice {
  deviceId: string;
  label: string;
  resolution: { width: number; height: number };
}

export interface CameraConfig {
  deviceId: string;
  width: number;
  height: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  exposure?: number;
  gain?: number;
}

// ─── App State ───

export type AppScreen =
  | 'main-menu'
  | 'shooting'
  | 'speed-drill'
  | 'calibration'
  | 'results'
  | 'settings'
  | 'profiles';

export interface ShooterProfile {
  id: string;
  name: string;
  avatar?: string;
  totalShots: number;
  averageScore: number;
  bestScore: number;
  sessions: number;
  createdAt: number;
}

// ─── Electron API ───

declare global {
  interface Window {
    electronAPI: {
      minimize: () => Promise<void>;
      maximize: () => Promise<void>;
      close: () => Promise<void>;
      isMaximized: () => Promise<boolean>;
      fullscreen: () => Promise<void>;
      getDisplays: () => Promise<DisplayInfo[]>;
      onDisplaysChanged: (callback: () => void) => () => void;
      openProjectorWindow: (displayIndex: number) => Promise<{ width: number; height: number }>;
      closeProjectorWindow: () => Promise<void>;
      sendToProjector: (data: ProjectorMessage) => Promise<void>;
      onProjectorMessage: (callback: (data: ProjectorMessage) => void) => () => void;

      // Database / Config
      dbGetCalibrations: () => Promise<any[]>;
      dbGetCalibration: (id: string) => Promise<any>;
      dbSaveCalibration: (...args: any[]) => Promise<void>;
      dbGetProfiles: () => Promise<any[]>;
      dbCreateProfile: (id: string, name: string) => Promise<void>;
      dbDeleteProfile: (id: string) => Promise<void>;
      dbCreateSession: (...args: any[]) => Promise<void>;
      dbEndSession: (id: string, endTime: number) => Promise<void>;
      dbGetSessions: (profileId?: string) => Promise<any[]>;
      dbGetSession: (id: string) => Promise<any>;
      dbDeleteSession: (id: string) => Promise<void>;
      dbAddShot: (...args: any[]) => Promise<void>;
      dbGetShotsForSession: (sessionId: string) => Promise<any[]>;
      dbDeleteLastShot: (sessionId: string) => Promise<void>;
    };
  }
}

export interface DisplayInfo {
  id: number;
  label: string;
  width: number;
  height: number;
  isPrimary: boolean;
}

export type ProjectorMessage =
  | { type: 'show-target'; target: TargetConfig; projection: ProjectionConfig }
  | { type: 'show-calibration-marker'; position: Point2D; markerIndex: number }
  | { type: 'show-hit'; position: Point2D; score: number; hitMarkerSize: number }
  | { type: 'clear' }
  | { type: 'blank' }
  | { type: 'speed-drill-target'; position: Point2D; radius: number; id: number }
  | { type: 'speed-drill-hit'; targetId: number }
  | { type: 'speed-drill-miss'; targetId: number }
  | { type: 'speed-drill-clear' };
