import type { Point2D, DetectionConfig } from '../types';

export interface DetectionResult {
  position: Point2D | null;
  brightness: number;
  baseline: number;
  shotDetected: boolean;
  timestamp: number;
}

/**
 * IR / Laser Detection Engine
 *
 * Based on the standard laser shooting simulator approach:
 * 1. Capture a baseline frame of the projected scene (no laser)
 * 2. On each frame, subtract the baseline → only the laser flash remains
 * 3. Threshold the difference image to find bright blobs
 * 4. Find the centroid of the brightest blob → that's the hit position
 *
 * This eliminates false positives from the projected target image itself,
 * regardless of target colors or projector brightness.
 */
export class IRDetector {
  private config: DetectionConfig;

  // Processing canvas — downscaled for speed
  private readonly processWidth: number;
  private readonly processHeight: number;
  private readonly scaleX: number;
  private readonly scaleY: number;
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;

  // Baseline frame (brightness values at processing resolution)
  private baseline: Uint8Array | null = null;
  private baselineAccumulator: number[][] | null = null;
  private baselineFrameCount = 0;
  private readonly baselineFramesNeeded = 30;
  private isCapturingBaseline = false;

  // Rolling baseline brightness for UI display
  private baselineBrightness = 0;

  // Screen fluctuation noise floor — measured during calibration.
  // The laser must produce a difference above this to register.
  private noiseFloor = 0;

  // Brightness history for adaptive thresholding
  private peakHistory: number[] = [];
  private readonly historyLength = 20;

  // Shot cooldown
  private lastShotTime = 0;
  private readonly shotCooldown = 250; // ms — laser pulse spans ~3-6 frames at 30fps

  // Track the current flash across frames to pick the peak
  private flashStartTime = 0;
  private flashPeakBrightness = 0;
  private flashPeakPosition: Point2D | null = null;
  private inFlash = false;

  // Logging
  private frameCount = 0;
  private lastLogTime = 0;

  // Hot pixel rejection: mask out persistent bright spots with expiry.
  private hotPixelMask: Map<number, number> = new Map(); // index -> timestamp
  private hotPixelCandidates: Map<string, number> = new Map();
  private readonly hotPixelRadius = 5;
  private readonly hotPixelFrames = 20;
  private readonly hotPixelExpiry = 15000; // ms — masks expire after 15 seconds

  // Region of Interest — only scan within the projected screen area
  // Stored in processing-resolution coordinates
  private roi: { x: number; y: number; w: number; h: number } | null = null;

  constructor(config: DetectionConfig, width: number, height: number) {
    this.config = config;

    // Downscale to ~480p for processing speed
    const maxDim = 480;
    if (height > maxDim) {
      const scale = maxDim / height;
      this.processWidth = Math.round(width * scale);
      this.processHeight = maxDim;
    } else {
      this.processWidth = width;
      this.processHeight = height;
    }
    this.scaleX = width / this.processWidth;
    this.scaleY = height / this.processHeight;

    this.canvas = new OffscreenCanvas(this.processWidth, this.processHeight);
    this.ctx = this.canvas.getContext('2d', {
      willReadFrequently: true,
    })! as OffscreenCanvasRenderingContext2D;
  }

  updateConfig(config: Partial<DetectionConfig>) {
    this.config = { ...this.config, ...config };
  }

  /**
   * Set the Region of Interest in original camera coordinates.
   * Only pixels within this region will be scanned for laser hits.
   * This eliminates false detections from outside the projected screen area.
   */
  setROI(roi: { x: number; y: number; w: number; h: number } | null) {
    if (roi) {
      // Scale to processing resolution
      this.roi = {
        x: Math.floor(roi.x / this.scaleX),
        y: Math.floor(roi.y / this.scaleY),
        w: Math.ceil(roi.w / this.scaleX),
        h: Math.ceil(roi.h / this.scaleY),
      };
      console.log('[IRDetector] ROI set (process coords):', this.roi);
    } else {
      this.roi = null;
    }
  }

  /**
   * Start capturing baseline frames. Call this after the target is displayed
   * and the scene has settled (~500ms). The baseline is built from the average
   * of several frames to reduce noise.
   */
  startBaselineCapture() {
    this.isCapturingBaseline = true;
    this.baselineAccumulator = null;
    this.baselineFrameCount = 0;
    this.baseline = null;
  }

  /**
   * Check if a valid baseline exists.
   */
  hasBaseline(): boolean {
    return this.baseline !== null;
  }

