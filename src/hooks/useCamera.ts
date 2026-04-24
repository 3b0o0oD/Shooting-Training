import { useRef, useEffect, useCallback, useState } from 'react';
import type { CameraConfig, CameraDevice } from '../types';

/**
 * Camera parameter presets matching the Smokeless Range channel system.
 * 
 * Channel 0 = Calibration: bright enough to see projected dots
 * Channel 3 = IR Tracking: dark image, only laser visible
 * 
 * The key trick: tracking mode intentionally makes the projector image
 * nearly invisible (brightness=-48, contrast=0, gain=20) so that ONLY
 * the laser stands out above the threshold.
 */

export function useCamera(config: CameraConfig) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);

  const enumerateDevices = useCallback(async () => {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = allDevices
        .filter((d) => d.kind === 'videoinput')
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${d.deviceId.slice(0, 8)}`,
          resolution: { width: config.width, height: config.height },
        }));
      setDevices(videoDevices);
      return videoDevices;
    } catch (err) {
      setError('Failed to enumerate camera devices');
      return [];
    }
  }, [config.width, config.height]);

  const startCamera = useCallback(async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: config.deviceId ? { exact: config.deviceId } : undefined,
          width: { ideal: config.width },
          height: { ideal: config.height },
          frameRate: { ideal: 60, min: 30 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      // Start in calibration mode
      await applyCameraPreset(stream, 'calibration');

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsReady(true);
        setError(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to access camera';
      setError(message);
      setIsReady(false);
    }
  }, [config.deviceId, config.width, config.height]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsReady(false);
  }, []);

  /**
   * Switch camera between calibration and tracking modes.
   */
  const switchPreset = useCallback(async (preset: 'calibration' | 'irTracking') => {
    if (streamRef.current) {
      await applyCameraPreset(streamRef.current, preset);
    }
  }, []);

  /**
   * Set camera exposure for tracking mode.
   * Uses a fixed exposure that matches what worked during calibration testing.
   * The projector flicker makes auto-adjustment unreliable, so we pick
   * a known-good exposure level (~80µs for this camera) and let baseline
   * subtraction handle the rest.
   */
  const autoAdjustTrackingExposure = useCallback(async (
    sampleFn: () => Promise<number>,
  ): Promise<number> => {
    const stream = streamRef.current;
    if (!stream) return 0;
    const track = stream.getVideoTracks()[0];
    if (!track) return 0;
    const caps = track.getCapabilities?.() as any;
    if (!caps?.exposureTime) return 0;

    const brightnessVal = caps?.brightness ? Math.round(caps.brightness.min * 0.5) : -32;

    // Strategy: start high and step down until we find an exposure where
    // the rawPeak is in the 100-200 range. Take the FIRST one that works
    // (don't keep iterating — the flicker causes oscillation).
    const testExposures = [500, 300, 200, 150, 100, 80, 60, 40];

    for (const exp of testExposures) {
      try {
        await track.applyConstraints({
          advanced: [{
            exposureMode: 'manual',
            exposureTime: exp,
            brightness: brightnessVal,
          } as any],
        } as any);
      } catch { /* ignore */ }

      // Wait for camera to settle and take multiple samples
      await new Promise(r => setTimeout(r, 500));
      let maxPeak = 0;
      for (let s = 0; s < 5; s++) {
        const p = await sampleFn();
        if (p > maxPeak) maxPeak = p;
        await new Promise(r => setTimeout(r, 80));
      }
      console.log(`[camera] Tracking test: exp=${exp}µs, maxPeak=${Math.round(maxPeak)}`);

      // Accept the first exposure where the peak is in a usable range
      // (not saturated, but bright enough for the laser to stand out)
      if (maxPeak >= 100 && maxPeak <= 220) {
        console.log(`[camera] Tracking locked: exp=${exp}µs (maxPeak=${Math.round(maxPeak)})`);
        return exp;
      }
    }

    // Fallback: use 80µs which worked in calibration testing
    const fallback = 80;
    try {
      await track.applyConstraints({
        advanced: [{
          exposureMode: 'manual',
          exposureTime: fallback,
          brightness: brightnessVal,
        } as any],
      } as any);
    } catch { /* ignore */ }
    console.log(`[camera] Tracking fallback: exp=${fallback}µs`);
    return fallback;
  }, []);

  useEffect(() => {
    enumerateDevices().then(() => startCamera());
    return () => stopCamera();
  }, [config.deviceId]);

  return {
    videoRef,
    isReady,
    error,
    devices,
    startCamera,
    stopCamera,
    enumerateDevices,
    switchPreset,
    autoAdjustTrackingExposure,
  };
}

/**
 * Apply camera parameters for a given mode.
 */
async function applyCameraPreset(
  stream: MediaStream,
  presetName: 'calibration' | 'irTracking',
) {
  const track = stream.getVideoTracks()[0];
  if (!track) return;

  const caps = track.getCapabilities?.() as any;
  if (!caps) return;

  const settings: any = {};

  // Always lock exposure to manual
  if (caps.exposureMode) settings.exposureMode = 'manual';

  if (presetName === 'calibration') {
    // Channel 0: Bright enough to see projected calibration dots
    if (caps.brightness) settings.brightness = mapRange(0, -64, 64, caps.brightness);
    if (caps.contrast) settings.contrast = mapRange(32, 0, 64, caps.contrast);
    if (caps.saturation) settings.saturation = mapRange(0, 0, 128, caps.saturation);
    if (caps.exposureTime) {
      // Start at 10% — will be auto-adjusted by calibration routine
      settings.exposureTime = Math.round(caps.exposureTime.max * 0.1);
    }
  } else {
    // Channel 3 (IR Tracking): suppress projector with brightness, keep exposure HIGH
    // brightness = minimum: darkens the projector image digitally
    // contrast = 0: flat, no enhancement
    // saturation = max: makes laser color pop
    // exposure = HIGH: captures brief laser flashes
    if (caps.brightness) settings.brightness = Math.round(caps.brightness.min * 0.5); // -32 on a -64..64 range
    if (caps.contrast) settings.contrast = mapRange(0, 0, 64, caps.contrast);
    if (caps.saturation) settings.saturation = mapRange(128, 0, 128, caps.saturation);
    if (caps.exposureTime) {
      // HIGH exposure — will be fine-tuned by autoAdjustTrackingExposure
      settings.exposureTime = Math.round(caps.exposureTime.max * 0.8);
    }
  }

  // Common settings
  if (caps.sharpness) settings.sharpness = caps.sharpness.min || 0;
  if (caps.whiteBalanceMode) settings.whiteBalanceMode = 'manual';
  if (caps.colorTemperature) settings.colorTemperature = 6500;

  try {
    await track.applyConstraints({ advanced: [settings] } as any);
    console.log(`[camera] Switched to ${presetName}:`, settings);
  } catch (e) {
    console.log(`[camera] Could not apply ${presetName}:`, e);
  }
}

/**
 * Map a value from the original system's range to the camera's actual range.
 */
function mapRange(
  value: number,
  srcMin: number,
  srcMax: number,
  capRange: { min: number; max: number },
): number {
  const normalized = (value - srcMin) / (srcMax - srcMin); // 0..1
  return Math.round(capRange.min + (capRange.max - capRange.min) * normalized);
}
