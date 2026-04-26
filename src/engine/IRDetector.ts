import type { Point2D, DetectionConfig } from '../types';

export interface DetectionResult {
  position: Point2D | null;
  brightness: number;
  shotDetected: boolean;
  timestamp: number;
  stats: {
    threshold: number;     // Live auto-adjusted threshold (may differ from config if ThresholdBump active)
    blobCount: number;     // Active blobs this frame (after hot pixel filter)
    hotPixelCount: number; // Number of masked sensor defect positions
  };
}

interface Blob {
  cx: number;          // Centroid x in processing-resolution coordinates
  cy: number;          // Centroid y
  area: number;        // Pixel count
  maxBrightness: number;
}

/**
 * Laser Shot Detector — replicates the SLDriver/WCDriver detection algorithm
 * from CameraParameters.ini (Channel 3 = tracking mode).
 *
 * Algorithm (reconstructed from SLDriver string analysis):
 *   "Pixel above threshold at %d %d intensity %d threshold %d"
 *   "Found pixels %d blobs %d"
 *
 * 1. Camera is set dark (Brightness=-48) so the projected target image falls
 *    below TrackingThreshold (220). Only the laser dot exceeds it.
 * 2. Each frame: find all pixels > TrackingThreshold.
 * 3. Group connected pixels into blobs (BFS flood fill).
 * 4. A blob that was NOT present in the previous frame is a new shot.
 *    ("New" = centroid > ShotConnectedDistance from all previous blobs.)
 * 5. Persistent blobs (hot pixels) are masked after N frames.
 *
 * No baseline capture required — detection is ready immediately.
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
  // bright: max(R,G,B) per pixel. visited: BFS flood-fill marker (zeroed each findBlobs call).
  private readonly brightBuf: Uint8Array;
  private readonly visitedBuf: Uint8Array;

  // Blob state
  private previousBlobs: Blob[] = [];

  // Hot pixel rejection — numeric keys to avoid string allocation in the hot path.
  // Key encoding: Math.round(cx/grid) * 65536 + Math.round(cy/grid).
  // Grid quantises adjacent positions into the same bucket (8px processing-space cells).
  private readonly hotPixelGrid = 8;       // px — quantization for position grouping
  private readonly hotPixelLimit = 90;     // frames before masking (~0.75s at 120fps)
  private readonly hotPixelExpiry = 8000;  // ms before unmasking
  private persistentCount: Map<number, number> = new Map();
  private hotPixels: Set<number> = new Set();
  private hotPixelTimestamps: Map<number, number> = new Map();
  private readonly seenKeys: Set<number> = new Set(); // reused each frame — avoids per-frame Set allocation

  // ROI — only scan within projected screen area
  private roi: { x: number; y: number; w: number; h: number } | null = null;

  // Shot cooldown — from config.shotCooldown (ms). Prevents duplicate detections from
  // a single trigger pull. Use a lower value for speed drills with rapid fire.
  private lastShotTime = 0;

  // ThresholdBump — auto-adjusts the working threshold when too many or too few
  // blobs are detected. Replicates SLDriver's "ThresholdBump" parameter.
  // currentThreshold starts at config.trackingThreshold and drifts up/down.
  private currentThreshold: number = 220;
  private readonly blobCountWindow = 30;       // frames to average over
  private blobCountHistory: number[] = [];      // rolling blob count per frame
  private blobCountSum = 0;                     // running sum — avoids O(n) reduce each frame
  private readonly tooManyBlobsLimit = 4;      // avg blobs above this → bump up
  private readonly tooFewBlobsFrames = 90;     // consecutive zero-blob frames → bump down
  private zeroBlobStreak = 0;

  // Logging
  private frameCount = 0;
  private lastLogTime = 0;

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
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })! as OffscreenCanvasRenderingContext2D;

    this.currentThreshold = config.trackingThreshold;

    // Allocate frame buffers once — reused every frame to avoid GC at 120fps
    const pixelCount = this.processWidth * this.processHeight;
    this.brightBuf = new Uint8Array(pixelCount);
    this.visitedBuf = new Uint8Array(pixelCount);
  }

  updateConfig(config: Partial<DetectionConfig>) {
    this.config = { ...this.config, ...config };
    // Re-anchor currentThreshold if the user manually changed trackingThreshold in settings
    if (config.trackingThreshold !== undefined) {
      this.currentThreshold = config.trackingThreshold;
    }
  }

  getCurrentThreshold(): number { return this.currentThreshold; }

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

  processFrame(videoElement: HTMLVideoElement): DetectionResult {
    const now = performance.now();
    const w = this.processWidth;
    const h = this.processHeight;
    const pixelCount = w * h;

    this.ctx.drawImage(videoElement, 0, 0, w, h);
    const { data } = this.ctx.getImageData(0, 0, w, h);

    // max(R,G,B) brightness into pre-allocated buffer — no GC allocation per frame.
    // With camera Brightness=-48, the projected scene sits well below
    // TrackingThreshold=220, so only the laser exceeds it.
    for (let i = 0; i < pixelCount; i++) {
      const idx = i * 4;
      this.brightBuf[i] = Math.max(data[idx], data[idx + 1], data[idx + 2]);
    }

    const scanX0 = this.roi ? Math.max(0, this.roi.x) : 0;
    const scanY0 = this.roi ? Math.max(0, this.roi.y) : 0;
    const scanX1 = this.roi ? Math.min(w, this.roi.x + this.roi.w) : w;
    const scanY1 = this.roi ? Math.min(h, this.roi.y + this.roi.h) : h;

    // Use the auto-adjusted threshold (ThresholdBump may have shifted it)
    const threshold = this.currentThreshold;

    // Find all blobs above threshold in this frame
    const blobs = this.findBlobs(threshold, scanX0, scanY0, scanX1, scanY1, w);

    // Update hot pixel tracking (expire old, count persistence)
    this.updateHotPixels(blobs, now);

    // Remove hot pixel blobs — they're sensor defects, not laser hits
    const activeBlobs = blobs.filter(b => !this.isHotPixel(b));

    // ── ThresholdBump (SLDriver: "ThresholdBump") ──
    // Track rolling blob count. Too many active blobs = threshold too low
    // (camera not dark enough, or projector bleeding through). Bump up.
    // Zero blobs for a long time = threshold too high. Bump down toward base.
    this.applyThresholdBump(activeBlobs.length);

    // Periodic diagnostic log
    this.frameCount++;
    if (now - this.lastLogTime > 2000) {
      let rawPeak = 0;
      for (let y = scanY0; y < scanY1; y += 4) {
        for (let x = scanX0; x < scanX1; x += 4) {
          const v = this.brightBuf[y * w + x];
          if (v > rawPeak) rawPeak = v;
        }
      }
      console.log(`[IRDetector] frame=${this.frameCount} rawPeak=${rawPeak} threshold=${threshold} blobs=${blobs.length} active=${activeBlobs.length} hotPixels=${this.hotPixels.size}`);
      this.lastLogTime = now;
      this.frameCount = 0;
    }

    // Detect new blobs (shots)
    let shotDetected = false;
    let shotPosition: Point2D | null = null;
    let peakBrightness = 0;
    const cooldown = this.config.shotCooldown;

    if (now - this.lastShotTime > cooldown) {
      for (const blob of activeBlobs) {
        if (this.isNewBlob(blob)) {
          // Blob appeared from nowhere this frame = laser flash
          if (blob.maxBrightness > peakBrightness) {
            peakBrightness = blob.maxBrightness;
            shotPosition = {
              x: blob.cx * this.scaleX,
              y: blob.cy * this.scaleY,
            };
            shotDetected = true;
          }
        }
      }

      if (shotDetected) {
        this.lastShotTime = now;
        console.log(`[IRDetector] SHOT: brightness=${peakBrightness} pos=(${Math.round(shotPosition!.x)},${Math.round(shotPosition!.y)})`);
      }
    }

    // Update previous blobs for next frame's new-blob comparison
    this.previousBlobs = activeBlobs;

    // Live cursor: brightest active blob position (for aiming aid, not shots)
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
        threshold: this.currentThreshold,
        blobCount: activeBlobs.length,
        hotPixelCount: this.hotPixels.size,
      },
    };
  }

  /**
   * BFS flood fill — finds all groups of connected pixels above threshold.
   * 4-connectivity (faster than 8, sufficient for compact laser blobs).
   * Uses pre-allocated visitedBuf — zeroed only over the scan region, not the full buffer.
   */
  private findBlobs(
    threshold: number,
    x0: number, y0: number, x1: number, y1: number,
    w: number,
  ): Blob[] {
    const bright = this.brightBuf;
    const visited = this.visitedBuf;
    const minBrightness = this.config.minBrightness;

    // Zero only the scan region — avoids clearing 300K bytes when ROI is a small patch
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

        // Iterative BFS — avoids call-stack overflow on unexpectedly large blobs
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

        // Laser dot at 480p = 1–150 px area. Larger = background noise or sensor artifact.
        // minBrightness filters blobs that barely cleared the threshold — likely noise,
        // not a laser which typically reads 240–255 even with camera darkening.
        if (area >= 1 && area <= 300 && wSum > 0 && maxB >= minBrightness) {
          blobs.push({ cx: wSumX / wSum, cy: wSumY / wSum, area, maxBrightness: maxB });
        }
      }
    }

    return blobs;
  }

  /**
   * Returns true if blob was NOT present in the previous frame.
   * Uses ShotConnectedDistance from config (SLDriver: "ShotConnectedDistance").
   *
   * config.shotConnectedDistance is in CAMERA-resolution pixels (same space as SLDriver).
   * Dividing by scaleX converts it to processing-resolution pixels for comparison.
   * scaleX === scaleY here (aspect-ratio-preserving downscale), so one factor suffices.
   * Squared-distance comparison avoids Math.sqrt on every blob pair.
   */
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
   * ThresholdBump — SLDriver: "ThresholdBump" parameter.
   *
   * Too many active blobs → camera settings didn't darken the scene enough,
   * projector image is bleeding through. Bump threshold up so only the laser
   * (much brighter) still registers.
   *
   * Zero blobs for many consecutive frames → threshold may have drifted too high
   * or camera is too dark. Nudge back toward the configured base value.
   *
   * bumpStep=0 disables auto-adjustment entirely.
   */
  private applyThresholdBump(activeBlobCount: number) {
    const bumpStep = this.config.thresholdBumpStep;
    if (bumpStep <= 0) return;

    const baseThreshold = this.config.trackingThreshold;
    const maxThreshold = Math.min(254, baseThreshold + 40);

    // Rolling blob-count with running sum — O(1) average, no reduce() each frame
    this.blobCountHistory.push(activeBlobCount);
    this.blobCountSum += activeBlobCount;
    if (this.blobCountHistory.length > this.blobCountWindow) {
      this.blobCountSum -= this.blobCountHistory.shift()!;
    }

    // Need a full window before acting
    if (this.blobCountHistory.length < this.blobCountWindow) return;

    const avgBlobs = this.blobCountSum / this.blobCountHistory.length;

    if (avgBlobs > this.tooManyBlobsLimit) {
      // Too many false positives — raise threshold
      const prev = this.currentThreshold;
      this.currentThreshold = Math.min(maxThreshold, this.currentThreshold + bumpStep);
      if (this.currentThreshold !== prev) {
        console.log(`[IRDetector] ThresholdBump UP: ${prev} → ${this.currentThreshold} (avg blobs=${avgBlobs.toFixed(1)})`);
        this.blobCountSum = 0;
        this.blobCountHistory = []; // reset window after bump
      }
    }

    // Zero-blob streak tracking (separate from rolling average)
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
    // Expire old hot pixels
    for (const [key, ts] of this.hotPixelTimestamps) {
      if (now - ts > this.hotPixelExpiry) {
        this.hotPixels.delete(key);
        this.hotPixelTimestamps.delete(key);
        this.persistentCount.delete(key);
      }
    }

    // Reuse seenKeys set — clear is much cheaper than allocating new Set each frame
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

    // Decay counts for positions not seen this frame
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

  // Numeric key: pack two bucket indices into one number — avoids string allocation
  // in the hottest path. Buckets are at most ~107×60 for 853×480 processing resolution,
  // well within the 65536 column capacity of the encoding.
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
  }

  fullReset() {
    this.reset();
  }
}
