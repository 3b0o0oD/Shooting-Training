import { useEffect, useState, useRef, useCallback } from 'react';
import type { TargetConfig, ProjectionConfig, Point2D } from '../types';
import { drawTargetOnCanvas } from '../utils/targetRenderer';

interface SpeedDrillTarget {
  id: number;
  position: Point2D;
  radius: number;
  spawnTime: number;
  hit: boolean;
  missed: boolean;
}

interface ProjectorState {
  mode: 'blank' | 'target' | 'calibration' | 'speed-drill';
  target?: TargetConfig;
  projection?: ProjectionConfig;
  calibrationMarker?: { position: Point2D; markerIndex: number };
  liveCursor?: Point2D | null;
  hits: Array<{ position: Point2D; score: number; id: number; hitMarkerSize: number; time: number }>;
  drillTargets: SpeedDrillTarget[];
}

export function ProjectorView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<ProjectorState>({ mode: 'blank', hits: [], drillTargets: [] });
  const [, setRenderTick] = useState(0);
  const hitIdRef = useRef(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onProjectorMessage) return;

    const cleanup = api.onProjectorMessage((data: any) => {
      const s = stateRef.current;
      switch (data.type) {
        case 'show-target':
          stateRef.current = { ...s, mode: 'target', target: data.target, projection: data.projection, hits: [], liveCursor: null };
          break;
        case 'show-calibration-marker':
          if (data.markerIndex === 99) {
            // Live cursor during test mode — overlay on current view
            stateRef.current = { ...s, liveCursor: data.position };
          } else {
            stateRef.current = { ...s, mode: 'calibration', calibrationMarker: { position: data.position, markerIndex: data.markerIndex }, liveCursor: null };
          }
          break;
        case 'show-hit':
          stateRef.current = { ...s, hits: [...s.hits, { position: data.position, score: data.score, id: ++hitIdRef.current, hitMarkerSize: data.hitMarkerSize ?? 12, time: Date.now() }] };
          break;
        case 'clear':
          stateRef.current = { ...s, hits: [], liveCursor: null };
          break;
        case 'blank':
          stateRef.current = { mode: 'blank', hits: [], drillTargets: [] };
          break;
        case 'speed-drill-target':
          stateRef.current = {
            ...s,
            mode: 'speed-drill',
            drillTargets: [...s.drillTargets, {
              id: data.id,
              position: data.position,
              radius: data.radius,
              spawnTime: Date.now(),
              hit: false,
              missed: false,
            }],
          };
          break;
        case 'speed-drill-hit': {
          const targets = s.drillTargets.map(t =>
            t.id === data.targetId ? { ...t, hit: true } : t
          );
          stateRef.current = { ...s, drillTargets: targets };
          break;
        }
        case 'speed-drill-miss': {
          const targets = s.drillTargets.map(t =>
            t.id === data.targetId ? { ...t, missed: true } : t
          );
          stateRef.current = { ...s, drillTargets: targets };
          break;
        }
        case 'speed-drill-clear':
          stateRef.current = { ...s, drillTargets: [] };
          break;
      }
      setRenderTick((t) => t + 1);
    });

    return cleanup;
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const state = stateRef.current;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    if (state.mode === 'target' && state.target && state.projection) {
      drawTarget(ctx, state.target, state.projection, w, h);
      drawHits(ctx, state.hits);
      if (state.liveCursor) {
        drawLiveCursor(ctx, state.liveCursor);
      }
    } else if (state.mode === 'calibration' && state.calibrationMarker) {
      drawCalibrationMarker(ctx, state.calibrationMarker.position, state.calibrationMarker.markerIndex, w, h);
    } else if (state.mode === 'speed-drill') {
      drawSpeedDrillTargets(ctx, state.drillTargets, w, h);
    }

    rafRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-screen h-screen"
      style={{ cursor: 'none', background: '#000' }}
    />
  );
}

// With Camera Brightness=-48, projected pixel values are reduced by ~48 in the camera feed.
// White (255) → camera reads ~207, below TrackingThreshold=220. All colors are safe.
// Only the laser dot (a focused coherent light source, far brighter than any projection)
// exceeds the threshold. This matches how the original Laser Ammo app works.

function drawTarget(ctx: CanvasRenderingContext2D, target: TargetConfig, projection: ProjectionConfig, screenW: number, screenH: number) {
  const shortSide = Math.min(screenW, screenH);
  const targetRadius = (shortSide * projection.targetSizePercent) / 200;
  const cx = screenW / 2 + projection.targetOffset.x;
  const cy = screenH / 2 + projection.targetOffset.y;
  drawTargetOnCanvas(ctx, target, cx, cy, targetRadius);
}