  /**
   * Process a video frame and return detection results.
   */
  processFrame(videoElement: HTMLVideoElement): DetectionResult {
    const now = performance.now();
    const w = this.processWidth;
    const h = this.processHeight;
    const pixelCount = w * h;

    // Draw downscaled frame
    this.ctx.drawImage(videoElement, 0, 0, w, h);
    const { data } = this.ctx.getImageData(0, 0, w, h);

    // Extract brightness per pixel — use max of all channels.
    // IR can show up in any channel depending on the camera sensor and filter.
    const bright = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      const idx = i * 4;
      bright[i] = Math.max(data[idx], data[idx + 1], data[idx + 2]);
    }

    // ── Baseline capture mode ──
    if (this.isCapturingBaseline) {
      if (!this.baselineAccumulator) {
        this.baselineAccumulator = Array.from({ length: pixelCount }, () => []);
      }
      for (let i = 0; i < pixelCount; i++) {
        this.baselineAccumulator[i].push(bright[i]);
      }
      this.baselineFrameCount++;

      if (this.baselineFrameCount >= this.baselineFramesNeeded) {
        // Compute baseline as the average of captured frames,
        // excluding frames that had brightness spikes (stray laser hits).
        const pixCount = this.baselineAccumulator.length;
        const frameCount = this.baselineAccumulator[0].length;

        // Find frames with spikes: compute per-frame max brightness
        const frameMaxes: number[] = [];
        for (let f = 0; f < frameCount; f++) {
          let fMax = 0;
          // Sample every 100th pixel for speed
          for (let p = 0; p < pixCount; p += 100) {
            if (this.baselineAccumulator[p][f] > fMax) fMax = this.baselineAccumulator[p][f];
          }
          frameMaxes.push(fMax);
        }

        // Exclude frames where max brightness is > median + 30
        const sortedMaxes = [...frameMaxes].sort((a, b) => a - b);
        const medianMax = sortedMaxes[Math.floor(sortedMaxes.length / 2)];
        const spikeThreshold = medianMax + 30;
        const goodFrames = frameMaxes.map((m, i) => m <= spikeThreshold ? i : -1).filter(i => i >= 0);

        if (goodFrames.length < 5) {
          // Not enough good frames — use all of them
          goodFrames.length = 0;
          for (let f = 0; f < frameCount; f++) goodFrames.push(f);
        }

        console.log(`[IRDetector] Baseline: ${goodFrames.length}/${frameCount} frames used (excluded ${frameCount - goodFrames.length} spike frames)`);

        this.baseline = new Uint8Array(pixCount);
        let maxStdDev = 0;

        for (let i = 0; i < pixCount; i++) {
          let sum = 0;
          for (const f of goodFrames) sum += this.baselineAccumulator[i][f];
          const avg = sum / goodFrames.length;
          this.baseline[i] = Math.round(avg);

          // Compute std dev for noise floor
          let variance = 0;
          for (const f of goodFrames) variance += (this.baselineAccumulator[i][f] - avg) ** 2;
          variance /= goodFrames.length;
          const stdDev = Math.sqrt(variance);
          if (stdDev > maxStdDev) maxStdDev = stdDev;
        }

        // Noise floor capped at 20 to prevent projector flicker from blocking detection
        this.noiseFloor = Math.min(20, Math.ceil(maxStdDev * 2));

        this.baselineAccumulator = null;
        this.isCapturingBaseline = false;
        console.log('[IRDetector] Baseline captured. Noise floor:', this.noiseFloor);
      }

      return {
        position: null,
        brightness: 0,
        baseline: 0,
        shotDetected: false,
        timestamp: now,
      };
    }

    // ── Detection mode ──

    // Determine scan bounds (ROI or full frame)
    const scanX0 = this.roi ? Math.max(0, this.roi.x) : 0;
    const scanY0 = this.roi ? Math.max(0, this.roi.y) : 0;
    const scanX1 = this.roi ? Math.min(w, this.roi.x + this.roi.w) : w;
    const scanY1 = this.roi ? Math.min(h, this.roi.y + this.roi.h) : h;

    // Log raw peak brightness (before baseline subtraction) every 2 seconds
    // to see if the flash appears in the raw image at all
    let rawPeak = 0;
    for (let y = scanY0; y < scanY1; y += 3) {
      for (let x = scanX0; x < scanX1; x += 3) {
        if (bright[y * w + x] > rawPeak) rawPeak = bright[y * w + x];
      }
    }

