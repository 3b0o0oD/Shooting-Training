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

  const rings = [...target.scoringRings].reverse();
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i];
    const radius = ring.radiusPercent * targetRadius;
    const isEven = i % 2 === 0;

    if (ring.score <= 3) ctx.fillStyle = isEven ? '#ffffff' : '#e8e8e8';
    else if (ring.score <= 6) ctx.fillStyle = isEven ? '#222222' : '#333333';
    else if (ring.score <= 9) ctx.fillStyle = isEven ? '#1a1a1a' : '#2a2a2a';
    else ctx.fillStyle = target.bullseyeColor || '#ff2d55';

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (ring.score >= 1 && ring.score <= 9) {
      ctx.fillStyle = ring.score <= 3 ? '#000000' : '#ffffff';
      ctx.font = `${Math.max(12, targetRadius * 0.06)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(ring.score), cx, cy - radius + targetRadius * 0.04);
    }
  }

  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(2, targetRadius * 0.01), 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

function drawHits(ctx: CanvasRenderingContext2D, hits: Array<{ position: Point2D; score: number; id: number; hitMarkerSize: number }>) {
  hits.forEach((hit, index) => {
    const { x, y } = hit.position;
    const radius = hit.hitMarkerSize;
    const hue = (hit.score / 10) * 120;
    const color = `hsl(${hue}, 100%, 50%)`;

    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius * 3);
    gradient.addColorStop(0, `hsla(${hue}, 100%, 50%, 0.4)`);
    gradient.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(x, y, radius * 3, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#000';
    ctx.font = `bold ${Math.max(10, radius)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), x, y);
  });
}

function drawLiveCursor(ctx: CanvasRenderingContext2D, position: Point2D) {
  const { x, y } = position;
  const size = 20;

  // Glow
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, size * 2);
  gradient.addColorStop(0, 'rgba(0, 240, 255, 0.4)');
  gradient.addColorStop(1, 'transparent');
  ctx.beginPath();
  ctx.arc(x, y, size * 2, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  // Crosshair
  ctx.strokeStyle = '#00f0ff';
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
  ctx.fillStyle = '#00f0ff';
  ctx.fill();
}

function drawCalibrationMarker(ctx: CanvasRenderingContext2D, position: Point2D, markerIndex: number, screenW: number, screenH: number) {
  const { x, y } = position;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, screenW, screenH);

  const size = 40;
  const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'];
  const color = colors[markerIndex % colors.length];

  ctx.beginPath();
  ctx.arc(x, y, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, size / 2 + 4, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y + size);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = '16px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`Point ${markerIndex + 1} of 4`, x, y + size + 24);

  ctx.fillStyle = '#666666';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Aim your IR gun at this marker and fire', screenW / 2, screenH - 40);
}
