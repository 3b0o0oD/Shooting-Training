import type { Point2D, DetectionConfig } from '../types';

export interface DetectionResult {
  position: Point2D | null;
  brightness: number;
  shotDetected: boolean;
  timestamp: number;
  stats: {
    threshold: number;     // Effective threshold (baselineDelta in delta mode, bumped value in absolute mode)
    blobCount: number;     // Active blobs this frame (after hot pixel filter)
    hotPixelCount: number; // Number of masked sensor defect positions
    mode: 'absolute' | 'delta'; // Detection mode
  };
}

interface Blob {
  cx: number;          // Centroid x in processing-resolution coordinates
  cy: number;          // Centroid y
  area: number;        // Pixel count
  maxBrightness: number;
}

/**
 * Laser Shot Detector — replicates the SLDriver/WCDriver detection algorithm.
 *
 * Two detection modes:
 *
 * ABSOLUTE (default, no baseline captured):
 *   Camera Brightness=-48 makes the projected scene fall below TrackingThreshold (220).
 *   ThresholdBump auto-adjusts if needed. Any pixel above threshold is a candidate.
 *   Works when camera hardware actually applies the brightness setting.
 *
 * DELTA (after captureBaseline() is called):
 *   Per-pixel background model captured once (no laser). Detection measures how much
 *   BRIGHTER each pixel is than its baseline value. Works even when camera brightness
 *   settings aren't applied and the projector bleeds through at the same level as the
 *   laser — the laser still creates a sudden brightness INCREASE at a specific point.
 *   Call captureBaseline() once after the camera settles into tracking mode.
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

  // Pre-allocated frame buffers — reused every frame to avoid GC pressure at 120fps.
  // bright: max(R,G,B) per pixel (or delta above baseline in delta mode).
  // visited: BFS flood-fill marker (zeroed each findBlobs call).
  private readonly brightBuf: Uint8Array;
  private readonly visitedBuf: Uint8Array;

  // Baseline subtraction (delta mode).
  // Per-pixel max brightness captured while no laser is present.
  // In delta mode brightBuf[i] = max(0, raw[i] - baseline[i]).
  private baselineBuf: Uint8Array | null = null;
  // How many delta-brightness units above baseline a pixel must be to count as bright.
  // Lower = more sensitive (catches faint lasers). Too low = noise triggers shots.
  private readonly baselineDelta = 8;

  // Blob state
  private previousBlobs: Blob[] = [];

  // Hot pixel rejection — numeric keys to avoid string allocation in the hot path.
  private readonly hotPixelGrid = 8;
  private readonly hotPixelLimit = 90;
  private readonly hotPixelExpiry = 8000;
  private persistentCount: Map<number, number> = new Map();
  private hotPixels: Set<number> = new Set();
  private hotPixelTimestamps: Map<number, number> = new Map();
  private readonly seenKeys: Set<number> = new Set();

  // ROI — only scan within projected screen area
  private roi: { x: number; y: number; w: number; h: number } | null = null;

  // Shot cooldown — prevents duplicate detections from a single trigger pull.
  private lastShotTime = 0;

  // ThresholdBump — auto-adjusts threshold in absolute mode only.
  private currentThreshold: number = 220;
  private readonly blobCountWindow = 30;
  private blobCountHistory: number[] = [];
  private blobCountSum = 0;
  private readonly tooManyBlobsLimit = 4;
  private readonly tooFewBlobsFrames = 90;
  private zeroBlobStreak = 0;

  // Logging
  private frameCount = 0;
  private lastLogTime = 0;

  constructor(config: DetectionConfig, width: number, height: number) {
    this.config = config;

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
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })! as OffscreenCanvasRenderingContext2D;

    this.currentThreshold = config.trackingThreshold;

    const pixelCount = this.processWidth * this.processHeight;
    this.brightBuf = new Uint8Array(pixelCount);
    this.visitedBuf = new Uint8Array(pixelCount);
  }

  updateConfig(config: Partial<DetectionConfig>) {
    this.config = { ...this.config, ...config };
    if (config.trackingThreshold !== undefined && !this.baselineBuf) {
      this.currentThreshold = config.trackingThreshold;
    }
  }

  getCurrentThreshold(): number {
    return this.baselineBuf ? this.baselineDelta : this.currentThreshold;
  }

  hasBaseline(): boolean { return this.baselineBuf !== null; }

  setROI(roi: { x: number; y: number; w: number; h: number } | null) {
    if (roi) {
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
   * Capture a per-pixel background model by sampling frameCount frames without
   * the laser present. Switches the detector into delta mode: subsequent frames
   * measure brightness ABOVE this baseline, making the laser visible even when
   * the projected image is as bright as the laser in absolute terms.
   *
   * Call after camera preset is applied and has settled (typically 800ms).
   * Detection must be paused (isActive=false) during capture so this runs cleanly.
   */
  async captureBaseline(videoElement: HTMLVideoElement, frameCount = 30): Promise<void> {
    const w = this.processWidth;
    const h = this.processHeight;
    const pixelCount = w * h;
    const baseline = new Uint8Array(pixelCount);

    console.log(`[IRDetector] Capturing baseline (${frameCount} frames)…`);
    for (let f = 0; f < frameCount; f++) {
      await new Promise<void>(r => setTimeout(r, 16));
      if (videoElement.readyState < videoElement.HAVE_CURRENT_DATA) continue;
      this.ctx.drawImage(videoElement, 0, 0, w, h);
      const { data } = this.ctx.getImageData(0, 0, w, h);
      for (let i = 0; i < pixelCount; i++) {
        const idx = i * 4;
        const b = Math.max(data[idx], data[idx + 1], data[idx + 2]);
        if (b > baseline[i]) baseline[i] = b;
      }
    }

    this.baselineBuf = baseline;

    // Compute a summary for the log
    let baselineMax = 0;
    let baselineSum = 0;
    for (let i = 0; i < pixelCount; i++) {
      if (baseline[i] > baselineMax) baselineMax = baseline[i];
      baselineSum += baseline[i];
    }
    const baselineMean = Math.round(baselineSum / pixelCount);

    // Reset all detection state — previous absolute-mode blobs are meaningless in delta mode
    this.previousBlobs = [];
    this.hotPixels.clear();
    this.persistentCount.clear();
    this.hotPixelTimestamps.clear();
    this.seenKeys.clear();
    this.lastShotTime = 0;
    this.blobCountHistory = [];
    this.blobCountSum = 0;
    this.zeroBlobStreak = 0;

    console.log(
      `[IRDetector] Baseline captured — delta mode active. ` +
      `baselineMean=${baselineMean} baselineMax=${baselineMax} ` +
      `detectionDelta=${this.baselineDelta} (laser needs to be >${this.baselineDelta} brighter than background)`,
    );
  }

  clearBaseline(): void {
    this.baselineBuf = null;
    this.currentThreshold = this.config.trackingThreshold;
    this.previousBlobs = [];
    this.hotPixels.clear();
    this.persistentCount.clear();
    this.hotPixelTimestamps.clear();
    this.seenKeys.clear();
    this.lastShotTime = 0;
    this.blobCountHistory = [];
    this.blobCountSum = 0;
    this.zeroBlobStreak = 0;
    console.log('[IRDetector] Baseline cleared — absolute mode restored');
  }

  processFrame(videoElement: HTMLVideoElement): DetectionResult {
    const now = performance.now();
    const w = this.processWidth;
    const h = this.processHeight;
    const pixelCount = w * h;

    this.ctx.drawImage(videoElement, 0, 0, w, h);
    const { data } = this.ctx.getImageData(0, 0, w, h);

    // Compute max(R,G,B) per pixel
    for (let i = 0; i < pixelCount; i++) {
      const idx = i * 4;
      this.brightBuf[i] = Math.max(data[idx], data[idx + 1], data[idx + 2]);
    }

    // DELTA MODE: subtract per-pixel baseline so brightBuf now represents
    // "how much brighter than background" each pixel is. The laser produces a
    // sudden spike even when the projected image is at the same absolute level.
    if (this.baselineBuf) {
      for (let i = 0; i < pixelCount; i++) {
        const d = this.brightBuf[i] - this.baselineBuf[i];
        this.brightBuf[i] = d > 0 ? d : 0;
      }
    }

    const scanX0 = this.roi ? Math.max(0, this.roi.x) : 0;
    const scanY0 = this.roi ? Math.max(0, this.roi.y) : 0;
    const scanX1 = this.roi ? Math.min(w, this.roi.x + this.roi.w) : w;
    const scanY1 = this.roi ? Math.min(h, this.roi.y + this.roi.h) : h;

    // In delta mode use fixed baselineDelta; in absolute mode use ThresholdBump value.
    const threshold = this.baselineBuf ? this.baselineDelta : this.currentThreshold;
    const mode = this.baselineBuf ? 'delta' : 'absolute';

    const blobs = this.findBlobs(threshold, scanX0, scanY0, scanX1, scanY1, w);

    this.updateHotPixels(blobs, now);
    const activeBlobs = blobs.filter(b => !this.isHotPixel(b));

    // ThresholdBump only applies in absolute mode — delta mode uses a fixed threshold.
    if (!this.baselineBuf) {
      this.applyThresholdBump(activeBlobs.length);
    }

    // ── Diagnostic logging ──────────────────────────────────────────────────────
    this.frameCount++;
    if (now - this.lastLogTime > 2000) {
      let rawPeak = 0;
      for (let y = scanY0; y < scanY1; y += 4) {
        for (let x = scanX0; x < scanX1; x += 4) {
          const v = this.brightBuf[y * w + x];
          if (v > rawPeak) rawPeak = v;
        }
      }
      const cooldownRemaining = Math.max(0, this.config.shotCooldown - (now - this.lastShotTime));
      console.log(
        `[IRDetector] mode=${mode} frames=${this.frameCount} | ` +
        `rawPeak=${rawPeak} threshold=${threshold} | ` +
        `blobs=${blobs.length} active=${activeBlobs.length} | ` +
        `prevBlobs=${this.previousBlobs.length} hotPixels=${this.hotPixels.size} | ` +
        `cooldownLeft=${Math.round(cooldownRemaining)}ms`,
      );
      this.lastLogTime = now;
      this.frameCount = 0;
    }

    // Per-blob log when blobs exist — fires every frame that has active blobs.
    // Check the console immediately after pulling the trigger.
    if (activeBlobs.length > 0) {
      const cooldownActive = (now - this.lastShotTime) <= this.config.shotCooldown;
      for (const blob of activeBlobs) {
        const passesNew = this.isNewBlob(blob);
        const closestPrev = this.previousBlobs.reduce((best, p) => {
          const d = Math.hypot(blob.cx - p.cx, blob.cy - p.cy);
          return d < best ? d : best;
        }, Infinity);
        console.log(
          `[IRDetector] BLOB cx=${Math.round(blob.cx)} cy=${Math.round(blob.cy)} ` +
          `area=${blob.area} maxB=${blob.maxBrightness}(>${threshold}) ` +
          `isNew=${passesNew} closestPrevDist=${closestPrev === Infinity ? 'none' : Math.round(closestPrev)}px | ` +
          `cooldown=${cooldownActive ? `BLOCKING(${Math.round(this.config.shotCooldown - (now - this.lastShotTime))}ms left)` : 'ok'}`,
        );
      }
    }
    // ────────────────────────────────────────────────────────────────────────────

    let shotDetected = false;
    let shotPosition: Point2D | null = null;
    let peakBrightness = 0;
    const cooldown = this.config.shotCooldown;

    if (now - this.lastShotTime > cooldown) {
      for (const blob of activeBlobs) {
        if (this.isNewBlob(blob)) {
          if (blob.maxBrightness > peakBrightness) {
            peakBrightness = blob.maxBrightness;
            shotPosition = { x: blob.cx * this.scaleX, y: blob.cy * this.scaleY };
            shotDetected = true;
          }
        }
      }
      if (shotDetected) {
        this.lastShotTime = now;
        console.log(
          `[IRDetector] SHOT (${mode}): delta=${peakBrightness} ` +
          `pos=(${Math.round(shotPosition!.x)},${Math.round(shotPosition!.y)})`,
        );
      }
    }

    this.previousBlobs = activeBlobs;

    // Live cursor: brightest active blob (aiming aid)
    let cursorPosition: Point2D | null = null;
    let cursorBrightness = 0;
    for (const blob of activeBlobs) {
      if (blob.maxBrightness > cursorBrightness) {
        cursorBrightness = blob.maxBrightness;
        cursorPosition = { x: blob.cx * this.scaleX, y: blob.cy * this.scaleY };
      }
    }

    return {
      position: shotDetected ? shotPosition : cursorPosition,
      brightness: shotDetected ? peakBrightness : cursorBrightness,
      shotDetected,
      timestamp: now,
      stats: {
        threshold,
        blobCount: activeBlobs.length,
        hotPixelCount: this.hotPixels.size,
        mode,
      },
    };
  }

  /**
   * BFS flood fill — finds all pixel groups above threshold.
   * In delta mode the threshold and minBrightness are the baselineDelta value.
   */
  private findBlobs(
    threshold: number,
    x0: number, y0: number, x1: number, y1: number,
    w: number,
  ): Blob[] {
    const bright = this.brightBuf;
    const visited = this.visitedBuf;
    // In delta mode config.minBrightness (220) would filter everything — use threshold instead.
    const minBrightness = this.baselineBuf ? threshold : this.config.minBrightness;

    if (this.roi) {
      for (let y = y0; y < y1; y++) visited.fill(0, y * w + x0, y * w + x1);
    } else {
      visited.fill(0);
    }

    const blobs: Blob[] = [];

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        if (visited[i] || bright[i] < threshold) continue;

        const queue: number[] = [i];
        visited[i] = 1;
        let wSumX = 0, wSumY = 0, wSum = 0, area = 0, maxB = 0;
        let head = 0;

        while (head < queue.length) {
          const idx = queue[head++];
          const py = Math.floor(idx / w);
          const px = idx % w;
          const b = bright[idx];
          wSumX += px * b;
          wSumY += py * b;
          wSum += b;
          area++;
          if (b > maxB) maxB = b;

          if (px > x0)   { const ni = idx - 1; if (!visited[ni] && bright[ni] >= threshold) { visited[ni] = 1; queue.push(ni); } }
          if (px < x1-1) { const ni = idx + 1; if (!visited[ni] && bright[ni] >= threshold) { visited[ni] = 1; queue.push(ni); } }
          if (py > y0)   { const ni = idx - w; if (!visited[ni] && bright[ni] >= threshold) { visited[ni] = 1; queue.push(ni); } }
          if (py < y1-1) { const ni = idx + w; if (!visited[ni] && bright[ni] >= threshold) { visited[ni] = 1; queue.push(ni); } }
        }

        if (area >= 1 && area <= 300 && wSum > 0 && maxB >= minBrightness) {
          blobs.push({ cx: wSumX / wSum, cy: wSumY / wSum, area, maxBrightness: maxB });
        }
      }
    }

    return blobs;
  }

  private isNewBlob(blob: Blob): boolean {
    const dist = this.config.shotConnectedDistance / this.scaleX;
    const distSq = dist * dist;
    for (const prev of this.previousBlobs) {
      const dx = blob.cx - prev.cx;
      const dy = blob.cy - prev.cy;
      if (dx * dx + dy * dy <= distSq) return false;
    }
    return true;
  }

  /**
   * ThresholdBump — absolute mode only. Not used in delta mode.
   */
  private applyThresholdBump(activeBlobCount: number) {
    const bumpStep = this.config.thresholdBumpStep;
    if (bumpStep <= 0) return;

    const baseThreshold = this.config.trackingThreshold;
    const maxThreshold = Math.min(254, baseThreshold + 40);

    this.blobCountHistory.push(activeBlobCount);
    this.blobCountSum += activeBlobCount;
    if (this.blobCountHistory.length > this.blobCountWindow) {
      this.blobCountSum -= this.blobCountHistory.shift()!;
    }

    if (this.blobCountHistory.length < this.blobCountWindow) return;

    const avgBlobs = this.blobCountSum / this.blobCountHistory.length;

    if (avgBlobs > this.tooManyBlobsLimit) {
      const prev = this.currentThreshold;
      this.currentThreshold = Math.min(maxThreshold, this.currentThreshold + bumpStep);
      if (this.currentThreshold !== prev) {
        console.log(`[IRDetector] ThresholdBump UP: ${prev} → ${this.currentThreshold} (avg blobs=${avgBlobs.toFixed(1)})`);
        this.blobCountSum = 0;
        this.blobCountHistory = [];
      }
    }

    if (activeBlobCount === 0) {
      this.zeroBlobStreak++;
      if (this.zeroBlobStreak >= this.tooFewBlobsFrames && this.currentThreshold > baseThreshold) {
        const prev = this.currentThreshold;
        this.currentThreshold = Math.max(baseThreshold, this.currentThreshold - bumpStep);
        console.log(`[IRDetector] ThresholdBump DOWN: ${prev} → ${this.currentThreshold} (${this.zeroBlobStreak} zero frames)`);
        this.zeroBlobStreak = 0;
        this.blobCountSum = 0;
        this.blobCountHistory = [];
      }
    } else {
      this.zeroBlobStreak = 0;
    }
  }

  private updateHotPixels(blobs: Blob[], now: number) {
    for (const [key, ts] of this.hotPixelTimestamps) {
      if (now - ts > this.hotPixelExpiry) {
        this.hotPixels.delete(key);
        this.hotPixelTimestamps.delete(key);
        this.persistentCount.delete(key);
      }
    }

    this.seenKeys.clear();
    for (const blob of blobs) {
      const key = this.quantize(blob.cx, blob.cy);
      this.seenKeys.add(key);
      const count = (this.persistentCount.get(key) ?? 0) + 1;
      this.persistentCount.set(key, count);
      if (count >= this.hotPixelLimit && !this.hotPixels.has(key)) {
        this.hotPixels.add(key);
        this.hotPixelTimestamps.set(key, now);
        console.log(`[IRDetector] Hot pixel masked at grid ${key}`);
      }
    }

    for (const [key, count] of this.persistentCount) {
      if (!this.seenKeys.has(key)) {
        const next = count - 3;
        if (next <= 0) this.persistentCount.delete(key);
        else this.persistentCount.set(key, next);
      }
    }
  }

  private isHotPixel(blob: Blob): boolean {
    return this.hotPixels.has(this.quantize(blob.cx, blob.cy));
  }

  private quantize(x: number, y: number): number {
    const g = this.hotPixelGrid;
    return Math.round(x / g) * 65536 + Math.round(y / g);
  }

  reset() {
    this.previousBlobs = [];
    this.lastShotTime = 0;
    this.hotPixels.clear();
    this.persistentCount.clear();
    this.hotPixelTimestamps.clear();
    this.seenKeys.clear();
    this.currentThreshold = this.config.trackingThreshold;
    this.blobCountHistory = [];
    this.blobCountSum = 0;
    this.zeroBlobStreak = 0;
    // Baseline is preserved across resets — no need to recapture on pause/resume
  }

  fullReset() {
    this.reset();
    this.clearBaseline();
  }
}
