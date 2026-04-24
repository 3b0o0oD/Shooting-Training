import { useEffect, useState, useRef, useCallback } from 'react';
import type { TargetConfig, ProjectionConfig, Point2D } from '../types';

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

// Maximum safe projected brightness for detection.
// Camera Brightness=-48 (DirectShow additive offset) reduces pixel values by ~48.
// To stay below TrackingThreshold=220 even if camera darkening only partially applies:
//   safe_max = 220 - 48 = 172 (conservative). We cap at 160 for margin.
// The hot pixel system catches any static bright area that slips through.
const MAX_SAFE_BRIGHTNESS = 160;

function drawTarget(ctx: CanvasRenderingContext2D, target: TargetConfig, projection: ProjectionConfig, screenW: number, screenH: number) {
  const shortSide = Math.min(screenW, screenH);
  const targetRadius = (shortSide * projection.targetSizePercent) / 200;
  const cx = screenW / 2 + projection.targetOffset.x;
  const cy = screenH / 2 + projection.targetOffset.y;

  // All colors kept below MAX_SAFE_BRIGHTNESS (160) so the camera with Brightness=-48
  // sees them well below TrackingThreshold=220 even with partial camera-settings failure.
  const rings = [...target.scoringRings].reverse();
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i];
    const radius = ring.radiusPercent * targetRadius;

    // Outer rings (score 1-4): light gray — NOT white. White (255) risks false positives.
    // Inner rings (5-9): dark gray — safely below threshold.
    // Bullseye (10): dark maroon — red channel 140, well below 220 after camera darkening.
    if (ring.score <= 3) {
      ctx.fillStyle = '#a0a0a0';     // 160 — max safe brightness
    } else if (ring.score <= 4) {
      ctx.fillStyle = '#888888';     // 136 — safe
    } else if (ring.score <= 6) {
      ctx.fillStyle = '#1a1a1a';     // 26 — safe
    } else if (ring.score <= 8) {
      ctx.fillStyle = '#222222';     // 34 — safe
    } else if (ring.score <= 9) {
      ctx.fillStyle = '#111111';     // 17 — safe
    } else {
      ctx.fillStyle = '#8c0000';     // R=140 — safe
    }

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // Ring borders — thin, low-brightness lines only
    ctx.strokeStyle = ring.score <= 4 ? 'rgba(0,0,0,0.5)' : 'rgba(100,100,100,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Score labels — dark on light rings, dim on dark rings. Never white.
    if (ring.score >= 1 && ring.score <= 9) {
      ctx.fillStyle = ring.score <= 4 ? '#222222' : '#555555'; // max 85 — safe
      ctx.font = `bold ${Math.max(12, targetRadius * 0.07)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(ring.score), cx, cy - radius + targetRadius * 0.05);
    }
  }

  // Center aiming point — thin dark crosshair, not white
  const xSize = Math.max(3, targetRadius * 0.015);
  ctx.strokeStyle = '#666666'; // 102 — safe
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - xSize, cy - xSize);
  ctx.lineTo(cx + xSize, cy + xSize);
  ctx.moveTo(cx + xSize, cy - xSize);
  ctx.lineTo(cx - xSize, cy + xSize);
  ctx.stroke();
}

function drawHits(ctx: CanvasRenderingContext2D, hits: Array<{ position: Point2D; score: number; id: number; hitMarkerSize: number; time: number }>) {
  const now = Date.now();
  // Short fade — the less time a hit marker sits on the projector, the less
  // chance it interferes with subsequent shot detection.
  const FADE_MS = 1500;

  for (let i = hits.length - 1; i >= 0; i--) {
    const hit = hits[i];
    const age = now - hit.time;
    if (age > FADE_MS) continue;

    const { x, y } = hit.position;
    const r = hit.hitMarkerSize;
    const alpha = Math.max(0, 1 - age / FADE_MS);

    // Detection-safe hit marker design:
    // All bright values are kept below MAX_SAFE_BRIGHTNESS (160).
    // No large glow — glow radiates a wide bright area that the camera picks up.
    // No white text — white on dark background = 255, unsafe.
    // Just a dark bullet hole with a dim colored border: clean and readable.

    // Very small dim rim glow — radius * 1.3 only, not radius * 3
    const grad = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 1.3);
    grad.addColorStop(0, `rgba(120, 30, 30, ${alpha * 0.4})`);  // R=120 — safe
    grad.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(x, y, r * 1.3, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Bullet hole — dark fill, dim border
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(15, 15, 15, ${alpha * 0.95})`; // near-black — safe
    ctx.fill();
    ctx.strokeStyle = `rgba(140, 50, 50, ${alpha})`; // R=140 — safe
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Score text — dark gray, not white. Stays below threshold.
    ctx.fillStyle = `rgba(100, 100, 100, ${alpha * 0.8})`; // 100 — safe
    ctx.font = `bold ${Math.max(9, r * 0.9)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(hit.score), x, y);
  }

  // Clean up expired hits
  while (hits.length > 0 && now - hits[0].time > FADE_MS + 200) {
    hits.shift();
  }
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

function drawSpeedDrillTargets(ctx: CanvasRenderingContext2D, targets: SpeedDrillTarget[], screenW: number, screenH: number) {
  const now = Date.now();

  for (const t of targets) {
    const { x, y } = t.position;
    const r = t.radius;
    const age = now - t.spawnTime;

    if (t.hit) {
      // Hit — quick dark flash, no bright colors
      const alpha = Math.max(0, 1 - age / 400);
      if (alpha <= 0) continue;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(15, 15, 15, ${alpha * 0.9})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(60, 60, 140, ${alpha * 0.8})`; // dim blue, B=140 safe
      ctx.lineWidth = 2;
      ctx.stroke();
      continue;
    }

    if (t.missed) {
      const alpha = Math.max(0, 1 - age / 600);
      if (alpha <= 0) continue;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(80, 20, 20, ${alpha * 0.5})`; // R=80 safe
      ctx.lineWidth = 2;
      ctx.stroke();
      continue;
    }

    // Active target — all channel values kept below MAX_SAFE_BRIGHTNESS (160)
    const lifetime = 2000;
    const progress = Math.min(1, age / lifetime);
    const pulse = 1 + Math.sin(age / 150) * 0.08;

    // Outer ring only — no bright fill
    ctx.beginPath();
    ctx.arc(x, y, r * pulse, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(0, 80, 140, ${0.5 + progress * 0.3})`; // B=140 safe
    ctx.lineWidth = 2;
    ctx.stroke();

    // Inner dot — dark
    ctx.beginPath();
    ctx.arc(x, y, r * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 40, 80, 0.6)`; // B=80 safe
    ctx.fill();

    // Timer arc
    const remaining = 1 - progress;
    ctx.beginPath();
    ctx.arc(x, y, r + 3, -Math.PI / 2, -Math.PI / 2 + remaining * Math.PI * 2);
    ctx.strokeStyle = `rgba(0, 100, 140, ${0.5 + progress * 0.3})`; // B=140 safe
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}
