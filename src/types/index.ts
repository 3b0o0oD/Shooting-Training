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
  /** If set, render this image instead of procedural rings on the projector and control screen */
  imagePath?: string;
  /** 'disc' = black aiming disc on cream paper (ISSF-style). 'classic' = white/black alternating rings. Default: 'classic' */
  targetStyle?: 'classic' | 'disc';
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

export interface LensDistortion {
  k1: number;   // Radial coefficient 1 (negative = barrel, positive = pincushion)
  k2: number;   // Radial coefficient 2 (higher-order correction)
  cx: number;   // Distortion center x (camera pixels)
  cy: number;   // Distortion center y (camera pixels)
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
  /** Radial lens distortion coefficients — auto-estimated from calibration residuals */
  distortion?: LensDistortion;
  createdAt: number;
}

// ─── Detection Types ───

export type DetectionMode = 'flash' | 'dwell' | 'hybrid';

export interface DetectionConfig {
  mode: DetectionMode;
  brightnessThreshold: number;
  flashSpikeMultiplier: number;
  dwellRadius: number;
  dwellTime: number;
  blurRadius: number;
  minBrightness: number;
  /** Absolute pixel brightness threshold — CameraParameters.ini TrackingThreshold3=220 */
  trackingThreshold: number;
  /**
   * Max pixel distance between consecutive blob centroids to be considered the same blob.
   * SLDriver: "ShotConnectedDistance". Increase if shots are split; decrease for precision.
   */
  shotConnectedDistance: number;
  /**
   * ThresholdBump step size. When too many blobs are detected (false positives),
   * the threshold auto-increments by this amount per bump event. 0 = disabled.
   * SLDriver: "ThresholdBump".
   */
  thresholdBumpStep: number;
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

export interface WeaponProfile {
  id: string;
  name: string;
  /** Shot offset in screen pixels — corrects laser-to-bore alignment per weapon */
  shotOffsetX: number;
  shotOffsetY: number;
}

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
      onMaximizeChanged: (callback: (isMaximized: boolean) => void) => () => void;
      onFullscreenChanged: (callback: (isFullscreen: boolean) => void) => () => void;
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
