import { useRef, useEffect } from 'react';
import type { TargetConfig, ProjectionConfig, Shot, Point2D } from '../../types';
import { drawTargetOnCanvas } from '../../utils/targetRenderer';

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

    const scaleX = displayWidth / projection.width;
    const scaleY = displayHeight / projection.height;

    ctx.fillStyle = '#080502';
    ctx.fillRect(0, 0, displayWidth, displayHeight);

    drawTarget(ctx, target, projection, displayWidth, displayHeight, scaleX, scaleY);
    drawTrace(ctx, currentTrace, scaleX, scaleY);
    drawShots(ctx, shots, scaleX, scaleY, projection.hitMarkerSize);
    if (irPosition) drawCrosshair(ctx, irPosition, scaleX, scaleY);
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
  scaleY: number,
) {
  const shortSide = Math.min(projection.width, projection.height);
  const targetRadiusProj = (shortSide * projection.targetSizePercent) / 200;
  const cx = (projection.width / 2 + projection.targetOffset.x) * scaleX;
  const cy = (projection.height / 2 + projection.targetOffset.y) * scaleY;
  const targetRadius = targetRadiusProj * Math.min(scaleX, scaleY);

  drawTargetOnCanvas(ctx, target, cx, cy, targetRadius);

  // Dashed crosshair overlay on the control screen to mark centre
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.moveTo(cx, 0); ctx.lineTo(cx, displayHeight);
  ctx.moveTo(0, cy); ctx.lineTo(displayWidth, cy);
  ctx.stroke();
  ctx.setLineDash([]);
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

  ctx.strokeStyle = 'rgba(200, 163, 90, 0.85)';
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
  ctx.fillStyle = 'rgba(200, 163, 90, 0.9)';
  ctx.fill();
}
