import { useRef, useEffect, useCallback, useState } from 'react';
import type { Point2D } from '../types';

export interface DetectorStatus {
  connected: boolean;
  fps: number;
  peakDiff: number;
  rawPeak: number;
  noiseFloor: number;
  threshold: number;
  hasBaseline: boolean;
}

export interface ShotEvent {
  screenX: number;
  screenY: number;
  cameraX: number;
  cameraY: number;
  peakDiff: number;
}

/**
 * Hook that connects to the Python detection service via WebSocket.
 * Replaces the browser-based camera + IRDetector + useDetectionLoop.
 */
export function useDetector(
  onShot: (shot: ShotEvent) => void,
  isActive: boolean,
  port = 8765,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<DetectorStatus>({
    connected: false, fps: 0, peakDiff: 0, rawPeak: 0,
    noiseFloor: 0, threshold: 0, hasBaseline: false,
  });
  const onShotRef = useRef(onShot);
  onShotRef.current = onShot;

  // Connect to Python service
  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[detector] Connected to Python service');
      setStatus(s => ({ ...s, connected: true }));
    };

    ws.onclose = () => {
      console.log('[detector] Disconnected from Python service');
      setStatus(s => ({ ...s, connected: false }));
      // Auto-reconnect after 2 seconds
      setTimeout(() => {
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
      }, 2000);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'frame' && data.shot_detected) {
        onShotRef.current({
          screenX: data.screen_x,
          screenY: data.screen_y,
          cameraX: data.camera_x,
          cameraY: data.camera_y,
          peakDiff: data.peak_diff,
        });
      }

      if (data.type === 'status') {
        setStatus(s => ({
          ...s,
          fps: data.fps,
          peakDiff: data.peak_diff,
          rawPeak: data.raw_peak,
          noiseFloor: data.noise_floor,
          threshold: data.threshold,
          hasBaseline: data.has_baseline,
        }));
      }
    };

    return () => {
      ws.close();
    };
  }, [port]);

  const send = useCallback((cmd: string, params: Record<string, any> = {}) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ cmd, ...params }));
    }
  }, []);

  const openCamera = useCallback((cameraIndex = 0, width = 640, height = 480, fps = 60) => {
    send('open_camera', { camera_index: cameraIndex, width, height, fps });
  }, [send]);

  const setPreset = useCallback((preset: 'calibration' | 'tracking') => {
    send('set_preset', { preset });
  }, [send]);

  const setExposure = useCallback((value: number) => {
    send('set_exposure', { value });
  }, [send]);

  const autoAdjustExposure = useCallback((targetBrightness = 40) => {
    send('auto_adjust_exposure', { target_brightness: targetBrightness });
  }, [send]);

  const captureBaseline = useCallback(() => {
    send('capture_baseline');
  }, [send]);

  const setHomography = useCallback((matrix: number[]) => {
    send('set_homography', { matrix });
  }, [send]);

  const setROI = useCallback((roi: { x: number; y: number; w: number; h: number }) => {
    send('set_roi', roi);
  }, [send]);

  const startDetection = useCallback(() => {
    send('start_detection');
  }, [send]);

  const stopDetection = useCallback(() => {
    send('stop_detection');
  }, [send]);

  const getBrightest = useCallback((): Promise<{ x: number; y: number; brightness: number }> => {
    return new Promise((resolve) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        resolve({ x: 0, y: 0, brightness: 0 });
        return;
      }

      const handler = (event: MessageEvent) => {
        const data = JSON.parse(event.data);
        if (data.type === 'brightest') {
          ws.removeEventListener('message', handler);
          resolve({ x: data.x, y: data.y, brightness: data.brightness });
        }
      };
      ws.addEventListener('message', handler);
      send('get_brightest');

      // Timeout
      setTimeout(() => {
        ws.removeEventListener('message', handler);
        resolve({ x: 0, y: 0, brightness: 0 });
      }, 1000);
    });
  }, [send]);

  const setMode = useCallback((mode: 'instant' | 'recoil') => {
    send('set_mode', { mode });
  }, [send]);

  return {
    status,
    openCamera,
    setPreset,
    setExposure,
    autoAdjustExposure,
    captureBaseline,
    setHomography,
    setROI,
    startDetection,
    stopDetection,
    getBrightest,
    setMode,
  };
}
