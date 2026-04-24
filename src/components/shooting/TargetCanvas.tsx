import { useRef, useEffect } from 'react';
import type { TargetConfig, ProjectionConfig, Shot, Point2D } from '../../types';

interface TargetCanvasProps {
  target: TargetConfig;
  projection: ProjectionConfig;
  shots: Shot[];
  currentTrace: Point2D[];
  irPosition: Point2D | null;
}

/**
 * Canvas component that mirrors the projected target on the control screen.
 * All coordinates are in projector screen space — we scale them to fit
 * the control window's display area.
 */
export function TargetCanvas({
  target,
  projection,
  shots,
  currentTrace,
  irPosition,
}: TargetCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const displayWidth = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;
    canvas.width = displayWidth * dpr;
    canvas.height = displayHeight * dpr;
    ctx.scale(dpr, dpr);

    // Scale from projector coordinates to our display
    const scaleX = displayWidth / projection.width;
    const scaleY = displayHeight / projection.height;

    // Clear
    ctx.fillStyle = '#000202ff';
    ctx.fillRect(0, 0, displayWidth, displayHeight);

    // Draw target rings (same layout as projector)
    drawTarget(ctx, target, projection, displayWidth, displayHeight, scaleX, scaleY);

    // Draw current aiming trace
    drawTrace(ctx, currentTrace, scaleX, scaleY);

    // Draw previous shots
    drawShots(ctx, shots, scaleX, scaleY, projection.hitMarkerSize);

    // Draw current IR position crosshair
    if (irPosition) {
      drawCrosshair(ctx, irPosition, scaleX, scaleY);
    }
  }, [target, projection, shots, currentTrace, irPosition]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ imageRendering: 'auto' }}
    />
  );
}

function drawTarget(
  ctx: CanvasRenderingContext2D,
  target: TargetConfig,
  projection: ProjectionConfig,
  displayWidth: number,
  displayHeight: number,
  scaleX: number,
  scaleY: number
) {
  // Target center and radius in projector coords, then scaled to display
  const shortSide = Math.min(projection.width, projection.height);
  const targetRadiusProj = (shortSide * projection.targetSizePercent) / 200;

  const cx = (projection.width / 2 + projection.targetOffset.x) * scaleX;
  const cy = (projection.height / 2 + projection.targetOffset.y) * scaleY;
  const scale = Math.min(scaleX, scaleY);
  const targetRadius = targetRadiusProj * scale;

  // Draw rings from outside in
  const rings = [...target.scoringRings].reverse();
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i];
    const radius = ring.radiusPercent * targetRadius;

    // Ring fill — subtle dark theme
    if (ring.score <= 3) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.08)';
    } else if (ring.score <= 6) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(0,240,255,0.06)' : 'rgba(0,240,255,0.03)';
    } else if (ring.score <= 9) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(0,240,255,0.08)' : 'rgba(0,240,255,0.05)';
    } else {
      ctx.fillStyle = 'rgba(255, 45, 85, 0.2)';
    }

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // Ring border
    ctx.strokeStyle = `rgba(0, 240, 255, ${0.08 + ring.score * 0.015})`;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Score label
    if (ring.score >= 3 && ring.score <= 10) {
      ctx.fillStyle = `rgba(0, 240, 255, ${0.2 + ring.score * 0.03})`;
      ctx.font = `${Math.max(9, targetRadius * 0.05)}px Rajdhani`;
      ctx.textAlign = 'center';
      ctx.fillText(String(ring.score), cx, cy - radius + targetRadius * 0.04);
    }
  }

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(2, targetRadius * 0.012), 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 240, 255, 0.6)';
  ctx.fill();

  // Crosshair through center
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, displayHeight);
  ctx.moveTo(0, cy);
  ctx.lineTo(displayWidth, cy);
  ctx.stroke();
}

function drawTrace(
  ctx: CanvasRenderingContext2D,
  trace: Point2D[],
  scaleX: number,
  scaleY: number
) {
  if (trace.length < 2) return;

  for (let i = 1; i < trace.length; i++) {
    const progress = i / trace.length;
    const alpha = 0.1 + progress * 0.7;
    const r = Math.floor(255 * (1 - progress));
    const g = Math.floor(255 * progress);

    ctx.beginPath();
    ctx.moveTo(trace[i - 1].x * scaleX, trace[i - 1].y * scaleY);
    ctx.lineTo(trace[i].x * scaleX, trace[i].y * scaleY);
    ctx.strokeStyle = `rgba(${r}, ${g}, 50, ${alpha})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawShots(
  ctx: CanvasRenderingContext2D,
  shots: Shot[],
  scaleX: number,
  scaleY: number,
  hitMarkerSize: number
) {
  const scale = Math.min(scaleX, scaleY);
  shots.forEach((shot, index) => {
    const x = shot.screenPosition.x * scaleX;
    const y = shot.screenPosition.y * scaleY;
    const radius = hitMarkerSize * scale;

    const hue = (shot.score / 10) * 120;
    const color = `hsl(${hue}, 100%, 50%)`;

    // Outer glow
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius * 3);
    gradient.addColorStop(0, `hsla(${hue}, 100%, 50%, 0.3)`);
    gradient.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(x, y, radius * 3, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    // Shot circle
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Shot number
    ctx.fillStyle = '#000';
    ctx.font = 'bold 10px Rajdhani';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), x, y);
  });
}

function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  position: Point2D,
  scaleX: number,
  scaleY: number
) {
  const x = position.x * scaleX;
  const y = position.y * scaleY;
  const size = 15;

  ctx.strokeStyle = 'rgba(255, 45, 85, 0.8)';
  ctx.lineWidth = 1.5;

  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x - 4, y);
  ctx.moveTo(x + 4, y);
  ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y - 4);
  ctx.moveTo(x, y + 4);
  ctx.lineTo(x, y + size);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y, 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 45, 85, 0.9)';
  ctx.fill();
}
