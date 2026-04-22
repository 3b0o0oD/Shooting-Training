import { useState, useCallback, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';
import { useCamera } from '../hooks/useCamera';
import { useDetectionLoop } from '../hooks/useDetectionLoop';
import { CalibrationEngine } from '../engine/CalibrationEngine';
import { CameraPreview } from '../components/shooting/CameraPreview';
import type { DetectionResult } from '../engine/IRDetector';
import type { Point2D, CalibrationPoint, DisplayInfo } from '../types';

type CalibStep = 'setup' | 'projecting' | 'testing' | 'adjusting' | 'complete';

export function CalibrationScreen() {
  const {
    cameraConfig,
    detectionConfig,
    projectionConfig,
    setProjectionConfig,
    calibrationProfile,
    setCalibrationProfile,
    setCalibrated,
    setScreen,
  } = useAppStore();

  const { videoRef, isReady, error } = useCamera(cameraConfig);
  const [step, setStep] = useState<CalibStep>('setup');
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [selectedDisplay, setSelectedDisplay] = useState(0);
  const [currentMarker, setCurrentMarker] = useState(0);
  const [collectedPoints, setCollectedPoints] = useState<CalibrationPoint[]>([]);
  const [irPosition, setIrPosition] = useState<Point2D | null>(null);
  const [rawCameraPosition, setRawCameraPosition] = useState<Point2D | null>(null);
  const [mappedPosition, setMappedPosition] = useState<Point2D | null>(null);
  const [brightness, setBrightness] = useState(0);
  const [baseline, setBaseline] = useState(0);
  const [showCamera, setShowCamera] = useState(true);

  const engineRef = useRef(new CalibrationEngine(calibrationProfile));

  const getMarkerPositions = useCallback((): Point2D[] => {
    const w = projectionConfig.width;
    const h = projectionConfig.height;
    const inset = 0.2;
    return [
      { x: w * inset, y: h * inset },
      { x: w * (1 - inset), y: h * inset },
      { x: w * (1 - inset), y: h * (1 - inset) },
      { x: w * inset, y: h * (1 - inset) },
    ];
  }, [projectionConfig.width, projectionConfig.height]);

  useEffect(() => {
    const api = window.electronAPI;
    if (api?.getDisplays) {
      api.getDisplays().then((d: DisplayInfo[]) => setDisplays(d));
    }
  }, []);

  const showMarker = useCallback(
    (index: number) => {
      const positions = getMarkerPositions();
      const api = window.electronAPI;
      if (api?.sendToProjector && positions[index]) {
        api.sendToProjector({
          type: 'show-calibration-marker',
          position: positions[index],
          markerIndex: index,
        });
      }
    },
    [getMarkerPositions]
  );

  const handleFrame = useCallback(
    (result: DetectionResult) => {
      setBrightness(result.brightness);
      setBaseline(result.baseline ?? 0);
      setRawCameraPosition(result.position);
      setIrPosition(result.position);

      // In test mode, show where the camera point maps to on screen
      if (step === 'testing' && result.position && engineRef.current.hasValidHomography()) {
        const mapped = engineRef.current.cameraToScreen(result.position);
        setMappedPosition(mapped);

        // Send the mapped position to projector as a live cursor
        const api = window.electronAPI;
        if (api?.sendToProjector && mapped) {
          api.sendToProjector({
            type: 'show-calibration-marker',
            position: mapped,
            markerIndex: 99, // Special index for "live cursor" mode
          });
        }
      }

      if (step === 'projecting' && result.shotDetected && result.position) {
        const markers = getMarkerPositions();
        const newPoint: CalibrationPoint = {
          screen: markers[currentMarker],
          camera: result.position,
        };

        const updatedPoints = [...collectedPoints, newPoint];
        setCollectedPoints(updatedPoints);

        if (updatedPoints.length >= 4) {
          try {
            const profile = engineRef.current.computeHomography(updatedPoints);
            setCalibrationProfile(profile);
            // Go to test step instead of adjusting
            setStep('testing');
            // Show target on projector for testing
            const api = window.electronAPI;
            const { activeTarget, projectionConfig: proj } = useAppStore.getState();
            if (api?.sendToProjector) {
              api.sendToProjector({ type: 'show-target', target: activeTarget, projection: proj });
            }
          } catch (err) {
            console.error('Homography computation failed:', err);
            setCollectedPoints([]);
            setCurrentMarker(0);
            showMarker(0);
          }
        } else {
          const nextMarker = currentMarker + 1;
          setCurrentMarker(nextMarker);
          setTimeout(() => showMarker(nextMarker), 800);
        }
      }
    },
    [step, currentMarker, collectedPoints, getMarkerPositions, showMarker, setCalibrationProfile]
  );

  useDetectionLoop(
    videoRef.current,
    detectionConfig,
    isReady && (step === 'projecting' || step === 'testing' || step === 'adjusting'),
    handleFrame
  );

  const handleStartCalibration = async () => {
    const api = window.electronAPI;
    if (api?.openProjectorWindow) {
      const result = await api.openProjectorWindow(selectedDisplay);
      if (result) {
        setProjectionConfig({ displayIndex: selectedDisplay, width: result.width, height: result.height });
        setTimeout(() => {
          setStep('projecting');
          setCurrentMarker(0);
          setCollectedPoints([]);
          showMarker(0);
        }, 1500);
      }
    }
  };

  const handleNudge = (dx: number, dy: number) => {
    const profile = engineRef.current.nudgeOffset(dx, dy);
    setCalibrationProfile(profile);
  };

  const handleComplete = () => {
    setCalibrated(true);
    setStep('complete');
    const api = window.electronAPI;
    const { activeTarget, projectionConfig: proj } = useAppStore.getState();
    if (api?.sendToProjector) {
      api.sendToProjector({ type: 'show-target', target: activeTarget, projection: proj });
    }
    setTimeout(() => setScreen('shooting'), 1500);
  };

  const handleReset = () => {
    setCollectedPoints([]);
    setCurrentMarker(0);
    setMappedPosition(null);
    setStep('setup');
    engineRef.current = new CalibrationEngine({
      ...calibrationProfile,
      homography: [],
      calibrationPoints: [],
      manualOffset: { x: 0, y: 0 },
      reprojectionError: Infinity,
    });
  };

  const markerLabels = ['Top-Left', 'Top-Right', 'Bottom-Right', 'Bottom-Left'];

  return (
    <div className="w-full h-full flex flex-col items-center justify-center relative bg-tactical-darker">
      <video ref={videoRef} className="hidden" playsInline muted />
      <div className="absolute inset-0 tactical-grid opacity-50" />

      {/* Camera preview — always available during calibration */}
      <CameraPreview
        videoElement={videoRef.current}
        irPosition={rawCameraPosition}
        brightness={brightness}
        baseline={baseline}
        threshold={detectionConfig.brightnessThreshold}
        isVisible={showCamera}
        onClose={() => setShowCamera(false)}
      />

      <div className="relative z-10 w-full max-w-2xl px-8">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-6">
          <h2 className="font-hud text-3xl text-tactical-orange text-glow-orange tracking-[0.2em]">CALIBRATION</h2>
          <div className="text-sm text-slate-500 font-tactical tracking-wider mt-1">
            {step === 'setup' && 'Select your projector display to begin'}
            {step === 'projecting' && `Shoot at marker ${currentMarker + 1}/4 — ${markerLabels[Math.min(currentMarker, 3)]}`}
            {step === 'testing' && 'Point your IR gun around — verify the mapping is accurate'}
            {step === 'adjusting' && 'Fine-tune the calibration offset'}
            {step === 'complete' && 'Calibration locked in'}
          </div>
        </motion.div>

        {/* IR status + camera toggle */}
        <div className="flex items-center justify-center gap-4 mb-6">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${irPosition ? 'bg-tactical-green shadow-neon-green' : 'bg-slate-600'}`} />
            <span className="text-xs text-slate-400 font-mono">
              {irPosition ? 'IR DETECTED' : 'NO SIGNAL'} • {Math.round(brightness)}
            </span>
          </div>
          <button
            onClick={() => setShowCamera((s) => !s)}
            className={`text-[10px] font-mono px-2 py-1 border rounded transition-all ${
              showCamera ? 'border-tactical-accent text-tactical-accent' : 'border-tactical-border text-slate-500'
            }`}
          >
            {showCamera ? 'HIDE CAM' : 'SHOW CAM'}
          </button>
        </div>

        {/* ─── SETUP ─── */}
        {step === 'setup' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <div className="hud-border p-6 space-y-4">
              <div className="text-sm text-slate-300 font-tactical space-y-2">
                <p>1. Connect your projector as a second display</p>
                <p>2. Select the projector display below</p>
                <p>3. Position your camera to see the projected area</p>
                <p>4. The app will project 4 markers — shoot each one</p>
                <p>5. Verify the mapping, then fine-tune if needed</p>
              </div>
              <div className="mt-4">
                <div className="text-[10px] text-slate-500 font-mono uppercase tracking-wider mb-2">Projector Display</div>
                <select
                  value={selectedDisplay}
                  onChange={(e) => setSelectedDisplay(Number(e.target.value))}
                  className="w-full bg-tactical-darker border border-tactical-border rounded px-3 py-2 text-sm text-slate-300 font-mono focus:border-tactical-accent outline-none"
                >
                  {displays.map((d, i) => (
                    <option key={d.id} value={i}>{d.label}</option>
                  ))}
                  {displays.length === 0 && <option value={0}>Display 1 (default)</option>}
                </select>
              </div>
            </div>
            <div className="text-center">
              <button className="btn-tactical btn-tactical-orange" onClick={handleStartCalibration} disabled={!isReady}>
                {isReady ? 'Open Projector & Begin' : 'Waiting for camera...'}
              </button>
            </div>
          </motion.div>
        )}

        {/* ─── PROJECTING ─── */}
        {step === 'projecting' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <div className="flex justify-center gap-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="text-center">
                  <div className={`w-14 h-14 rounded-lg border-2 flex items-center justify-center font-hud transition-all ${
                    i < collectedPoints.length
                      ? 'border-tactical-green bg-tactical-green/10 text-tactical-green'
                      : i === currentMarker
                        ? 'border-tactical-orange bg-tactical-orange/10 text-tactical-orange animate-pulse'
                        : 'border-tactical-border text-slate-600'
                  }`}>
                    {i < collectedPoints.length ? <span className="text-xl">✓</span> : <span className="text-lg">{i + 1}</span>}
                  </div>
                  <div className="text-[9px] text-slate-500 font-mono mt-1">{markerLabels[i]}</div>
                </div>
              ))}
            </div>
            <div className="text-center text-slate-400 text-sm font-tactical">
              Aim at the bright marker on the projection and fire
            </div>
            <div className="text-center">
              <button className="btn-tactical text-xs" onClick={handleReset}>Restart</button>
            </div>
          </motion.div>
        )}

        {/* ─── TESTING (new step) ─── */}
        {step === 'testing' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <div className="hud-border p-4 text-center">
              <div className="text-[10px] text-slate-500 font-mono uppercase tracking-wider mb-2">Calibration Quality</div>
              <div className={`font-hud text-2xl ${
                calibrationProfile.reprojectionError < 5
                  ? 'text-tactical-green text-glow-green'
                  : calibrationProfile.reprojectionError < 15
                    ? 'text-tactical-yellow'
                    : 'text-tactical-red text-glow-red'
              }`}>
                {calibrationProfile.reprojectionError < 5 ? 'EXCELLENT' : calibrationProfile.reprojectionError < 15 ? 'GOOD' : 'POOR'}
              </div>
              <div className="text-xs text-slate-500 font-mono mt-1">
                Error: {calibrationProfile.reprojectionError.toFixed(1)}px
              </div>
            </div>

            <div className="hud-border p-4">
              <div className="text-[10px] text-slate-500 font-mono uppercase tracking-wider mb-3">Live Mapping Test</div>
              <div className="text-sm text-slate-300 font-tactical mb-2">
                Point your IR gun at different spots on the projected target. The projector should show a cursor following your aim in real-time.
              </div>
              {mappedPosition && (
                <div className="text-xs text-tactical-accent font-mono">
                  Screen: ({Math.round(mappedPosition.x)}, {Math.round(mappedPosition.y)})
                  {rawCameraPosition && (
                    <span className="text-slate-500 ml-2">
                      Camera: ({Math.round(rawCameraPosition.x)}, {Math.round(rawCameraPosition.y)})
                    </span>
                  )}
                </div>
              )}
              {!irPosition && (
                <div className="text-xs text-slate-600 italic">No IR signal — point your gun at the projection</div>
              )}
            </div>

            <div className="flex justify-center gap-3">
              <button className="btn-tactical" onClick={handleReset}>Restart</button>
              <button className="btn-tactical" onClick={() => setStep('adjusting')}>Fine-Tune</button>
              <button className="btn-tactical btn-tactical-orange" onClick={handleComplete}>
                Looks Good — Accept
              </button>
            </div>
          </motion.div>
        )}

        {/* ─── ADJUSTING ─── */}
        {step === 'adjusting' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <div className="hud-border p-6">
              <div className="text-[10px] text-slate-500 font-mono uppercase tracking-wider mb-3">Manual Offset</div>
              <div className="text-xs text-slate-500 font-mono mb-4">
                X={calibrationProfile.manualOffset.x.toFixed(0)} Y={calibrationProfile.manualOffset.y.toFixed(0)}
              </div>
              <div className="grid grid-cols-3 gap-2 w-40 mx-auto">
                <div />
                <button className="btn-tactical text-xs py-2 px-3" onClick={() => handleNudge(0, -2)}>▲</button>
                <div />
                <button className="btn-tactical text-xs py-2 px-3" onClick={() => handleNudge(-2, 0)}>◄</button>
                <div className="w-10 h-10 border border-tactical-border rounded flex items-center justify-center text-xs text-slate-600">+</div>
                <button className="btn-tactical text-xs py-2 px-3" onClick={() => handleNudge(2, 0)}>►</button>
                <div />
                <button className="btn-tactical text-xs py-2 px-3" onClick={() => handleNudge(0, 2)}>▼</button>
                <div />
              </div>
            </div>
            <div className="flex justify-center gap-3">
              <button className="btn-tactical" onClick={() => setStep('testing')}>Back to Test</button>
              <button className="btn-tactical btn-tactical-orange" onClick={handleComplete}>Accept & Shoot</button>
            </div>
          </motion.div>
        )}

        {/* ─── COMPLETE ─── */}
        {step === 'complete' && (
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center">
            <div className="font-hud text-4xl text-tactical-green text-glow-green tracking-wider">CALIBRATED</div>
            <p className="text-slate-500 text-sm mt-2">Entering shooting mode...</p>
          </motion.div>
        )}

        {error && <div className="mt-6 text-center text-tactical-red text-sm">Camera error: {error}</div>}

        <div className="mt-8 text-center">
          <button
            className="text-xs text-slate-600 hover:text-slate-400 font-mono transition-colors"
            onClick={() => { window.electronAPI?.closeProjectorWindow(); setScreen('main-menu'); }}
          >
            ← Back to Menu
          </button>
        </div>
      </div>
    </div>
  );
}
