import { useRef, useEffect, useCallback } from 'react';
import { IRDetector, type DetectionResult } from '../engine/IRDetector';
import type { DetectionConfig } from '../types';

/**
 * Hook that runs the IR detection loop on each animation frame.
 */
export function useDetectionLoop(
  videoElement: HTMLVideoElement | null,
  config: DetectionConfig,
  isActive: boolean,
  onFrame: (result: DetectionResult) => void
) {
  const detectorRef = useRef<IRDetector | null>(null);
  const rafRef = useRef<number>(0);

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

  const loop = useCallback(() => {
    if (!isActive || !videoElement || !detectorRef.current) return;

    if (videoElement.readyState >= videoElement.HAVE_CURRENT_DATA) {
      const result = detectorRef.current.processFrame(videoElement);
      onFrame(result);
    }

    rafRef.current = requestAnimationFrame(loop);
  }, [isActive, videoElement, onFrame]);

  useEffect(() => {
    if (isActive && videoElement) {
      rafRef.current = requestAnimationFrame(loop);
    }
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [isActive, videoElement, loop]);

  const reset = useCallback(() => {
    detectorRef.current?.reset();
  }, []);

  return { reset };
}
