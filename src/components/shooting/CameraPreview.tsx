import { useRef, useEffect } from 'react';
import type { Point2D } from '../../types';

interface CameraPreviewProps {
  videoElement: HTMLVideoElement | null;
  irPosition: Point2D | null;
  brightness: number;
  baseline: number;
  threshold: number;
  isVisible: boolean;
  onClose: () => void;
}

/**
 * Draggable camera feed preview with IR detection overlay.
 * Shows what the camera sees with the detected IR point highlighted.
 */
export function CameraPreview({
  videoElement,
  irPosition,
  brightness,
  baseline,
  threshold,
  isVisible,
  onClose,
}: CameraPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const dragRef = useRef({ isDragging: false, startX: 0, startY: 0 });
  const posRef = useRef({ x: 16, y: 80 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isVisible || !videoElement || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      if (!videoElement || videoElement.readyState < videoElement.HAVE_CURRENT_DATA) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const vw = videoElement.videoWidth || 320;
      const vh = videoElement.videoHeight || 240;

      // Canvas size matches the preview container
      const displayW = canvas.clientWidth;
      const displayH = canvas.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = displayW * dpr;
      canvas.height = displayH * dpr;
      ctx.scale(dpr, dpr);

      // Draw the camera feed
      ctx.drawImage(videoElement, 0, 0, displayW, displayH);

      const scaleX = displayW / vw;
      const scaleY = displayH / vh;

      // Draw IR detection point
      if (irPosition) {
        // Note: irPosition here is in camera coordinates (before homography)
        const x = irPosition.x * scaleX;
        const y = irPosition.y * scaleY;

        // Glow
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, 20);
        gradient.addColorStop(0, 'rgba(200, 163, 90, 0.6)');
        gradient.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(x, y, 20, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        // Crosshair
        ctx.strokeStyle = '#c8a35a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - 12, y);
        ctx.lineTo(x - 4, y);
        ctx.moveTo(x + 4, y);
        ctx.lineTo(x + 12, y);
        ctx.moveTo(x, y - 12);
        ctx.lineTo(x, y - 4);
        ctx.moveTo(x, y + 4);
        ctx.lineTo(x, y + 12);
        ctx.stroke();

        // Center dot
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#c8a35a';
        ctx.fill();

        // Coordinates label
        ctx.fillStyle = '#c8a35a';
        ctx.font = '10px monospace';
        ctx.fillText(`${Math.round(irPosition.x)}, ${Math.round(irPosition.y)}`, x + 14, y - 6);
      }

      // Brightness bar at bottom
      const barH = 4;
      const barY = displayH - barH - 2;

      // Background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, barY - 1, displayW, barH + 2);

      // Threshold line
      const threshX = (threshold / 255) * displayW;
      ctx.strokeStyle = 'rgba(217, 119, 6, 0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(threshX, barY - 1);
      ctx.lineTo(threshX, barY + barH + 1);
      ctx.stroke();

      // Baseline
      const baseX = (baseline / 255) * displayW;
      ctx.strokeStyle = 'rgba(200, 163, 90, 0.5)';
      ctx.beginPath();
      ctx.moveTo(baseX, barY - 1);
      ctx.lineTo(baseX, barY + barH + 1);
      ctx.stroke();

      // Current brightness
      const brightW = (brightness / 255) * displayW;
      const brightColor =
        brightness > threshold ? '#dc3232' : brightness > baseline ? '#d97706' : '#c8a35a';
      ctx.fillStyle = brightColor;
      ctx.fillRect(0, barY, brightW, barH);

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isVisible, videoElement, irPosition, brightness, baseline, threshold]);

  // Drag handling
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-close]')) return;
    dragRef.current = { isDragging: true, startX: e.clientX - posRef.current.x, startY: e.clientY - posRef.current.y };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current.isDragging || !containerRef.current) return;
      posRef.current = {
        x: e.clientX - dragRef.current.startX,
        y: e.clientY - dragRef.current.startY,
      };
      containerRef.current.style.left = `${posRef.current.x}px`;
      containerRef.current.style.top = `${posRef.current.y}px`;
    };
    const handleMouseUp = () => {
      dragRef.current.isDragging = false;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  if (!isVisible) return null;

  return (
    <div
      ref={containerRef}
      className="absolute z-50 cursor-move"
      style={{ left: posRef.current.x, top: posRef.current.y }}
      onMouseDown={handleMouseDown}
    >
      <div className="hud-border rounded overflow-hidden" style={{ width: 320, height: 240 + 28 }}>
        {/* Title bar */}
        <div className="flex items-center justify-between px-2 py-1 bg-tactical-darker/90 border-b border-tactical-border">
          <span className="text-[9px] text-slate-500 font-mono uppercase tracking-wider">
            Camera Feed
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-mono" style={{ color: brightness > threshold ? '#dc3232' : '#c8a35a' }}>
              {Math.round(brightness)}
            </span>
            <button
              data-close
              onClick={onClose}
              className="text-slate-500 hover:text-slate-300 text-xs leading-none"
            >
              ✕
            </button>
          </div>
        </div>
        {/* Canvas */}
        <canvas ref={canvasRef} style={{ width: 320, height: 240, display: 'block' }} />
      </div>
    </div>
  );
}
