import { useRef, useEffect, useCallback } from 'react';
import { IRDetector, type DetectionResult } from '../engine/IRDetector';
import type { DetectionConfig } from '../types';

/**
 * Hook that runs the IR detection loop using a tight setTimeout loop.
 *
 * Uses setTimeout instead of requestAnimationFrame because rAF is:
 * - Capped at the display refresh rate (60fps)
 * - Throttled to ~1fps when the window is not visible/focused
 *
 * With setTimeout(loop, 8) we poll at ~120Hz, ensuring we catch every
 * new camera frame as soon as it arrives. The camera at 60fps produces
 * a new frame every ~16ms, so polling at 8ms means we never miss one.
 */
export function useDetectionLoop(
  videoElement: HTMLVideoElement | null,
  config: DetectionConfig,
  isActive: boolean,
  onFrame: (result: DetectionResult) => void
) {
  const detectorRef = useRef<IRDetector | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(isActive);
  const onFrameRef = useRef(onFrame);

  // Keep refs in sync so the loop closure always sees latest values
  activeRef.current = isActive;
  onFrameRef.current = onFrame;

  // Initialize or update detector
  useEffect(() => {
    if (videoElement && videoElement.videoWidth > 0) {
      detectorRef.current = new IRDetector(
        config,
        videoElement.videoWidth,
        videoElement.videoHeight
      );
    }
  }, [videoElement, videoElement?.videoWidth, videoElement?.videoHeight]);

  // Update config without recreating detector
  useEffect(() => {
    detectorRef.current?.updateConfig(config);
  }, [config]);

  // Detection loop
  useEffect(() => {
    if (!isActive || !videoElement) return;

    let running = true;

    const loop = () => {
      if (!running || !activeRef.current || !videoElement || !detectorRef.current) return;

      if (videoElement.readyState >= videoElement.HAVE_CURRENT_DATA) {
        const result = detectorRef.current.processFrame(videoElement);
        onFrameRef.current(result);
      }

      // Poll at ~120Hz to catch every camera frame ASAP
      if (running) {
        timerRef.current = setTimeout(loop, 8);
      }
    };

    timerRef.current = setTimeout(loop, 0);

    return () => {
      running = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isActive, videoElement]);

  const reset = useCallback(() => {
    detectorRef.current?.reset();
  }, []);

  const captureBaseline = useCallback(() => {
    detectorRef.current?.startBaselineCapture();
  }, []);

  const hasBaseline = useCallback(() => {
    return detectorRef.current?.hasBaseline() ?? false;
  }, []);

  const setROI = useCallback((roi: { x: number; y: number; w: number; h: number } | null) => {
    detectorRef.current?.setROI(roi);
  }, []);

  return { reset, captureBaseline, hasBaseline, setROI };
}
