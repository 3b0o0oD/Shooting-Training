import { useEffect, useState, useRef, useCallback } from 'react';
import type { TargetConfig, ProjectionConfig, Point2D } from '../types';

interface ProjectorState {
  mode: 'blank' | 'target' | 'calibration';
  target?: TargetConfig;
  projection?: ProjectionConfig;
  calibrationMarker?: { position: Point2D; markerIndex: number };
  liveCursor?: Point2D | null;
  hits: Array<{ position: Point2D; score: number; id: number; hitMarkerSize: number }>;
}

export function ProjectorView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<ProjectorState>({ mode: 'blank', hits: [] });
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
          stateRef.current = { ...s, hits: [...s.hits, { position: data.position, score: data.score, id: ++hitIdRef.current, hitMarkerSize: data.hitMarkerSize ?? 12 }] };
          break;
        case 'clear':
          stateRef.current = { ...s, hits: [], liveCursor: null };
          break;
        case 'blank':
          stateRef.current = { mode: 'blank', hits: [] };
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

function drawTarget(ctx: CanvasRenderingContext2D, target: TargetConfig, projection: ProjectionConfig, screenW: number, screenH: number) {
  const shortSide = Math.min(screenW, screenH);
  const targetRadius = (shortSide * projection.targetSizePercent) / 200;
  const cx = screenW / 2 + projection.targetOffset.x;
  const cy = screenH / 2 + projection.targetOffset.y;

  // IR-safe target: all colors are kept very dark so the camera (with its
  // red/IR-pass filter) sees the target as near-black. Only the IR gun flash
  // will register as a bright spot. We use blue/cyan tones for visual
  // contrast on the projector — these are invisible through the red filter.
  const rings = [...target.scoringRings].reverse();
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i];
    const radius = ring.radiusPercent * targetRadius;
    const isEven = i % 2 === 0;

    if (ring.score <= 3) {
      // Outer rings: dark blue-gray alternating
      ctx.fillStyle = isEven ? '#0a1628' : '#0d1e35';
    } else if (ring.score <= 6) {
      // Mid rings: darker blue-gray
      ctx.fillStyle = isEven ? '#081220' : '#0a1628';
    } else if (ring.score <= 9) {
      // Inner rings: very dark
      ctx.fillStyle = isEven ? '#060e1a' : '#081220';
    } else {
      // Bullseye (10): dark blue — NOT red, to avoid IR false triggers
      ctx.fillStyle = '#001a44';
    }

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // Ring borders: dim blue lines (invisible through red filter)
    ctx.strokeStyle = 'rgba(0, 100, 200, 0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Score labels: dim blue text
    if (ring.score >= 1 && ring.score <= 9) {
      ctx.fillStyle = 'rgba(0, 120, 220, 0.5)';
      ctx.font = `${Math.max(12, targetRadius * 0.06)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(ring.score), cx, cy - radius + targetRadius * 0.04);
    }
  }

  // Center dot: dim blue
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(2, targetRadius * 0.01), 0, Math.PI * 2);
  ctx.fillStyle = '#003388';
  ctx.fill();
}

function drawHits(ctx: CanvasRenderingContext2D, hits: Array<{ position: Point2D; score: number; id: number; hitMarkerSize: number }>) {
  hits.forEach((hit, index) => {
    const { x, y } = hit.position;
    const radius = hit.hitMarkerSize;

    // Use blue/cyan tones for hit markers — invisible through the red IR filter
    // so they won't cause false detections. Brightness varies by score.
    const lightness = 30 + (hit.score / 10) * 30; // 30-60% lightness, still dim
    const color = `hsl(210, 100%, ${lightness}%)`;

    // Subtle glow
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius * 3);
    gradient.addColorStop(0, `hsla(210, 100%, ${lightness}%, 0.3)`);
    gradient.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(x, y, radius * 3, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    // Hit dot
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Shot number
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.max(10, radius)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), x, y);
  });
}

function drawLiveCursor(ctx: CanvasRenderingContext2D, position: Point2D) {
  const { x, y } = position;
  const size = 20;

  // Blue glow — invisible through red IR filter
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, size * 2);
  gradient.addColorStop(0, 'rgba(0, 100, 255, 0.4)');
  gradient.addColorStop(1, 'transparent');
  ctx.beginPath();
  ctx.arc(x, y, size * 2, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  // Blue crosshair
  ctx.strokeStyle = '#0066ff';
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
  ctx.fillStyle = '#0066ff';
  ctx.fill();
}

function drawCalibrationMarker(ctx: CanvasRenderingContext2D, position: Point2D, markerIndex: number, screenW: number, screenH: number) {
  const { x, y } = position;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, screenW, screenH);

  // Marker sized to be clearly visible to the camera through the IR filter.
  // Needs to be large enough to produce a clear brightness difference.
  const size = Math.max(60, Math.min(screenW, screenH) * 0.05);

  // Bright glow halo
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, size * 2);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
  gradient.addColorStop(0.4, 'rgba(255, 200, 200, 0.3)');
  gradient.addColorStop(1, 'transparent');
  ctx.beginPath();
  ctx.arc(x, y, size * 2, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  // Solid bright white circle — main marker
  ctx.beginPath();
  ctx.arc(x, y, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // Red ring (visible through IR filter)
  ctx.beginPath();
  ctx.arc(x, y, size / 2 + 6, 0, Math.PI * 2);
  ctx.strokeStyle = '#ff3333';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Red crosshair lines
  ctx.strokeStyle = '#ff3333';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y + size);
  ctx.stroke();

  // Text labels — these are for the human eye on the projector screen,
  // the camera doesn't need to read them
  ctx.fillStyle = '#ff6666';
  ctx.font = '20px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`Point ${markerIndex + 1}`, x, y + size + 30);

  ctx.fillStyle = '#888888';
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'center';
}