    // Compute difference from baseline (or use raw if no baseline)
    // Only within the ROI for efficiency
    const diff = new Uint8Array(pixelCount);
    if (this.baseline) {
      for (let y = scanY0; y < scanY1; y++) {
        for (let x = scanX0; x < scanX1; x++) {
          const i = y * w + x;
          const d = bright[i] - this.baseline[i];
          diff[i] = d > 0 ? d : 0;
        }
      }
    } else {
      for (let y = scanY0; y < scanY1; y++) {
        for (let x = scanX0; x < scanX1; x++) {
          const i = y * w + x;
          diff[i] = bright[i];
        }
      }
    }

    // Find the peak difference pixel within ROI
    let maxDiff = 0;
    let maxX = 0;
    let maxY = 0;

    for (let y = scanY0; y < scanY1; y++) {
      for (let x = scanX0; x < scanX1; x++) {
        const d = diff[y * w + x];
        if (d > maxDiff) {
          maxDiff = d;
          maxX = x;
          maxY = y;
        }
      }
    }

    // Compute average baseline brightness for UI
    if (this.baseline) {
      let sum = 0;
      for (let i = 0; i < pixelCount; i += 10) {
        sum += this.baseline[i];
      }
      this.baselineBrightness = sum / (pixelCount / 10);
    }

    // ── Hot pixel masking with expiry ──
    const mask = this.hotPixelRadius + 2;

    // Remove expired hot pixels
    for (const [idx, timestamp] of this.hotPixelMask) {
      if (now - timestamp > this.hotPixelExpiry) {
        this.hotPixelMask.delete(idx);
      }
    }

    // Zero out active hot pixels
    for (const [idx] of this.hotPixelMask) {
      const hpy = Math.floor(idx / w);
      const hpx = idx % w;
      for (let y = Math.max(scanY0, hpy - mask); y <= Math.min(scanY1 - 1, hpy + mask); y++) {
        for (let x = Math.max(scanX0, hpx - mask); x <= Math.min(scanX1 - 1, hpx + mask); x++) {
          diff[y * w + x] = 0;
        }
      }
    }

    // Re-find the peak after masking hot pixels
    maxDiff = 0;
    maxX = 0;
    maxY = 0;
    for (let y = scanY0; y < scanY1; y++) {
      for (let x = scanX0; x < scanX1; x++) {
        const d = diff[y * w + x];
        if (d > maxDiff) { maxDiff = d; maxX = x; maxY = y; }
      }
    }

    // Track the current peak as a potential hot pixel candidate
    if (maxDiff > 0) {
      const key = `${maxX},${maxY}`;
      let matched = false;
      // Check if this peak is near an existing candidate
      for (const [k, count] of this.hotPixelCandidates) {
        const [cx, cy] = k.split(',').map(Number);
        const dist = Math.sqrt((maxX - cx) ** 2 + (maxY - cy) ** 2);
        if (dist < this.hotPixelRadius) {
          const newCount = count + 1;
          this.hotPixelCandidates.set(k, newCount);
          if (newCount >= this.hotPixelFrames) {
            // Confirmed hot pixel — add to permanent mask
            this.hotPixelMask.set(cy * w + cx, now);
            this.hotPixelCandidates.delete(k);
            console.log(`[IRDetector] Hot pixel confirmed at (${cx},${cy}), total masked: ${this.hotPixelMask.size}`);
          }
          matched = true;
          break;
        }
      }
      if (!matched) {
        this.hotPixelCandidates.set(key, 1);
        // Limit candidates to prevent memory growth
        if (this.hotPixelCandidates.size > 50) {
          const first = this.hotPixelCandidates.keys().next().value;
          if (first) this.hotPixelCandidates.delete(first);
        }
      }
    }

    // ── Thresholds ──
    const effectiveThreshold = Math.max(this.config.brightnessThreshold, this.noiseFloor);
    const minB = Math.max(this.config.minBrightness, this.noiseFloor);

    // Periodic logging
    this.frameCount++;
    if (now - this.lastLogTime > 2000) {
      console.log(`[IRDetector] frame=${this.frameCount} rawPeak=${rawPeak} peakDiff=${maxDiff} noiseFloor=${this.noiseFloor} threshold=${effectiveThreshold} hasBaseline=${!!this.baseline} hotPixels=${this.hotPixelMask.size}`);
      this.lastLogTime = now;
      this.frameCount = 0;
    }

