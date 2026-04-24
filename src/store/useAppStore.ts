import { create } from 'zustand';
import type {
  AppScreen,
  Shot,
  TargetConfig,
  CalibrationProfile,
  DetectionConfig,
  CameraConfig,
  ProjectionConfig,
  ShooterProfile,
  Point2D,
} from '../types';

interface AppState {
  // Navigation
  currentScreen: AppScreen;
  setScreen: (screen: AppScreen) => void;

  // Camera
  cameraConfig: CameraConfig;
  setCameraConfig: (config: Partial<CameraConfig>) => void;
  isCameraReady: boolean;
  setCameraReady: (ready: boolean) => void;

  // Projection
  projectionConfig: ProjectionConfig;
  setProjectionConfig: (config: Partial<ProjectionConfig>) => void;

  // Detection
  detectionConfig: DetectionConfig;
  setDetectionConfig: (config: Partial<DetectionConfig>) => void;
  isTracking: boolean;
  setTracking: (tracking: boolean) => void;
  currentBrightness: number;
  setCurrentBrightness: (brightness: number) => void;
  currentIRPosition: Point2D | null;
  setCurrentIRPosition: (pos: Point2D | null) => void;

  // Target
  activeTarget: TargetConfig;
  setActiveTarget: (target: TargetConfig) => void;

  // Calibration
  calibrationProfile: CalibrationProfile;
  setCalibrationProfile: (profile: CalibrationProfile) => void;
  isCalibrated: boolean;
  setCalibrated: (calibrated: boolean) => void;

  // Shooting session
  shots: Shot[];
  addShot: (shot: Shot) => void;
  undoLastShot: () => void;
  clearShots: () => void;
  shotsPerSeries: number;
  setShotsPerSeries: (count: number) => void;
  isPaused: boolean;
  setPaused: (paused: boolean) => void;

  // Profiles
  activeProfile: ShooterProfile | null;
  setActiveProfile: (profile: ShooterProfile | null) => void;

  // UI
  showDebug: boolean;
  toggleDebug: () => void;
}

const DEFAULT_TARGET: TargetConfig = {
  id: 'standard-10ring',
  name: 'Standard 10-Rings',
  scoringRings: [
    { score: 10, radiusPercent: 0.05 },
    { score: 9, radiusPercent: 0.15 },
    { score: 8, radiusPercent: 0.25 },
    { score: 7, radiusPercent: 0.35 },
    { score: 6, radiusPercent: 0.45 },
    { score: 5, radiusPercent: 0.55 },
    { score: 4, radiusPercent: 0.65 },
    { score: 3, radiusPercent: 0.75 },
    { score: 2, radiusPercent: 0.85 },
    { score: 1, radiusPercent: 1.0 },
  ],
  gaugingMethod: 'inward',
  bullseyeColor: '#002d55',
  backgroundColor: '#0a0e17',
};

const DEFAULT_DETECTION: DetectionConfig = {
  mode: 'flash',
  brightnessThreshold: 15,
  flashSpikeMultiplier: 1.5,
  dwellRadius: 10,
  dwellTime: 150,
  blurRadius: 11,
  minBrightness: 5,
};

const DEFAULT_CAMERA: CameraConfig = {
  deviceId: '',
  width: 640,
  height: 480,
  flipHorizontal: false,
  flipVertical: false,
};

const DEFAULT_PROJECTION: ProjectionConfig = {
  displayIndex: 0,
  width: 1920,
  height: 1080,
  targetSizePercent: 80,
  targetOffset: { x: 0, y: 0 },
  hitMarkerSize: 12,
};

const DEFAULT_CALIBRATION: CalibrationProfile = {
  id: 'default',
  name: 'Default',
  homography: [],
  calibrationPoints: [],
  manualOffset: { x: 0, y: 0 },
  reprojectionError: Infinity,
  createdAt: Date.now(),
};

export const useAppStore = create<AppState>((set) => ({
  // Navigation
  currentScreen: 'main-menu',
  setScreen: (screen) => set({ currentScreen: screen }),

  // Camera
  cameraConfig: DEFAULT_CAMERA,
  setCameraConfig: (config) =>
    set((state) => ({ cameraConfig: { ...state.cameraConfig, ...config } })),
  isCameraReady: false,
  setCameraReady: (ready) => set({ isCameraReady: ready }),

  // Projection
  projectionConfig: DEFAULT_PROJECTION,
  setProjectionConfig: (config) =>
    set((state) => ({
      projectionConfig: { ...state.projectionConfig, ...config },
    })),

  // Detection
  detectionConfig: DEFAULT_DETECTION,
  setDetectionConfig: (config) =>
    set((state) => ({
      detectionConfig: { ...state.detectionConfig, ...config },
    })),
  isTracking: false,
  setTracking: (tracking) => set({ isTracking: tracking }),
  currentBrightness: 0,
  setCurrentBrightness: (brightness) => set({ currentBrightness: brightness }),
  currentIRPosition: null,
  setCurrentIRPosition: (pos) => set({ currentIRPosition: pos }),

  // Target
  activeTarget: DEFAULT_TARGET,
  setActiveTarget: (target) => set({ activeTarget: target }),

  // Calibration
  calibrationProfile: DEFAULT_CALIBRATION,
  setCalibrationProfile: (profile) => set({ calibrationProfile: profile }),
  isCalibrated: false,
  setCalibrated: (calibrated) => set({ isCalibrated: calibrated }),

  // Shooting session
  shots: [],
  addShot: (shot) => set((state) => ({ shots: [...state.shots, shot] })),
  undoLastShot: () => set((state) => ({ shots: state.shots.slice(0, -1) })),
  clearShots: () => set({ shots: [] }),
  shotsPerSeries: 5,
  setShotsPerSeries: (count) => set({ shotsPerSeries: count }),
  isPaused: false,
  setPaused: (paused) => set({ isPaused: paused }),

  // Profiles
  activeProfile: null,
  setActiveProfile: (profile) => set({ activeProfile: profile }),

  // UI
  showDebug: false,
  toggleDebug: () => set((state) => ({ showDebug: !state.showDebug })),
}));
