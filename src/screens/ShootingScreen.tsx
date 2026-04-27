import { useCallback, useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';
import { useDetector, type ShotEvent } from '../hooks/useDetector';
import { ScoringEngine } from '../engine/ScoringEngine';
import { CalibrationEngine } from '../engine/CalibrationEngine';
import { TargetCanvas } from '../components/shooting/TargetCanvas';
import { HUDOverlay } from '../components/shooting/HUDOverlay';
import { ShotFeedback } from '../components/shooting/ShotFeedback';
import type { Shot, Point2D } from '../types';
import { v4 as uuidv4 } from 'uuid';

export function ShootingScreen() {
  const {
    cameraConfig,
    activeTarget,
    projectionConfig,
    calibrationProfile,
    isCalibrated,
    shots,
    addShot,
    undoLastShot,
    clearShots,
    isPaused,
    setPaused,
    setScreen,
    shotsPerSeries,
    showDebug,
    toggleDebug,
  } = useAppStore();

  const [currentTrace, setCurrentTrace] = useState<Point2D[]>([]);
  const [lastShotFeedback, setLastShotFeedback] = useState<Shot | null>(null);
  const [irPosition, setIrPosition] = useState<Point2D | null>(null);
  const [brightness, setBrightness] = useState(0);
  const [shotTimer, setShotTimer] = useState(0);
  const [setupDone, setSetupDone] = useState(false);

  const scoringEngine = useRef(new ScoringEngine(activeTarget, projectionConfig));
  const calibrationEngine = useRef(new CalibrationEngine(calibrationProfile));

  // Handle shot from Python detector
  const handleShot = useCallback((shot: ShotEvent) => {
    if (isPaused) return;

    // Apply weapon offset
    const screenPos = {
      x: shot.screenX,
      y: shot.screenY,
    };

    // Bounds check
    const margin = 200;
    if (screenPos.x < -margin || screenPos.x > projectionConfig.width + margin ||
        screenPos.y < -margin || screenPos.y > projectionConfig.height + margin) {
      return;
    }

    const score = scoringEngine.current.calculateScore(screenPos);
    const newShot: Shot = {
      id: uuidv4(),
      cameraPosition: { x: shot.cameraX, y: shot.cameraY },
      screenPosition: screenPos,
      score,
      timestamp: Date.now(),
      tracePoints: [],
    };

    addShot(newShot);
    setLastShotFeedback(newShot);
    setShotTimer(0);

    const api = window.electronAPI;
    if (api?.sendToProjector) {
      api.sendToProjector({
        type: 'show-hit',
        position: screenPos,
        score,
        hitMarkerSize: projectionConfig.hitMarkerSize,
      });
    }

    console.log(`[Shooting] Hit: pos=(${Math.round(screenPos.x)},${Math.round(screenPos.y)}) score=${score} diff=${shot.peakDiff}`);
    setTimeout(() => setLastShotFeedback(null), 2000);
  }, [isPaused, projectionConfig, addShot]);

  // Connect to Python detector
  const detector = useDetector(handleShot, !isPaused);

  // Setup the detector when connected
  useEffect(() => {
    if (!detector.status.connected || setupDone) return;

    const setup = async () => {
      // Open camera
      detector.openCamera(0, cameraConfig.width, cameraConfig.height, 60);

      // Wait for camera to open
      await new Promise(r => setTimeout(r, 1000));

      // Set calibration preset first for exposure adjustment
      detector.setPreset('calibration');
      await new Promise(r => setTimeout(r, 500));

      // Auto-adjust exposure
      detector.autoAdjustExposure(40);
      await new Promise(r => setTimeout(r, 3000));

      // Switch to tracking preset
      detector.setPreset('tracking');
      await new Promise(r => setTimeout(r, 500));

      // Set homography from calibration
      if (isCalibrated && calibrationProfile.homography.length === 9) {
        detector.setHomography(calibrationProfile.homography);
      }

      // Set ROI
      if (isCalibrated && calibrationProfile.calibrationPoints.length >= 4) {
        const roi = calibrationEngine.current.getCameraROI(cameraConfig.width, cameraConfig.height);
        if (roi) detector.setROI(roi);
      }

      // Capture baseline
      detector.captureBaseline();
      await new Promise(r => setTimeout(r, 2000));

      // Start detection
      detector.startDetection();
      setSetupDone(true);
      console.log('[Shooting] Detection active via Python service');
    };

    setup();
  }, [detector.status.connected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show target on projector
  useEffect(() => {
    const api = window.electronAPI;
    if (api?.sendToProjector) {
      api.sendToProjector({
        type: 'show-target',
        target: activeTarget,
        projection: projectionConfig,
      });
    }
  }, [activeTarget, projectionConfig]);

  // Shot timer
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isPaused) setShotTimer(t => t + 0.01);
    }, 10);
    return () => clearInterval(interval);
  }, [isPaused]);

  // Stop detection on unmount
  useEffect(() => {
    return () => { detector.stopDetection(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      switch (e.key.toLowerCase()) {
        case 'p': setPaused(!isPaused); break;
        case ' ': e.preventDefault(); undoLastShot(); break;
        case 'c':
          clearShots();
          window.electronAPI?.sendToProjector({ type: 'clear' });
          break;
        case 'd': toggleDebug(); break;
        case 'escape': setScreen('main-menu'); break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isPaused, setPaused, undoLastShot, clearShots, setScreen, toggleDebug]);

  return (
    <div className="w-full h-full relative bg-tactical-darker">
      <TargetCanvas
        target={activeTarget}
        projection={projectionConfig}
        shots={shots}
        currentTrace={currentTrace}
        irPosition={irPosition}
      />

      {/* Status bar */}
      <div className="absolute top-2 right-2 z-20 text-[10px] font-mono text-slate-500 space-y-0.5">
        <div>Python: {detector.status.connected ? '🟢' : '🔴'} {detector.status.fps}fps</div>
        <div>Diff: {detector.status.peakDiff} / {detector.status.threshold}</div>
        {!setupDone && detector.status.connected && <div className="text-tactical-orange">Setting up...</div>}
        {!detector.status.connected && <div className="text-tactical-red">Start: python python/detector.py</div>}
      </div>

      <HUDOverlay
        shots={shots}
        brightness={detector.status.peakDiff}
        irPosition={irPosition}
        isPaused={isPaused}
        isCalibrated={isCalibrated}
        shotTimer={shotTimer}
        shotsPerSeries={shotsPerSeries}
        targetName={activeTarget.name}
        showCamera={false}
        onToggleCamera={() => {}}
        onBack={() => setScreen('main-menu')}
        onPause={() => setPaused(!isPaused)}
        onClear={() => {
          clearShots();
          window.electronAPI?.sendToProjector({ type: 'clear' });
        }}
        onUndo={() => {
          undoLastShot();
          const api = window.electronAPI;
          if (api?.sendToProjector) {
            api.sendToProjector({ type: 'clear' });
            useAppStore.getState().shots.forEach(s => {
              api.sendToProjector({ type: 'show-hit', position: s.screenPosition, score: s.score, hitMarkerSize: projectionConfig.hitMarkerSize });
            });
          }
        }}
      />

      <AnimatePresence>
        {lastShotFeedback && <ShotFeedback shot={lastShotFeedback} />}
      </AnimatePresence>

      {!isCalibrated && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30">
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="hud-border-orange px-6 py-3 text-center">
            <div className="text-tactical-orange font-hud text-sm tracking-wider">NOT CALIBRATED</div>
            <p className="text-xs text-slate-500 mt-1">
              <button className="text-tactical-accent underline" onClick={() => setScreen('calibration')}>Calibrate now</button>
            </p>
          </motion.div>
        </div>
      )}

      {isPaused && (
        <div className="absolute inset-0 flex items-center justify-center bg-tactical-darker/60 z-40 pointer-events-none">
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="font-hud text-4xl text-tactical-yellow text-glow-orange tracking-[0.3em]">
            PAUSED
          </motion.div>
        </div>
      )}
    </div>
  );
}