    // Log spikes above the effective threshold
    if (maxDiff > effectiveThreshold) {
      console.log(`[IRDetector] SPIKE: diff=${maxDiff} at (${maxX},${maxY}) threshold=${effectiveThreshold}`);
    }

    // ── Blob analysis ──
    let centroidX = maxX;
    let centroidY = maxY;
    let blobArea = 0;
    let position: Point2D | null = null;

    if (maxDiff > minB) {
      // Centroid of bright region around the peak
      const cr = 15;
      let sx = 0, sy = 0, sw = 0;
      let area = 0;

      for (let y = Math.max(0, maxY - cr); y <= Math.min(h - 1, maxY + cr); y++) {
        for (let x = Math.max(0, maxX - cr); x <= Math.min(w - 1, maxX + cr); x++) {
          const d = diff[y * w + x];
          if (d > minB) {
            sx += x * d;
            sy += y * d;
            sw += d;
            area++;
          }
        }
      }

      if (sw > 0) {
        centroidX = sx / sw;
        centroidY = sy / sw;
        blobArea = area;
      }

      // Filter by blob size: laser dot is 2-80 pixels at 480p,
      // but with hand movement it can streak to 500+ pixels
      if (blobArea >= 1 && blobArea <= 500) {
        position = {
          x: centroidX * this.scaleX,
          y: centroidY * this.scaleY,
        };
      }
    }

    // ── Update peak history ──
    this.peakHistory.push(maxDiff);
    if (this.peakHistory.length > this.historyLength) {
      this.peakHistory.shift();
    }

    // ── Shot detection with recoil compensation ──
    // A laser pulse spans multiple frames. With hand movement/recoil,
    // the laser sweeps across the screen. We use the FIRST frame position
    // (pre-recoil, where the shooter was actually aiming) rather than
    // the peak brightness frame (which may be mid-sweep).
    let shotDetected = false;

    if (now - this.lastShotTime > this.shotCooldown) {
      const isFlashFrame = maxDiff > effectiveThreshold && position !== null;

      if (isFlashFrame) {
        if (!this.inFlash) {
          // Flash just started — this is the pre-recoil position (most accurate)
          this.inFlash = true;
          this.flashStartTime = now;
          this.flashPeakBrightness = maxDiff;
          this.flashPeakPosition = position; // First frame = aim point
          console.log(`[IRDetector] FLASH START: diff=${maxDiff} at (${Math.round(position!.x)},${Math.round(position!.y)})`);
        } else {
          // Track peak brightness but DON'T update position —
          // the first frame position is the true aim point
          if (maxDiff > this.flashPeakBrightness) {
            this.flashPeakBrightness = maxDiff;
          }
        }
      } else if (this.inFlash) {
        // Flash ended — register the shot at the FIRST frame position
        this.inFlash = false;
        if (this.flashPeakPosition && this.flashPeakBrightness > 150) {
          // Only register strong flashes (real shots are 200+).
          // Afterimages from previous shots read 40-130 and must be ignored.
          position = this.flashPeakPosition;
          shotDetected = true;
          this.lastShotTime = now;

          console.log(`[IRDetector] SHOT DETECTED: peakDiff=${this.flashPeakBrightness} pos=(${Math.round(position.x)},${Math.round(position.y)})`);
        }
        this.flashPeakBrightness = 0;
        this.flashPeakPosition = null;
      }

      // Safety: if flash has been going for too long (>300ms), it's not a real shot
      if (this.inFlash && now - this.flashStartTime > 300) {
        this.inFlash = false;
        this.flashPeakBrightness = 0;
        this.flashPeakPosition = null;
      }
    }

    return {
      position: shotDetected ? position : (maxDiff > minB ? position : null),
      brightness: maxDiff,
      baseline: this.baselineBrightness,
      shotDetected,
      timestamp: now,
    };
  }

  getBaseline(): number {
    return this.baselineBrightness;
  }

  reset() {
    this.peakHistory = [];
    this.baselineBrightness = 0;
    this.inFlash = false;
    this.flashPeakBrightness = 0;
    this.flashPeakPosition = null;
    this.lastShotTime = 0;
    this.hotPixelMask.clear();
    this.hotPixelCandidates.clear();
    // Don't clear the baseline — it should persist until recaptured
  }

  /**
   * Clear everything including the baseline.
   */
  fullReset() {
    this.reset();
    this.baseline = null;
    this.baselineAccumulator = null;
    this.baselineFrameCount = 0;
    this.isCapturingBaseline = false;
    this.noiseFloor = 0;
  }
}
