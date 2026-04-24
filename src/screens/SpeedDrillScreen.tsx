import { useCallback, useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';
import { useCamera } from '../hooks/useCamera';
import { useDetectionLoop } from '../hooks/useDetectionLoop';
import { CalibrationEngine } from '../engine/CalibrationEngine';
import { CameraPreview } from '../components/shooting/CameraPreview';
import type { DetectionResult } from '../engine/IRDetector';
import type { Point2D } from '../types';

interface DrillTarget {
  id: number;
  position: Point2D;  // screen coordinates
  radius: number;     // pixels
  spawnTime: number;
  lifetime: number;   // ms before it disappears
  hit: boolean;
  missed: boolean;
}

export function SpeedDrillScreen() {
  const {
    cameraConfig,
    detectionConfig,
    projectionConfig,
    calibrationProfile,
    isCalibrated,
    setScreen,
  } = useAppStore();

  const { videoRef, isReady, error, switchPreset } = useCamera(cameraConfig);
  const [brightness, setBrightness] = useState(0);
  const [baseline, setBaseline] = useState(0);
  const [rawCameraPosition, setRawCameraPosition] = useState<Point2D | null>(null);
  const [showCamera, setShowCamera] = useState(false);

  // Drill state
  const [score, setScore] = useState(0);
  const [hits, setHits] = useState(0);
  const [misses, setMisses] = useState(0);
  const [totalTargets, setTotalTargets] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);
  const [isRunning, setIsRunning] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [baselineReady, setBaselineReady] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  const targetsRef = useRef<DrillTarget[]>([]);
  const nextIdRef = useRef(1);
  const calibrationEngine = useRef(new CalibrationEngine(calibrationProfile));

  // Drill config
  const DRILL_DURATION = 60; // seconds
  const TARGET_LIFETIME = 2000; // ms — how long each target stays
  const TARGET_RADIUS = 40; // pixels on projector
  const SPAWN_INTERVAL = 1500; // ms between new targets
  const HIT_SCORE = 10;
  const MISS_SCORE = -2;

  // Send target to projector
  const showDrillTarget = useCallback((target: DrillTarget) => {
    const api = window.electronAPI;
    if (api?.sendToProjector) {
      api.sendToProjector({
        type: 'speed-drill-target',
        position: target.position,
        radius: target.radius,
        id: target.id,
      });
    }
  }, []);

  const removeDrillTarget = useCallback((targetId: number, wasHit: boolean) => {
    const api = window.electronAPI;
    if (api?.sendToProjector) {
      api.sendToProjector({
        type: wasHit ? 'speed-drill-hit' : 'speed-drill-miss',
        targetId,
      });
    }
  }, []);

  // Handle shot detection
  const handleFrame = useCallback(
    (result: DetectionResult) => {
      if (!isRunning) return;

      setBrightness(result.brightness);
      setBaseline(result.baseline ?? 0);

      if (result.position) {
        setRawCameraPosition(result.position);

        if (result.shotDetected) {
          const screenPos = isCalibrated
            ? calibrationEngine.current.cameraToScreen(result.position)
            : result.position;

          if (screenPos) {
            // Check if the shot hit any active target
            let hitTarget: DrillTarget | null = null;
            for (const t of targetsRef.current) {
              if (t.hit || t.missed) continue;
              const dx = screenPos.x - t.position.x;
              const dy = screenPos.y - t.position.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist <= t.radius * 1.5) { // 1.5x radius for forgiving hit detection
                hitTarget = t;
                break;
              }
            }

            if (hitTarget) {
              hitTarget.hit = true;
              setScore(s => s + HIT_SCORE);
              setHits(h => h + 1);
              removeDrillTarget(hitTarget.id, true);
              console.log(`[SpeedDrill] HIT target ${hitTarget.id} at (${Math.round(screenPos.x)},${Math.round(screenPos.y)})`);
            }
          }
        }
      } else {
        setRawCameraPosition(null);
      }
    },
    [isRunning, isCalibrated, removeDrillTarget],
  );

  const { reset: resetDetector, captureBaseline, setROI } = useDetectionLoop(
    videoRef.current, detectionConfig, isReady && baselineReady, handleFrame,
  );

  // Camera setup (same as ShootingScreen)
  useEffect(() => {
    if (!isReady) return;

    setBaselineReady(false);
    resetDetector();

    const setup = async () => {
      await switchPreset('calibration');

      await new Promise(r => setTimeout(r, 600));

      if (isCalibrated && calibrationProfile.calibrationPoints.length >= 4) {
        const roi = calibrationEngine.current.getCameraROI(cameraConfig.width, cameraConfig.height);
        if (roi) setROI(roi);
      }

      if (cameraConfig.exposure) {
        const stream = videoRef.current?.srcObject as MediaStream | null;
        const track = stream?.getVideoTracks()[0];
        if (track) {
          try {
            await track.applyConstraints({
              advanced: [{ exposureMode: 'manual', exposureTime: cameraConfig.exposure } as any],
            } as any);
          } catch { /* ignore */ }
        }
      }

      await new Promise(r => setTimeout(r, 1000));
      captureBaseline();

      await new Promise(r => setTimeout(r, 1500));
      setBaselineReady(true);
    };

    setup();
  }, [isReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Blank the projector initially
  useEffect(() => {
    const api = window.electronAPI;
    if (api?.sendToProjector) {
      api.sendToProjector({ type: 'blank' });
    }
  }, []);

  // Spawn targets while drill is running
  useEffect(() => {
    if (!isRunning) return;

    const spawnTarget = () => {
      const w = projectionConfig.width;
      const h = projectionConfig.height;
      const margin = TARGET_RADIUS * 2;

      const target: DrillTarget = {
        id: nextIdRef.current++,
        position: {
          x: margin + Math.random() * (w - margin * 2),
          y: margin + Math.random() * (h - margin * 2),
        },
        radius: TARGET_RADIUS,
        spawnTime: Date.now(),
        lifetime: TARGET_LIFETIME,
        hit: false,
        missed: false,
      };

      targetsRef.current.push(target);
      setTotalTargets(t => t + 1);
      showDrillTarget(target);
    };

    spawnTarget(); // First target immediately
    const interval = setInterval(spawnTarget, SPAWN_INTERVAL);
    return () => clearInterval(interval);
  }, [isRunning, projectionConfig.width, projectionConfig.height, showDrillTarget]);

  // Check for expired targets
  useEffect(() => {
    if (!isRunning) return;

    const check = setInterval(() => {
      const now = Date.now();
      for (const t of targetsRef.current) {
        if (!t.hit && !t.missed && now - t.spawnTime > t.lifetime) {
          t.missed = true;
          setScore(s => s + MISS_SCORE);
          setMisses(m => m + 1);
          removeDrillTarget(t.id, false);
        }
      }
      // Clean up old targets
      targetsRef.current = targetsRef.current.filter(
        t => now - t.spawnTime < t.lifetime + 2000
      );
    }, 100);

    return () => clearInterval(check);
  }, [isRunning, removeDrillTarget]);

  // Countdown timer
  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          setIsRunning(false);
          setIsFinished(true);
          // Clear projector
          window.electronAPI?.sendToProjector({ type: 'speed-drill-clear' });
          return 0;
        }
        return t - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning]);

  // Start drill with countdown
  const startDrill = () => {
    setScore(0);
    setHits(0);
    setMisses(0);
    setTotalTargets(0);
    setTimeLeft(DRILL_DURATION);
    setIsFinished(false);
    targetsRef.current = [];
    nextIdRef.current = 1;

    // 3-2-1 countdown
    setCountdown(3);
    setTimeout(() => setCountdown(2), 1000);
    setTimeout(() => setCountdown(1), 2000);
    setTimeout(() => {
      setCountdown(null);
      setIsRunning(true);
    }, 3000);
  };

  const accuracy = totalTargets > 0 ? Math.round((hits / totalTargets) * 100) : 0;

  return (
    <div className="w-full h-full relative bg-tactical-darker">
      <video ref={videoRef} className="hidden" playsInline muted />

      <CameraPreview
        videoElement={videoRef.current}
        irPosition={rawCameraPosition}
        brightness={brightness}
        baseline={baseline}
        threshold={detectionConfig.brightnessThreshold}
        isVisible={showCamera}
        onClose={() => setShowCamera(false)}
      />

      <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
        {/* Header */}
        <div className="absolute top-4 left-0 right-0 flex items-center justify-between px-8">
          <button
            className="text-xs text-slate-600 hover:text-slate-400 font-mono"
            onClick={() => { setIsRunning(false); window.electronAPI?.sendToProjector({ type: 'blank' }); setScreen('main-menu'); }}
          >
            ← Menu
          </button>

          <h2 className="font-hud text-2xl text-tactical-accent tracking-[0.2em]">SPEED DRILL</h2>

          <button
            onClick={() => setShowCamera(s => !s)}
            className={`text-[10px] font-mono px-2 py-1 border rounded ${
              showCamera ? 'border-tactical-accent text-tactical-accent' : 'border-tactical-border text-slate-500'
            }`}
          >
            {showCamera ? 'HIDE CAM' : 'SHOW CAM'}
          </button>
        </div>

        {/* HUD — score, time, accuracy */}
        {(isRunning || isFinished) && (
          <div className="absolute top-16 left-0 right-0 flex justify-center gap-8">
            <div className="text-center">
              <div className="text-[10px] text-slate-500 font-mono uppercase">Time</div>
              <div className={`font-hud text-3xl ${timeLeft <= 10 ? 'text-tactical-red' : 'text-tactical-accent'}`}>
                {timeLeft}s
              </div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-slate-500 font-mono uppercase">Score</div>
              <div className="font-hud text-3xl text-tactical-yellow">{score}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-slate-500 font-mono uppercase">Hits</div>
              <div className="font-hud text-3xl text-tactical-green">{hits}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-slate-500 font-mono uppercase">Misses</div>
              <div className="font-hud text-3xl text-tactical-red">{misses}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-slate-500 font-mono uppercase">Accuracy</div>
              <div className="font-hud text-3xl text-tactical-orange">{accuracy}%</div>
            </div>
          </div>
        )}

        {/* Countdown */}
        <AnimatePresence>
          {countdown !== null && (
            <motion.div
              key={countdown}
              initial={{ scale: 2, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              className="font-hud text-8xl text-tactical-accent text-glow-cyan"
            >
              {countdown}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Start screen */}
        {!isRunning && !isFinished && countdown === null && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center space-y-6">
            <div className="font-hud text-4xl text-tactical-accent tracking-wider">SPEED DRILL</div>
            <div className="text-slate-400 font-tactical max-w-md">
              Random targets appear on the projection. Hit them before they disappear.
              You have {DRILL_DURATION} seconds. Each hit = +{HIT_SCORE} points, each miss = {MISS_SCORE} points.
            </div>
            <button
              className="btn-tactical btn-tactical-orange text-lg px-8 py-3"
              onClick={startDrill}
              disabled={!baselineReady}
            >
              {baselineReady ? 'START DRILL' : 'Preparing camera...'}
            </button>
          </motion.div>
        )}

        {/* Results screen */}
        {isFinished && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-center space-y-6"
          >
            <div className="font-hud text-4xl text-tactical-yellow tracking-wider">DRILL COMPLETE</div>

            <div className="hud-border p-6 space-y-3">
              <div className="flex justify-between text-sm font-tactical">
                <span className="text-slate-400">Final Score</span>
                <span className="text-tactical-yellow font-hud text-xl">{score}</span>
              </div>
              <div className="flex justify-between text-sm font-tactical">
                <span className="text-slate-400">Targets Hit</span>
                <span className="text-tactical-green">{hits} / {totalTargets}</span>
              </div>
              <div className="flex justify-between text-sm font-tactical">
                <span className="text-slate-400">Accuracy</span>
                <span className="text-tactical-orange">{accuracy}%</span>
              </div>
              <div className="flex justify-between text-sm font-tactical">
                <span className="text-slate-400">Rating</span>
                <span className={`font-hud ${
                  accuracy >= 80 ? 'text-tactical-green' :
                  accuracy >= 50 ? 'text-tactical-yellow' :
                  'text-tactical-red'
                }`}>
                  {accuracy >= 80 ? 'EXCELLENT' : accuracy >= 50 ? 'GOOD' : 'NEEDS PRACTICE'}
                </span>
              </div>
            </div>

            <div className="flex gap-3 justify-center">
              <button className="btn-tactical" onClick={() => setScreen('main-menu')}>Menu</button>
              <button className="btn-tactical btn-tactical-orange" onClick={startDrill}>Play Again</button>
            </div>
          </motion.div>
        )}

        {error && (
          <div className="absolute bottom-8 text-tactical-red text-sm font-mono">{error}</div>
        )}
      </div>
    </div>
  );
}
