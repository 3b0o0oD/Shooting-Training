import type { Point2D, DetectionConfig } from '../types';

export interface DetectionResult {
  position: Point2D | null;
  brightness: number;
  baseline: number;
  shotDetected: boolean;
  timestamp: number;
}

/**
 * IR Detection Engine
 *
 * Processes camera frames to detect IR light spots and shot events.
 * Supports three detection modes:
 * - flash: Detects sudden brightness spikes (IR gun pulse)
 * - dwell: Detects stationary IR point held for a duration
 * - hybrid: Combines both methods
 */
export class IRDetector {
  private config: DetectionConfig;
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;

  // Brightness history for flash detection
  private brightnessHistory: number[] = [];
  private readonly historyLength = 30; // ~1 second at 30fps
  private baselineBrightness = 0;

  // Dwell detection state
  private dwellStartTime = 0;
  private dwellPosition: Point2D | null = null;

  // Shot cooldown to prevent double-triggers
  private lastShotTime = 0;
  private readonly shotCooldown = 500; // ms

  constructor(config: DetectionConfig, width: number, height: number) {
    this.config = config;
    this.canvas = new OffscreenCanvas(width, height);
    this.ctx = this.canvas.getContext('2d', {
      willReadFrequently: true,
    })! as OffscreenCanvasRenderingContext2D;
  }

  updateConfig(config: Partial<DetectionConfig>) {
    this.config = { ...this.config, ...config };
  }

  /**
   * Process a video frame and return detection results.
   */
  processFrame(videoElement: HTMLVideoElement): DetectionResult {
    const now = performance.now();
    const { width, height } = this.canvas;

    // Draw the video frame to our processing canvas
    this.ctx.drawImage(videoElement, 0, 0, width, height);
    const imageData = this.ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // Find the brightest point (convert to grayscale)
    let maxBrightness = 0;
    let maxX = 0;
    let maxY = 0;

    // Simple box blur approximation by sampling every Nth pixel first,
    // then refining around the brightest area
    const step = 2; // Sample every 2nd pixel for speed
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const i = (y * width + x) * 4;
        // Weighted grayscale - IR shows up strongest in red channel
        const brightness = data[i] * 0.5 + data[i + 1] * 0.3 + data[i + 2] * 0.2;
        if (brightness > maxBrightness) {
          maxBrightness = brightness;
          maxX = x;
          maxY = y;
        }
      }
    }

    // Refine around the brightest area (±step pixels)
    const refineRange = step * 2;
    for (
      let y = Math.max(0, maxY - refineRange);
      y < Math.min(height, maxY + refineRange);
      y++
    ) {
      for (
        let x = Math.max(0, maxX - refineRange);
        x < Math.min(width, maxX + refineRange);
        x++
      ) {
        const i = (y * width + x) * 4;
        const brightness = data[i] * 0.5 + data[i + 1] * 0.3 + data[i + 2] * 0.2;
        if (brightness > maxBrightness) {
          maxBrightness = brightness;
          maxX = x;
          maxY = y;
        }
      }
    }

    const position: Point2D | null =
      maxBrightness > this.config.minBrightness ? { x: maxX, y: maxY } : null;

    // Update brightness history
    this.brightnessHistory.push(maxBrightness);
    if (this.brightnessHistory.length > this.historyLength) {
      this.brightnessHistory.shift();
    }

    // Calculate baseline (average of history, excluding spikes)
    if (this.brightnessHistory.length >= 5) {
      const sorted = [...this.brightnessHistory].sort((a, b) => a - b);
      // Use median-ish value (exclude top 20%)
      const cutoff = Math.floor(sorted.length * 0.8);
      const baseline = sorted.slice(0, cutoff);
      this.baselineBrightness =
        baseline.reduce((a, b) => a + b, 0) / baseline.length;
    }

    // Detect shot based on mode
    let shotDetected = false;

    if (now - this.lastShotTime > this.shotCooldown && position) {
      if (
        this.config.mode === 'flash' ||
        this.config.mode === 'hybrid'
      ) {
        shotDetected = this.detectFlash(maxBrightness);
      }

      if (
        !shotDetected &&
        (this.config.mode === 'dwell' || this.config.mode === 'hybrid')
      ) {
        shotDetected = this.detectDwell(position, now);
      }
    }

    if (shotDetected) {
      this.lastShotTime = now;
    }

    return {
      position,
      brightness: maxBrightness,
      baseline: this.baselineBrightness,
      shotDetected,
      timestamp: now,
    };
  }

  /**
   * Flash detection: brightness spike well above baseline
   */
  private detectFlash(currentBrightness: number): boolean {
    if (this.brightnessHistory.length < 5) return false;

    const threshold =
      this.baselineBrightness * this.config.flashSpikeMultiplier;

    return (
      currentBrightness > this.config.brightnessThreshold &&
      currentBrightness > threshold &&
      currentBrightness > this.baselineBrightness + 50
    );
  }

  /**
   * Dwell detection: IR point stays within a small radius for dwellTime ms
   */
  private detectDwell(position: Point2D, now: number): boolean {
    if (!this.dwellPosition) {
      this.dwellPosition = position;
      this.dwellStartTime = now;
      return false;
    }

    const dx = position.x - this.dwellPosition.x;
    const dy = position.y - this.dwellPosition.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > this.config.dwellRadius) {
      // Moved too far, reset
      this.dwellPosition = position;
      this.dwellStartTime = now;
      return false;
    }

    // Check if we've dwelled long enough
    if (now - this.dwellStartTime >= this.config.dwellTime) {
      this.dwellPosition = null; // Reset after detection
      return true;
    }

    return false;
  }

  /**
   * Get the current baseline brightness for UI display
   */
  getBaseline(): number {
    return this.baselineBrightness;
  }

  /**
   * Reset detection state
   */
  reset() {
    this.brightnessHistory = [];
    this.baselineBrightness = 0;
    this.dwellPosition = null;
    this.dwellStartTime = 0;
    this.lastShotTime = 0;
  }
}
