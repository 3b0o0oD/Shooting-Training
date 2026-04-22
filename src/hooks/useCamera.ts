import { useRef, useEffect, useCallback, useState } from 'react';
import type { CameraConfig, CameraDevice } from '../types';

/**
 * Hook for managing webcam access via WebRTC
 */
export function useCamera(config: CameraConfig) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);

  // Enumerate available cameras
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

  // Start the camera stream
  const startCamera = useCallback(async () => {
    try {
      // Stop any existing stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: config.deviceId ? { exact: config.deviceId } : undefined,
          width: { ideal: config.width },
          height: { ideal: config.height },
          frameRate: { ideal: 30 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsReady(true);
        setError(null);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to access camera';
      setError(message);
      setIsReady(false);
    }
  }, [config.deviceId, config.width, config.height]);

  // Stop the camera
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

  // Auto-start on mount, cleanup on unmount
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
  };
}