function drawHits(ctx: CanvasRenderingContext2D, hits: Array<{ position: Point2D; score: number; id: number; hitMarkerSize: number; time: number }>) {
  const now = Date.now();
  const FADE_MS = 1500;

  for (let i = hits.length - 1; i >= 0; i--) {
    const hit = hits[i];
    const age = now - hit.time;
    if (age > FADE_MS) continue;

    const { x, y } = hit.position;
    const r = hit.hitMarkerSize;
    const alpha = Math.max(0, 1 - age / FADE_MS);
    const hue = (hit.score / 10) * 120; // red (low) → green (high)

    // Outer glow
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 2.5);
    grad.addColorStop(0, `hsla(${hue}, 100%, 50%, ${alpha * 0.5})`);
    grad.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(x, y, r * 2.5, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Bullet hole
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha * 0.9})`;
    ctx.fill();
    ctx.strokeStyle = `hsla(${hue}, 100%, 60%, ${alpha})`;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Score text
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.9})`;
    ctx.font = `bold ${Math.max(10, r)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(hit.score), x, y);
  }

  while (hits.length > 0 && now - hits[0].time > FADE_MS + 200) {
    hits.shift();
  }
}

function drawLiveCursor(ctx: CanvasRenderingContext2D, position: Point2D) {
  const { x, y } = position;
  const size = 20;

  const gradient = ctx.createRadialGradient(x, y, 0, x, y, size * 2);
  gradient.addColorStop(0, 'rgba(0, 160, 255, 0.5)');
  gradient.addColorStop(1, 'transparent');
  ctx.beginPath();
  ctx.arc(x, y, size * 2, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.strokeStyle = '#00aaff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x - 5, y);
  ctx.moveTo(x + 5, y);
  ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y - 5);
  ctx.moveTo(x, y + 5);
  ctx.lineTo(x, y + size);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#00aaff';
  ctx.fill();
}

function drawCalibrationMarker(ctx: CanvasRenderingContext2D, position: Point2D, markerIndex: number, screenW: number, screenH: number) {
  const { x, y } = position;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, screenW, screenH);

  const size = Math.max(60, Math.min(screenW, screenH) * 0.05);

  // Glow halo
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, size * 2);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
  gradient.addColorStop(0.4, 'rgba(255, 200, 200, 0.3)');
  gradient.addColorStop(1, 'transparent');
  ctx.beginPath();
  ctx.arc(x, y, size * 2, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  // Solid white circle — main marker for camera detection
  ctx.beginPath();
  ctx.arc(x, y, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // Red ring and crosshair
  ctx.beginPath();
  ctx.arc(x, y, size / 2 + 6, 0, Math.PI * 2);
  ctx.strokeStyle = '#ff3333';
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.strokeStyle = '#ff3333';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y + size);
  ctx.stroke();

  ctx.fillStyle = '#ff6666';
  ctx.font = '20px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`Point ${markerIndex + 1}`, x, y + size + 30);
}

function drawSpeedDrillTargets(ctx: CanvasRenderingContext2D, targets: SpeedDrillTarget[], screenW: number, screenH: number) {
  const now = Date.now();

  for (const t of targets) {
    const { x, y } = t.position;
    const r = t.radius;
    const age = now - t.spawnTime;

    if (t.hit) {
      const alpha = Math.max(0, 1 - age / 400);
      if (alpha <= 0) continue;
      // Green flash on hit
      ctx.beginPath();
      ctx.arc(x, y, r * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 200, 80, ${alpha * 0.6})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(0, 255, 100, ${alpha})`;
      ctx.lineWidth = 3;
      ctx.stroke();
      continue;
    }

    if (t.missed) {
      const alpha = Math.max(0, 1 - age / 600);
      if (alpha <= 0) continue;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 60, 60, ${alpha * 0.7})`;
      ctx.lineWidth = 3;
      ctx.stroke();
      continue;
    }

    // Active target — white fill with colored ring, clearly visible
    const lifetime = 2000;
    const progress = Math.min(1, age / lifetime);
    const pulse = 1 + Math.sin(age / 150) * 0.06;

    // White filled circle
    ctx.beginPath();
    ctx.arc(x, y, r * pulse, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Orange border ring
    ctx.strokeStyle = `rgba(255, 140, 0, 0.9)`;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Black center dot
    ctx.beginPath();
    ctx.arc(x, y, r * 0.15, 0, Math.PI * 2);
    ctx.fillStyle = '#000000';
    ctx.fill();

    // Timer arc — red as time runs out
    const remaining = 1 - progress;
    const timerHue = remaining * 120; // green → red
    ctx.beginPath();
    ctx.arc(x, y, r * pulse + 6, -Math.PI / 2, -Math.PI / 2 + remaining * Math.PI * 2);
    ctx.strokeStyle = `hsl(${timerHue}, 100%, 50%)`;
    ctx.lineWidth = 4;
    ctx.stroke();
  }
}
