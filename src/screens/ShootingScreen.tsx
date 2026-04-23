import { useCallback, useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';
import { useCamera } from '../hooks/useCamera';
import { useDetectionLoop } from '../hooks/useDetectionLoop';
import { ScoringEngine } from '../engine/ScoringEngine';
import { CalibrationEngine } from '../engine/CalibrationEngine';
import { TargetCanvas } from '../components/shooting/TargetCanvas';
import { HUDOverlay } from '../components/shooting/HUDOverlay';
import { ShotFeedback } from '../components/shooting/ShotFeedback';
import { CameraPreview } from '../components/shooting/CameraPreview';
import type { DetectionResult } from '../engine/IRDetector';
import type { Shot, Point2D } from '../types';
import { v4 as uuidv4 } from 'uuid';

export function ShootingScreen() {
  const {
    cameraConfig,
    detectionConfig,
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

  const { videoRef, isReady, error, switchPreset, autoAdjustTrackingExposure } = useCamera(cameraConfig);
  const [currentTrace, setCurrentTrace] = useState<Point2D[]>([]);
  const [lastShotFeedback, setLastShotFeedback] = useState<Shot | null>(null);
  const [irPosition, setIrPosition] = useState<Point2D | null>(null);
  const [rawCameraPosition, setRawCameraPosition] = useState<Point2D | null>(null);
  const [brightness, setBrightness] = useState(0);
  const [baseline, setBaseline] = useState(0);
  const [shotTimer, setShotTimer] = useState(0);
  const [showCamera, setShowCamera] = useState(false);

  const scoringEngine = useRef(new ScoringEngine(activeTarget, projectionConfig));
  const calibrationEngine = useRef(new CalibrationEngine(calibrationProfile));

  // Ensure projector is showing the target
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
      if (!isPaused) setShotTimer((t) => t + 0.01);
    }, 10);
    return () => clearInterval(interval);
  }, [isPaused]);

  // Handle each detection frame
  const handleFrame = useCallback(
    (result: DetectionResult) => {
      if (isPaused) return;

      setBrightness(result.brightness);
      setBaseline(result.baseline ?? 0);

      if (result.position) {
        setRawCameraPosition(result.position);

        const screenPos = isCalibrated
          ? calibrationEngine.current.cameraToScreen(result.position)
          : result.position;

        if (screenPos) {
          setIrPosition(screenPos);
          setCurrentTrace((prev) => [...prev.slice(-300), screenPos]);

          if (result.shotDetected) {
            const score = scoringEngine.current.calculateScore(screenPos);
            const newShot: Shot = {
              id: uuidv4(),
              cameraPosition: result.position,
              screenPosition: screenPos,
              score,
              timestamp: Date.now(),
              tracePoints: [...currentTrace, screenPos],
            };

            addShot(newShot);
            setLastShotFeedback(newShot);
            setCurrentTrace([]);
            setShotTimer(0);

            const api = window.electronAPI;
            if (api?.sendToProjector) {
              api.sendToProjector({ type: 'show-hit', position: screenPos, score, hitMarkerSize: projectionConfig.hitMarkerSize });
              console.log(`[ShootingScreen] Hit sent to projector: pos=(${Math.round(screenPos.x)},${Math.round(screenPos.y)}) score=${score}`);
            }

            setTimeout(() => setLastShotFeedback(null), 2000);
          }
        }
      } else {
        setIrPosition(null);
        setRawCameraPosition(null);
      }
    },
    [isPaused, isCalibrated, currentTrace, addShot]
  );

  const [baselineReady, setBaselineReady] = useState(false);

  const { reset: resetDetector, captureBaseline, setROI } = useDetectionLoop(videoRef.current, detectionConfig, isReady && !isPaused && baselineReady, handleFrame);

  // Setup: switch to tracking mode, adjust exposure, capture baseline.
  // Only runs once the camera is ready.
  useEffect(() => {
    if (!isReady) return;

    setBaselineReady(false);
    resetDetector();

    const setup = async () => {
      // Use calibration preset (saturation=0, black & white) — same settings
      // that worked for shot detection during calibration testing
      await switchPreset('calibration');
      console.log('[ShootingScreen] Using calibration preset for shooting');

      // Wait for camera to settle after preset switch
      await new Promise(r => setTimeout(r, 600));

      // Compute ROI first so we can sample within it
      let roi: { x: number; y: number; w: number; h: number } | null = null;
      if (isCalibrated && calibrationProfile.calibrationPoints.length >= 4) {
        roi = calibrationEngine.current.getCameraROI(
          cameraConfig.width,
          cameraConfig.height,
        );
        if (roi) {
          setROI(roi);
          console.log('[ShootingScreen] ROI set:', roi);
        }
      }

      // Use the exposure that was found during calibration
      // (stored in cameraConfig.exposure). This avoids the oscillation
      // problem with auto-adjustment.
      if (cameraConfig.exposure) {
        const stream = videoRef.current?.srcObject as MediaStream | null;
        const track = stream?.getVideoTracks()[0];
        if (track) {
          try {
            await track.applyConstraints({
              advanced: [{ exposureMode: 'manual', exposureTime: cameraConfig.exposure } as any],
            } as any);
            console.log(`[ShootingScreen] Using calibration exposure: ${cameraConfig.exposure}µs`);
          } catch { /* ignore */ }
        }
      }

      // Wait for camera to fully settle, then capture baseline
      await new Promise(r => setTimeout(r, 1000));
      captureBaseline();
      console.log('[ShootingScreen] Baseline capture started');

      // Wait for baseline to complete (~30 frames at 30fps = ~1 second)
      await new Promise(r => setTimeout(r, 1500));
      setBaselineReady(true);
      console.log('[ShootingScreen] Detection active');
    };

    setup();
  }, [isReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      switch (e.key.toLowerCase()) {
        case 'p':
          setPaused(!isPaused);
          break;
        case ' ':
          e.preventDefault();
          undoLastShot();
          break;
        case 'c':
          clearShots();
          setCurrentTrace([]);
          window.electronAPI?.sendToProjector({ type: 'clear' });
          break;
        case 'd':
          toggleDebug();
          break;
        case 'v':
          setShowCamera((s) => !s);
          break;
        case 'escape':
          setScreen('main-menu');
          break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isPaused, setPaused, undoLastShot, clearShots, setScreen, toggleDebug]);

  return (
    <div className="w-full h-full relative bg-tactical-darker">
      {/* Hidden video element for camera capture */}
      <video ref={videoRef} className="hidden" playsInline muted />

      {/* Main target canvas */}
      <TargetCanvas
        target={activeTarget}
        projection={projectionConfig}
        shots={shots}
        currentTrace={currentTrace}
        irPosition={irPosition}
      />

      {/* Camera feed preview (toggle with V key) */}
      <CameraPreview
        videoElement={videoRef.current}
        irPosition={rawCameraPosition}
        brightness={brightness}
        baseline={baseline}
        threshold={detectionConfig.brightnessThreshold}
        isVisible={showCamera}
        onClose={() => setShowCamera(false)}
      />

      {/* HUD overlay */}
      <HUDOverlay
        shots={shots}
        brightness={brightness}
        irPosition={irPosition}
        isPaused={isPaused}
        isCalibrated={isCalibrated}
        shotTimer={shotTimer}
        shotsPerSeries={shotsPerSeries}
        targetName={activeTarget.name}
        showCamera={showCamera}
        onToggleCamera={() => setShowCamera((s) => !s)}
        onBack={() => setScreen('main-menu')}
        onPause={() => setPaused(!isPaused)}
        onClear={() => {
          clearShots();
          setCurrentTrace([]);
          window.electronAPI?.sendToProjector({ type: 'clear' });
        }}
        onUndo={() => {
          undoLastShot();
          const api = window.electronAPI;
          if (api?.sendToProjector) {
            api.sendToProjector({ type: 'clear' });
            const remaining = useAppStore.getState().shots;
            remaining.forEach((s) => {
              api.sendToProjector({ type: 'show-hit', position: s.screenPosition, score: s.score, hitMarkerSize: projectionConfig.hitMarkerSize });
            });
          }
        }}
      />

      <AnimatePresence>
        {lastShotFeedback && <ShotFeedback shot={lastShotFeedback} />}
      </AnimatePresence>

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-tactical-darker/90 z-50">
          <div className="hud-border p-8 max-w-md text-center">
            <div className="text-tactical-red font-hud text-xl mb-4">CAMERA ERROR</div>
            <p className="text-slate-400 mb-6">{error}</p>
            <button className="btn-tactical" onClick={() => setScreen('settings')}>
              Open Settings
            </button>
          </div>
        </div>
      )}

      {!isCalibrated && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="hud-border-orange px-6 py-3 text-center"
          >
            <div className="text-tactical-orange font-hud text-sm tracking-wider">⚠ NOT CALIBRATED</div>
            <p className="text-xs text-slate-500 mt-1">
              Shots won't map correctly.{' '}
              <button className="text-tactical-accent underline" onClick={() => setScreen('calibration')}>
                Calibrate now
              </button>
            </p>
          </motion.div>
        </div>
      )}

      {isPaused && (
        <div className="absolute inset-0 flex items-center justify-center bg-tactical-darker/60 z-40 pointer-events-none">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="font-hud text-4xl text-tactical-yellow text-glow-orange tracking-[0.3em]"
          >
            PAUSED
          </motion.div>
        </div>
      )}
    </div>
  );
}
