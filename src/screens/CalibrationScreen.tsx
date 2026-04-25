import { useState, useCallback, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';
import { useCamera } from '../hooks/useCamera';
import { CalibrationEngine } from '../engine/CalibrationEngine';
import { CameraPreview } from '../components/shooting/CameraPreview';
import { useDetectionLoop } from '../hooks/useDetectionLoop';
import type { DetectionResult } from '../engine/IRDetector';
import type { Point2D, CalibrationPoint, DisplayInfo } from '../types';

type CalibStep = 'setup' | 'projecting' | 'testing' | 'adjusting' | 'complete';

/**
 * Grab the brightest point from a video frame.
 * Uses all color channels combined for maximum sensitivity —
 * works with both IR-filtered and unfiltered cameras.
 */
function findBrightestPoint(
  video: HTMLVideoElement,
  canvas: OffscreenCanvas,
  ctx: OffscreenCanvasRenderingContext2D,
): { position: Point2D; brightness: number } | null {
  const w = canvas.width;
  const h = canvas.height;
  ctx.drawImage(video, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  let maxB = 0;
  let maxX = 0;
  let maxY = 0;

  // Scan every 3rd pixel for speed at full resolution
  for (let y = 0; y < h; y += 3) {
    for (let x = 0; x < w; x += 3) {
      const i = (y * w + x) * 4;
      // Use max of R,G,B — catches the marker regardless of filter
      const b = Math.max(data[i], data[i + 1], data[i + 2]);
      if (b > maxB) { maxB = b; maxX = x; maxY = y; }
    }
  }

  // Refine at full resolution around the peak
  const r = 8;
  for (let y = Math.max(0, maxY - r); y < Math.min(h, maxY + r); y++) {
    for (let x = Math.max(0, maxX - r); x < Math.min(w, maxX + r); x++) {
      const i = (y * w + x) * 4;
      const b = Math.max(data[i], data[i + 1], data[i + 2]);
      if (b > maxB) { maxB = b; maxX = x; maxY = y; }
    }
  }

  if (maxB < 5) return null;

  // Weighted centroid
  const cr = 12;
  const thresh = maxB * 0.35;
  let sx = 0, sy = 0, sw = 0;
  for (let y = Math.max(0, maxY - cr); y < Math.min(h, maxY + cr); y++) {
    for (let x = Math.max(0, maxX - cr); x < Math.min(w, maxX + cr); x++) {
      const i = (y * w + x) * 4;
      const b = Math.max(data[i], data[i + 1], data[i + 2]);
      if (b >= thresh) { sx += x * b; sy += y * b; sw += b; }
    }
  }

  if (sw === 0) return null;
  return { position: { x: sx / sw, y: sy / sw }, brightness: maxB };
}

export function CalibrationScreen() {
  const {
    cameraConfig,
    setCameraConfig,
    detectionConfig,
    projectionConfig,
    setProjectionConfig,
    calibrationProfile,
    setCalibrationProfile,
    setCalibrated,
    setScreen,
  } = useAppStore();

  const { videoRef, isReady, error, switchPreset, autoAdjustTrackingExposure } = useCamera(cameraConfig);
  const [step, setStep] = useState<CalibStep>('setup');
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [selectedDisplay, setSelectedDisplay] = useState(0);
  const [currentMarker, setCurrentMarker] = useState(0);
  const [collectedPoints, setCollectedPoints] = useState<CalibrationPoint[]>([]);
  const [autoStatus, setAutoStatus] = useState('');
  const [brightness, setBrightness] = useState(0);
  const [baseline, setBaseline] = useState(0);
  const [showCamera, setShowCamera] = useState(true);
  const [rawCameraPosition, setRawCameraPosition] = useState<Point2D | null>(null);
  const [irPosition, setIrPosition] = useState<Point2D | null>(null);
  const [mappedPosition, setMappedPosition] = useState<Point2D | null>(null);

  const engineRef = useRef(new CalibrationEngine(calibrationProfile));
  const canvasRef = useRef<OffscreenCanvas | null>(null);
  const ctxRef = useRef<OffscreenCanvasRenderingContext2D | null>(null);
  const abortRef = useRef(false);

  const getMarkerPositions = useCallback((): Point2D[] => {
    const w = projectionConfig.width;
    const h = projectionConfig.height;
    // 5×5 grid of 25 calibration points for robust homography.
    // Over-determined system gives much better accuracy than 4 corners.
    const points: Point2D[] = [];
    const cols = 5;
    const rows = 5;
    const insetX = 0.12;
    const insetY = 0.12;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const px = insetX + (1 - 2 * insetX) * (c / (cols - 1));
        const py = insetY + (1 - 2 * insetY) * (r / (rows - 1));
        points.push({ x: w * px, y: h * py });
      }
    }
    return points;
  }, [projectionConfig.width, projectionConfig.height]);

  useEffect(() => {
    refreshDisplays();
    const api = window.electronAPI;
    if (api?.onDisplaysChanged) {
      const cleanup = api.onDisplaysChanged(() => refreshDisplays());
      return cleanup;
    }
  }, []);

  const refreshDisplays = () => {
    const api = window.electronAPI;
    if (api?.getDisplays) {
      api.getDisplays().then((d: DisplayInfo[]) => setDisplays(d));
    }
  };

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
    [getMarkerPositions],
  );

  // ── Detection loop for testing / adjusting steps (shot detection for shooting) ──
  const handleFrame = useCallback(
    (result: DetectionResult) => {
      setBrightness(result.brightness);
      setBaseline(result.baseline ?? 0);
      setRawCameraPosition(result.position);
      setIrPosition(result.position);

      if (step === 'testing' && engineRef.current.hasValidHomography()) {
        // Show live position if detected
        if (result.position) {
          const mapped = engineRef.current.cameraToScreen(result.position);
          setMappedPosition(mapped);
        }

        // Detect actual shots and show them as hits on the target
        if (result.shotDetected && result.position) {
          const mapped = engineRef.current.cameraToScreen(result.position);
          const api = window.electronAPI;
          if (api?.sendToProjector && mapped) {
            const { projectionConfig: proj } = useAppStore.getState();
            api.sendToProjector({
              type: 'show-hit',
              position: mapped,
              score: 0,
              hitMarkerSize: proj.hitMarkerSize,
            });
          }
        }
      }
    },
    [step],
  );

  const { reset: resetDetector, captureBaseline, setROI } = useDetectionLoop(
    videoRef.current,
    detectionConfig,
    isReady && (step === 'testing' || step === 'adjusting'),
    handleFrame,
  );

  // ── Automatic calibration routine ──

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /**
   * Sample the brightest point over several frames and return the average
   * position and brightness. Returns null if nothing bright enough is found.
   */
  const sampleBrightestPoint = useCallback(
    async (sampleCount: number, intervalMs: number): Promise<{ position: Point2D; brightness: number } | null> => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) return null;

      // Lazy-init the processing canvas
      if (!canvasRef.current || canvasRef.current.width !== video.videoWidth) {
        canvasRef.current = new OffscreenCanvas(video.videoWidth, video.videoHeight);
        ctxRef.current = canvasRef.current.getContext('2d', {
          willReadFrequently: true,
        }) as OffscreenCanvasRenderingContext2D;
      }

      const samples: Array<{ position: Point2D; brightness: number }> = [];
      for (let i = 0; i < sampleCount; i++) {
        if (abortRef.current) return null;
        await sleep(intervalMs);
        const result = findBrightestPoint(video, canvasRef.current!, ctxRef.current!);
        if (result) {
          samples.push(result);
        }
      }

      if (samples.length < sampleCount * 0.5) return null;

      // Average position and brightness
      const avgBrightness = samples.reduce((s, r) => s + r.brightness, 0) / samples.length;
      const avgPosition: Point2D = {
        x: samples.reduce((s, r) => s + r.position.x, 0) / samples.length,
        y: samples.reduce((s, r) => s + r.position.y, 0) / samples.length,
      };
      return { position: avgPosition, brightness: avgBrightness };
    },
    [videoRef],
  );

  const runAutoCalibration = useCallback(async () => {
    abortRef.current = false;
    const api = window.electronAPI;
    const markers = getMarkerPositions();
    const points: CalibrationPoint[] = [];

    // ── Step 1: Auto-adjust camera exposure ──
    // With an IR filter, ambient IR can saturate the sensor.
    // We lower the exposure until the blank screen reads below ~40.
    if (api?.sendToProjector) {
      api.sendToProjector({ type: 'blank' });
    }
    setAutoStatus('Adjusting camera exposure...');
    await sleep(800);

    const video = videoRef.current;
    const stream = video?.srcObject as MediaStream | null;
    const track = stream?.getVideoTracks()[0];

    if (track) {
      const caps = track.getCapabilities?.() as any;
      if (caps?.exposureTime && caps?.exposureMode) {
        const minExp = caps.exposureTime.min || 1;
        const maxExp = caps.exposureTime.max || 5000;
        let currentExp = maxExp * 0.1; // Start at 10%

        for (let attempt = 0; attempt < 8; attempt++) {
          try {
            await track.applyConstraints({
              advanced: [{ exposureMode: 'manual', exposureTime: currentExp } as any],
            } as any);
          } catch { /* ignore */ }

          await sleep(400); // Let camera settle

          const sample = await sampleBrightestPoint(4, 50);
          const brightness = sample?.brightness ?? 255;
          console.log(`[Calibration] Exposure adjust: exp=${Math.round(currentExp)}µs, brightness=${brightness}`);

          if (brightness < 40) {
            // Dark enough — the marker will stand out
            console.log(`[Calibration] Exposure locked at ${Math.round(currentExp)}µs`);
            // Save the working exposure for the shooting screen to reuse
            setCameraConfig({ exposure: Math.round(currentExp) });
            break;
          } else if (brightness > 200) {
            // Way too bright — halve the exposure
            currentExp = Math.max(minExp, currentExp * 0.3);
          } else if (brightness > 40) {
            // A bit too bright — reduce by 30%
            currentExp = Math.max(minExp, currentExp * 0.7);
          }

          if (currentExp <= minExp) {
            console.log('[Calibration] At minimum exposure, brightness still:', brightness);
            break;
          }
        }
      }
    }

    // ── Step 2: Measure blank-screen baseline brightness ──
    setAutoStatus('Measuring ambient brightness...');
    await sleep(600);

    // Sample the camera with a blank screen to get the noise floor
    const blankSample = await sampleBrightestPoint(8, 60);
    const blankBrightness = blankSample ? blankSample.brightness : 0;
    console.log('[Calibration] Blank screen brightness:', blankBrightness,
      blankSample ? `at (${Math.round(blankSample.position.x)}, ${Math.round(blankSample.position.y)})` : '');

    // The marker must be at least this much brighter than the blank screen.
    // Use a relative threshold: 50% brighter, with a minimum jump of 15.
    const minMarkerBrightness = blankBrightness + Math.max(15, blankBrightness * 0.5);
    console.log('[Calibration] Min marker brightness needed:', Math.round(minMarkerBrightness));
    setAutoStatus(`Baseline: ${Math.round(blankBrightness)}. Need >${Math.round(minMarkerBrightness)} for markers...`);
    await sleep(300);

    // ── Step 2: Detect each marker ──
    for (let i = 0; i < markers.length; i++) {
      if (abortRef.current) return;

      setCurrentMarker(i);
      setAutoStatus(`Projecting marker ${i + 1}/${markers.length}...`);

      // Show the marker
      showMarker(i);

      // Wait for the projector to display it and the camera to settle
      await sleep(600);

      if (abortRef.current) return;

      setAutoStatus(`Detecting marker ${i + 1}/${markers.length} in camera...`);

      // Sample the brightest point with the marker displayed
      const markerSample = await sampleBrightestPoint(6, 60);

      if (!markerSample) {
        setAutoStatus(`Failed to detect marker ${i + 1}. Camera may not be working.`);
        return;
      }

      // Verify the marker is significantly brighter than the blank screen
      if (markerSample.brightness < minMarkerBrightness) {
        console.log(`[Calibration] Marker ${i + 1} REJECTED: brightness=${Math.round(markerSample.brightness)}, ` +
          `needed=${Math.round(minMarkerBrightness)}, blank=${Math.round(blankBrightness)}`);
        setAutoStatus(
          `Marker ${i + 1} too dim (${Math.round(markerSample.brightness)} vs need ${Math.round(minMarkerBrightness)}). ` +
          `Camera can't see the projection.`
        );
        return;
      }

      console.log(`[Calibration] Marker ${i + 1} ACCEPTED: brightness=${Math.round(markerSample.brightness)}, ` +
        `pos=(${Math.round(markerSample.position.x)}, ${Math.round(markerSample.position.y)})`);

      points.push({ screen: markers[i], camera: markerSample.position });
      setCollectedPoints([...points]);

      // Brief blank between markers to reset the camera
      if (i < markers.length - 1 && api?.sendToProjector) {
        api.sendToProjector({ type: 'blank' });
        await sleep(300);
      }
    }

    if (abortRef.current) return;

    // Compute homography
    try {
      const profile = engineRef.current.computeHomography(points);
      setCalibrationProfile(profile);
      setAutoStatus('Calibration complete!');
      setStep('testing');

      // Reset the IR detector so the brightness baseline starts fresh
      // against the dark target instead of the bright calibration markers
      resetDetector();

      const { activeTarget, projectionConfig: proj } = useAppStore.getState();
      if (api?.sendToProjector) {
        api.sendToProjector({ type: 'show-target', target: activeTarget, projection: proj });
      }

      // Wait for the target to display and settle, then capture baseline
      // This is critical: the baseline subtraction eliminates the projected
      // target from detection, so only the laser flash is detected.
      // Switch to irTracking preset (Brightness=-48, Gain=20, Saturation=128).
      // This makes the projected target fall below TrackingThreshold=220 so only
      // the laser dot triggers detection during the testing phase.
      await switchPreset('irTracking');
      console.log('[Calibration] Switched to irTracking preset for testing');
      await sleep(800);

      // Set ROI so we only scan within the projected screen area
      const roi = engineRef.current.getCameraROI(
        cameraConfig.width,
        cameraConfig.height,
      );
      if (roi) {
        setROI(roi);
        console.log('[Calibration] ROI set:', roi);
      }

      // No baseline capture needed — absolute threshold algorithm is ready immediately
      console.log('[Calibration] Ready for shot testing');
    } catch (err) {
      console.error('Homography computation failed:', err);
      setAutoStatus('Calibration failed — try repositioning the camera.');
    }
  }, [getMarkerPositions, showMarker, sampleBrightestPoint, setCalibrationProfile]);

  const handleStartCalibration = async () => {
    const api = window.electronAPI;
    if (api?.openProjectorWindow) {
      const result = await api.openProjectorWindow(selectedDisplay);
      if (result) {
        setProjectionConfig({
          displayIndex: selectedDisplay,
          width: result.width,
          height: result.height,
        });
        setStep('projecting');
        setCurrentMarker(0);
        setCollectedPoints([]);
        // Give the projector window a moment to open, then start auto-calibration
        setTimeout(() => runAutoCalibration(), 1500);
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

    // Save calibration to disk via IPC
    const api = window.electronAPI;
    const profile = calibrationProfile;
    if (api?.dbSaveCalibration) {
      api.dbSaveCalibration(
        profile.id,
        profile.name,
        JSON.stringify(profile.homography),
        JSON.stringify(profile.calibrationPoints),
        profile.manualOffset.x,
        profile.manualOffset.y,
        profile.reprojectionError,
      );
      console.log('[Calibration] Saved to disk');
    }

    const { activeTarget, projectionConfig: proj } = useAppStore.getState();
    if (api?.sendToProjector) {
      api.sendToProjector({ type: 'show-target', target: activeTarget, projection: proj });
    }
    setTimeout(() => setScreen('shooting'), 1500);
  };

  const handleReset = () => {
    abortRef.current = true;
    setCollectedPoints([]);
    setCurrentMarker(0);
    setMappedPosition(null);
    setAutoStatus('');
    setStep('setup');
    engineRef.current = new CalibrationEngine({
      ...calibrationProfile,
      homography: [],
      calibrationPoints: [],
      manualOffset: { x: 0, y: 0 },
      reprojectionError: Infinity,
    });
  };

  const markerLabels = getMarkerPositions().map((_, i) => `P${i + 1}`);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center relative bg-tactical-darker">
      <video ref={videoRef} className="hidden" playsInline muted />
      <div className="absolute inset-0 tactical-grid opacity-50" />

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
          <h2 className="font-hud text-3xl text-tactical-orange text-glow-amber tracking-[0.2em]">CALIBRATION</h2>
          <div className="text-sm text-slate-500 font-tactical tracking-wider mt-1">
            {step === 'setup' && 'Select your projector display to begin'}
            {step === 'projecting' && 'Auto-calibrating — detecting projected markers...'}
            {step === 'testing' && 'Shoot at the target to verify mapping accuracy'}
            {step === 'adjusting' && 'Fine-tune the calibration offset'}
            {step === 'complete' && 'Calibration locked in'}
          </div>
        </motion.div>

        {/* Camera toggle */}
        <div className="flex items-center justify-center gap-4 mb-6">
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
                <p>4. Click begin — calibration runs automatically</p>
                <p>5. The system projects 4 markers and detects them in the camera</p>
              </div>
              <div className="mt-4">
                <div className="text-[10px] text-slate-500 font-mono uppercase tracking-wider mb-2">Projector Display</div>
                <div className="flex gap-2">
                  <select
                    value={selectedDisplay}
                    onChange={(e) => setSelectedDisplay(Number(e.target.value))}
                    className="flex-1 bg-tactical-darker border border-tactical-border rounded px-3 py-2 text-sm text-slate-300 font-mono focus:border-tactical-accent outline-none"
                  >
                    {displays.map((d, i) => (
                      <option key={d.id} value={i}>{d.label}</option>
                    ))}
                    {displays.length === 0 && <option value={0}>No displays detected</option>}
                  </select>
                  <button
                    onClick={refreshDisplays}
                    className="px-3 py-2 border border-tactical-border rounded text-sm text-slate-400 hover:text-tactical-accent hover:border-tactical-accent transition-colors font-mono"
                    title="Refresh displays"
                  >
                    ↻
                  </button>
                </div>
                <div className="text-[10px] text-slate-500 font-mono mt-1">
                  {displays.length} display(s) detected
                </div>
              </div>
            </div>
            <div className="text-center">
              <button className="btn-tactical btn-tactical-orange" onClick={handleStartCalibration} disabled={!isReady}>
                {isReady ? 'Open Projector & Begin' : 'Waiting for camera...'}
              </button>
            </div>
          </motion.div>
        )}

        {/* ─── PROJECTING (auto) ─── */}
        {step === 'projecting' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <div className="flex justify-center gap-2 flex-wrap max-w-md">
              {markerLabels.map((label, i) => (
                <div key={i} className="text-center">
                  <div className={`w-12 h-12 rounded-lg border-2 flex items-center justify-center font-hud transition-all ${
                    i < collectedPoints.length
                      ? 'border-tactical-green bg-tactical-green/10 text-tactical-green'
                      : i === currentMarker
                        ? 'border-tactical-orange bg-tactical-orange/10 text-tactical-orange animate-pulse'
                        : 'border-tactical-border text-slate-600'
                  }`}>
                    {i < collectedPoints.length ? <span className="text-lg">✓</span> : <span className="text-sm">{i + 1}</span>}
                  </div>
                  <div className="text-[8px] text-slate-500 font-mono mt-1">{label}</div>
                </div>
              ))}
            </div>
            <div className="text-center text-slate-400 text-sm font-tactical">
              {autoStatus || 'Starting automatic calibration...'}
            </div>
            <div className="text-center">
              <button className="btn-tactical text-xs" onClick={handleReset}>Cancel</button>
            </div>
          </motion.div>
        )}

        {/* ─── TESTING ─── */}
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
                Shoot at the projected target. The hit should appear where you aimed.
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
                <div className="text-xs text-slate-600 italic">No IR signal detected</div>
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
            onClick={() => { abortRef.current = true; window.electronAPI?.closeProjectorWindow(); setScreen('main-menu'); }}
          >
            ← Back to Menu
          </button>
        </div>
      </div>
    </div>
  );
}
