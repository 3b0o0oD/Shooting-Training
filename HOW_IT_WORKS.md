# How Detection and Calibration Work

This document explains the complete technical picture behind the IR laser detection and camera-to-screen calibration systems — from the physical hardware setup all the way through the code. No prior background is assumed.

---

## Table of Contents

1. [The Physical Setup](#1-the-physical-setup)
2. [Part 1 — IR Laser Detection](#part-1--ir-laser-detection)
   - [The Core Trick: Making the Projector Invisible](#the-core-trick-making-the-projector-invisible)
   - [Step 1: Brightness Map](#step-1-brightness-map)
   - [Step 2: Blob Detection (BFS Flood Fill)](#step-2-blob-detection-bfs-flood-fill)
   - [Step 3: New Blob = Shot](#step-3-new-blob--shot)
   - [Step 4: Hot Pixel Masking](#step-4-hot-pixel-masking)
   - [Step 5: ThresholdBump (Auto-adjustment)](#step-5-thresholdbump-auto-adjustment)
   - [Step 6: Shot Cooldown](#step-6-shot-cooldown)
   - [Performance Optimizations](#performance-optimizations)
   - [Code Walkthrough: IRDetector.ts](#code-walkthrough-irdetectorts)
3. [Part 2 — Camera-to-Screen Calibration](#part-2--camera-to-screen-calibration)
   - [The Problem: Two Coordinate Systems](#the-problem-two-coordinate-systems)
   - [What a Homography Is](#what-a-homography-is)
   - [The Calibration Procedure](#the-calibration-procedure)
   - [Computing the Homography (DLT)](#computing-the-homography-dlt)
   - [Hartley Normalization](#hartley-normalization)
   - [Lens Distortion Correction](#lens-distortion-correction)
   - [Manual Offset Fine-Tuning](#manual-offset-fine-tuning)
   - [ROI (Region of Interest)](#roi-region-of-interest)
   - [Code Walkthrough: CalibrationEngine.ts](#code-walkthrough-calibrationenginets)
   - [Code Walkthrough: CalibrationScreen.tsx](#code-walkthrough-calibrationscreentsx)
4. [Part 3 — How Everything Connects](#part-3--how-everything-connects)
   - [Data Flow: Camera Frame to Registered Shot](#data-flow-camera-frame-to-registered-shot)
   - [The Detection Loop Hook](#the-detection-loop-hook)
   - [The Camera Hook](#the-camera-hook)

---

## 1. The Physical Setup

```
[Projector] ──── projects target onto wall ──────▶ [Wall/Screen]
                                                         │
                                                   User shoots laser
                                                         │
[Camera] ◀──── watches the wall ─────────────────────── ┘
   │
   └──▶ [This App]
          │
          ├── Detects laser flash position (camera coordinates)
          ├── Maps it to screen coordinates (via calibration)
          └── Scores the shot against the target
```

The system has three hardware components:

- **Camera** — a webcam or IR camera pointed at the projection wall. It watches for the laser dot. Must have a field of view that covers the entire projected area.
- **Projector** — projects the target image onto the wall. The camera can see both the target and the laser dot simultaneously.
- **Laser training gun** — fires a brief (10–50ms) pulse of near-infrared or red laser light when the trigger is pulled. The camera sees this as a sudden, very bright spot.

The app runs on a computer connected to both the projector (as a second display) and the camera (via USB).

---

## Part 1 — IR Laser Detection

### The Core Trick: Making the Projector Invisible

The central challenge is: **how do you detect a laser dot when the camera also sees the projected target?**

The answer is camera darkening. The app applies aggressive exposure settings that make the camera image very dark:

- **Brightness = −48** (CameraParameters.ini, Channel 3)
- **Gain = 20**
- **Contrast = 0**

At these settings, the projected target image (which reflects diffusely off the wall) becomes too dim for the camera to register clearly. But the laser dot — a focused, coherent light source hitting the same wall — is far brighter and still exceeds the threshold.

In numbers: with Brightness = −48, projected white pixels read as roughly 207 in the camera. The detection threshold is 220. So projected content stays **below 220** and the laser dot hits **240–255**.

This means: **any pixel above 220 is almost certainly the laser, not the projection.**

In `useCamera.ts`, the `irTracking` preset applies these settings via the browser's `MediaStreamTrack.applyConstraints` API:

```typescript
// src/hooks/useCamera.ts — applyCameraPreset()
if (presetName === 'irTracking') {
  if (caps.brightness) settings.brightness = mapRange(-48, -64, 64, caps.brightness);
  if (caps.contrast)   settings.contrast   = mapRange(0,   0,  64, caps.contrast);
  if (caps.gain)       settings.gain       = mapRange(20,  0, 100, caps.gain);
  if (caps.saturation) settings.saturation = mapRange(128, 0, 128, caps.saturation);
}
```

The `mapRange` function converts values from the original software's range (−64 to +64 for brightness) to whatever range the connected camera actually supports.

---

### Step 1: Brightness Map

Every frame starts by reading the pixel data from the camera and computing a single brightness value per pixel. We use `max(R, G, B)` rather than an average or luminance formula. Why max?

- Near-IR lasers often appear strongly in only one channel (usually red or green depending on filter)
- max() catches the brightest channel regardless
- It's cheaper to compute than a weighted luminance formula

The result goes into a pre-allocated `Uint8Array` called `brightBuf`. This buffer is created **once** in the constructor and reused every frame — allocating a new array 120 times per second would trigger the garbage collector and cause stuttering.

```typescript
// src/engine/IRDetector.ts — processFrame()
for (let i = 0; i < pixelCount; i++) {
  const idx = i * 4;
  this.brightBuf[i] = Math.max(data[idx], data[idx + 1], data[idx + 2]);
}
```

---

### Step 2: Blob Detection (BFS Flood Fill)

A "blob" is a group of connected pixels that are all above the threshold. The laser dot is one blob. Sensor noise or projector bleed-through might create other blobs.

The algorithm scans every pixel in the image (or just the ROI — see later). When it finds a pixel above the threshold that hasn't been visited yet, it starts a **BFS (Breadth-First Search) flood fill** to find all connected pixels that are also above the threshold.

BFS works like this:
1. Put the starting pixel in a queue.
2. Pull a pixel out of the queue.
3. Look at its 4 neighbors (up, down, left, right).
4. If a neighbor is above the threshold and hasn't been visited, add it to the queue.
5. Repeat until the queue is empty.

The result is one "blob": a set of connected pixels. For each blob we record:
- **Centroid** — the brightness-weighted average position (weighted centroid gives better precision than a simple average because it weights the brightest pixels more heavily, which is where the laser is actually pointing)
- **Area** — number of pixels
- **Peak brightness** — the maximum pixel value in the blob

Blobs smaller than 1 pixel or larger than 300 pixels are discarded (a laser dot at 480p is 1–150 pixels; larger blobs are background noise or sensor artifacts).

Blobs whose peak brightness is below `minBrightness` (default 220, matching `trackingThreshold`) are also discarded. This filters blobs that barely cleared the threshold — a real laser reads 240–255.

```typescript
// src/engine/IRDetector.ts — findBlobs()
if (area >= 1 && area <= 300 && wSum > 0 && maxB >= minBrightness) {
  blobs.push({ cx: wSumX / wSum, cy: wSumY / wSum, area, maxBrightness: maxB });
}
```

A second pre-allocated buffer, `visitedBuf`, tracks which pixels have been added to the BFS queue. It's zeroed at the start of each frame (or just the ROI region, for efficiency).

---

### Step 3: New Blob = Shot

This is the core detection logic. The key insight from the original SLDriver (Smokeless Range's detection engine) is:

> **A blob that was NOT present in the previous frame is a shot.**

The laser fires for ~10–50ms — long enough for the camera to capture it in one or a few frames, but short enough that it will disappear quickly. So the detection algorithm compares each frame's blobs against the previous frame's blobs.

A blob is considered "new" if its centroid is farther than `shotConnectedDistance` pixels away from every blob in the previous frame.

`shotConnectedDistance` is configured in **camera-resolution pixels** (same units as SLDriver's `ShotConnectedDistance` parameter). Internally, since frames are processed at 480p (downscaled for speed), the distance is divided by `scaleX` before comparison.

The distance check uses **squared distance** to avoid computing a square root on every pair:

```typescript
// src/engine/IRDetector.ts — isNewBlob()
private isNewBlob(blob: Blob): boolean {
  const dist = this.config.shotConnectedDistance / this.scaleX;
  const distSq = dist * dist;
  for (const prev of this.previousBlobs) {
    const dx = blob.cx - prev.cx;
    const dy = blob.cy - prev.cy;
    if (dx * dx + dy * dy <= distSq) return false; // same blob as before
  }
  return true; // appeared from nowhere — this is a shot
}
```

At the end of each frame, the current frame's blobs are saved as `previousBlobs` for the next frame's comparison.

---

### Step 4: Hot Pixel Masking

Some camera sensors have "hot pixels" — individual pixels that always read bright regardless of what they're pointing at. These would be detected as persistent blobs and trigger false shots.

The fix: if a blob appears at the same position in **90 or more consecutive frames**, it's almost certainly a sensor defect, not a laser. It gets added to the `hotPixels` set and ignored for detection. After 8 seconds without reappearing, it's removed from the set (in case the camera was moved).

Position is tracked in a quantized grid (8×8 pixel cells at processing resolution) to handle sub-pixel drift in the centroid from frame to frame.

```typescript
// src/engine/IRDetector.ts — updateHotPixels()
if (count >= this.hotPixelLimit && !this.hotPixels.has(key)) {
  this.hotPixels.add(key);
  this.hotPixelTimestamps.set(key, now);
}
```

The `quantize` function encodes (x, y) as a single number to avoid string allocation in the hot path:

```typescript
private quantize(x: number, y: number): number {
  const g = this.hotPixelGrid; // 8px grid
  return Math.round(x / g) * 65536 + Math.round(y / g);
}
```

---

### Step 5: ThresholdBump (Auto-adjustment)

The configured `trackingThreshold` is the baseline. But in practice, the threshold may need to drift up or down depending on ambient light, projector brightness, or camera sensor drift.

**ThresholdBump** (from SLDriver's parameter of the same name) automatically adjusts the working threshold:

- **Too many blobs on average** (rolling 30-frame window > 4 blobs): the threshold is too low — there's projector bleed-through or ambient IR. Raise the threshold by `thresholdBumpStep`.
- **Zero blobs for 90 consecutive frames**: the threshold may have drifted too high. Lower it back toward the configured base by one `thresholdBumpStep`.
- The threshold is capped at `min(254, baseThreshold + 40)` to prevent runaway growth.
- `thresholdBumpStep = 0` disables auto-adjustment entirely.

The rolling average uses a running sum (`blobCountSum`) instead of re-summing the array each frame, keeping it O(1) per frame:

```typescript
// src/engine/IRDetector.ts — applyThresholdBump()
this.blobCountHistory.push(activeBlobCount);
this.blobCountSum += activeBlobCount;
if (this.blobCountHistory.length > this.blobCountWindow) {
  this.blobCountSum -= this.blobCountHistory.shift()!;
}
const avgBlobs = this.blobCountSum / this.blobCountHistory.length;
```

---

### Step 6: Shot Cooldown

After a shot is registered, the detector ignores new blobs for `shotCooldown` milliseconds (default 100ms, matching SLDriver's `shotDelay = 0.10`). This prevents a single trigger pull — which may cause the laser to pulse briefly across multiple frames — from registering as two or three shots.

```typescript
// src/engine/IRDetector.ts — processFrame()
if (now - this.lastShotTime > cooldown) {
  // ... check for new blobs
}
```

---

### Performance Optimizations

Processing 120 frames per second with full pixel scanning is CPU-intensive. Several optimizations keep it fast:

| Optimization | What it does |
|---|---|
| **Downscale to 480p** | Input frames are drawn onto a smaller OffscreenCanvas before pixel extraction. Reduces pixel count by 4–6× at 1080p. |
| **Pre-allocated buffers** | `brightBuf` and `visitedBuf` are allocated once and reused every frame. No garbage collection in the hot path. |
| **ROI scanning** | Only pixels inside the calibrated projected screen area are scanned. Cuts workload further by 50–80%. |
| **Squared distance** | `isNewBlob` avoids `Math.sqrt` by comparing `dx² + dy²` against `dist²`. |
| **Numeric hot pixel keys** | `quantize()` encodes positions as integers instead of strings. No string allocation in the 120Hz loop. |
| **Running sum** | `blobCountSum` tracks the rolling blob average in O(1) instead of calling `reduce()` each frame. |
| **setTimeout not rAF** | The detection loop uses `setTimeout(loop, 8)` (~120Hz) instead of `requestAnimationFrame` (capped at monitor refresh rate, throttled to 1fps when window is unfocused). |

---

### Code Walkthrough: IRDetector.ts

`src/engine/IRDetector.ts` — the complete detection engine.

```
constructor(config, width, height)
  │
  ├── Downscale resolution to max 480p height
  ├── Create OffscreenCanvas at processing resolution
  └── Allocate brightBuf and visitedBuf (Uint8Array, size = processWidth × processHeight)

processFrame(videoElement)   ← called ~120× per second
  │
  ├── 1. drawImage onto processing canvas (downscale)
  ├── 2. getImageData → compute max(R,G,B) into brightBuf
  ├── 3. findBlobs(threshold, roi)
  │     └── BFS flood fill for all pixel groups above threshold
  ├── 4. updateHotPixels(blobs, now)
  │     └── Count persistence; mask blobs at same position 90+ frames
  ├── 5. filter activeBlobs = blobs that aren't hot pixels
  ├── 6. applyThresholdBump(activeBlobs.length)
  │     └── Adjust currentThreshold up/down based on rolling avg blob count
  ├── 7. For each activeBlob: isNewBlob(blob)?
  │     └── Compare centroid to all previousBlobs by squared distance
  ├── 8. If new blob found and cooldown elapsed → shotDetected = true
  ├── 9. previousBlobs = activeBlobs  (save for next frame)
  └── 10. Return DetectionResult { position, brightness, shotDetected, stats }
```

---

## Part 2 — Camera-to-Screen Calibration

### The Problem: Two Coordinate Systems

The camera sees the world in **camera pixels** — the coordinate system of the camera sensor, e.g. (320, 240) at the center of a 640×480 camera image.

The projector displays content in **screen pixels** — the coordinate system of the projected image, e.g. (960, 540) at the center of a 1920×1080 projection.

These two coordinate systems are **completely different**:
- They have different resolutions
- The camera and projector are at different physical positions, so the same point on the wall appears at different coordinates in each
- The projector's lens and the camera's lens both cause perspective distortion

When the laser hits the wall at point P:
- The camera sees P at some camera coordinate, e.g. (422, 318)
- The projector's target has point P at some screen coordinate, e.g. (876, 612)

We need a mapping — a mathematical function — that converts camera coordinates to screen coordinates. That mapping is a **homography**.

---

### What a Homography Is

A homography is a 3×3 matrix that describes a perspective transformation between two flat planes (in this case, the camera image plane and the projector image plane, which are both views of the same flat wall).

It looks like this:

```
| sx |   | H0  H1  H2 |   | cx |
| sy | = | H3  H4  H5 | × | cy |   (in homogeneous coordinates)
|  w |   | H6  H7  H8 |   |  1 |
```

To convert a camera point (cx, cy) to a screen point (sx, sy):

```
w  = H6×cx + H7×cy + H8
sx = (H0×cx + H1×cy + H2) / w
sy = (H3×cx + H4×cy + H5) / w
```

The division by `w` is what makes it a *perspective* transform rather than a simple linear transform — it handles the fact that the camera and projector are at angles to the wall.

The 9 numbers (H0 through H8) define the complete mapping. With H8 fixed to 1 (a convention), there are 8 unknowns to solve for. This requires at least 4 known point pairs (each pair gives 2 equations, 4 pairs give 8 equations).

In code: `this.profile.homography` is a flat array of 9 numbers stored row-major.

---

### The Calibration Procedure

To find the homography, we need to know: "when the projector shows a dot at screen position (sx, sy), the camera sees it at camera position (cx, cy)."

The calibration screen does this automatically with a 5×5 grid of 25 points:

```
[Projector] ──── shows marker at known (sx, sy) ──▶ [Wall]
                                                         │
[Camera] ◀───── detects marker at (cx, cy) ─────────── ┘
App records: { screen: (sx, sy), camera: (cx, cy) }
```

Steps in `CalibrationScreen.tsx → runAutoCalibration()`:

1. **Blank the screen** and measure the ambient brightness. Any marker must be brighter than this baseline by at least 50%.
2. **Auto-adjust exposure**: lower the camera exposure until the blank screen reads below 40 brightness (so the markers will stand out). Save the exposure value for the shooting mode to reuse.
3. **For each of the 25 markers**:
   - Tell the projector to show a white dot at position (sx, sy)
   - Wait 600ms for the projector to render and the camera to settle
   - Sample 6 camera frames, find the brightest point in each
   - Average the positions across frames (reduces noise)
   - Record the pair { screen: marker_position, camera: detected_position }
   - Blank between markers to reset the camera
4. **Compute homography** from all 25 point pairs.
5. **Switch to tracking mode** (Brightness = −48) and test: shoot a few shots and verify they land where you aimed.
6. **Fine-tune** with manual ±2px nudge if needed.
7. **Save** the calibration profile to disk (SQLite via Electron IPC).

The `findBrightestPoint` function in `CalibrationScreen.tsx` does a two-pass scan: first a coarse scan (every 3rd pixel) to find the approximate peak, then a fine scan (full resolution) in a small window around it, followed by a brightness-weighted centroid for sub-pixel accuracy.

---

### Computing the Homography (DLT)

The algorithm is called **Direct Linear Transform (DLT)**. It turns the 8-unknown homography into a system of linear equations that can be solved with standard linear algebra.

For each point pair (cx, cy) → (sx, sy), the homography equation gives two linear equations with the 8 unknowns (h0 through h7, with h8 = 1):

```
cx*h0 + cy*h1 + h2 - sx*cx*h6 - sx*cy*h7 = sx
cx*h3 + cy*h4 + h5 - sy*cx*h6 - sy*cy*h7 = sy
```

All 25 point pairs together give a system of 50 equations with 8 unknowns. This is **overdetermined** (more equations than unknowns), so there's no exact solution — but we find the best-fit solution using **least-squares**.

The least-squares solution minimizes the total squared error across all point pairs. It's computed via the **normal equations**: if the system is `A × h = b`, the least-squares solution satisfies `(AᵀA) × h = Aᵀb`, which is an 8×8 system that has an exact solution.

The 8×8 system is solved using **Gaussian elimination with partial pivoting** — a standard numerical method that is robust to near-singular matrices.

```
// src/engine/CalibrationEngine.ts — computeHomography()
for each point pair:
  A.push([cx, cy, 1, 0, 0, 0, -sx*cx, -sx*cy])  // equation 1
  A.push([0, 0, 0, cx, cy, 1, -sy*cx, -sy*cy])   // equation 2

{ AtA, Atb } = normalEquations(A, b)   // build AᵀA and Aᵀb
h = solveLinear(AtA, Atb)              // Gaussian elimination
H = denormalize(h, Tc, Ts)             // undo Hartley normalization
```

---

### Hartley Normalization

Raw pixel coordinates like (1600, 900) span values of order ~1000. The DLT matrix `A` contains products of these values (e.g., `sx × cx ≈ 1,440,000`) alongside constants like 1. This causes the matrix to span 6+ orders of magnitude, and Gaussian elimination loses precision because of **floating-point cancellation** — subtracting nearly equal large numbers destroys significant digits.

The fix is **Hartley normalization**:
1. Translate all points so their centroid is at the origin.
2. Scale all points so their mean distance from the origin is √2.

This is applied independently to the camera points and screen points, giving normalizing transforms Tₛ (screen) and T꜀ (camera). The DLT is solved in normalized space, then the result is denormalized:

```
H_real = Tₛ⁻¹ × H_normalized × T꜀
```

After normalization, all coordinates are order ~1, so the matrix is well-conditioned. The reprojection error (average distance between predicted and actual screen positions) is typically 1–5 pixels with 25 well-placed calibration points.

---

### Lens Distortion Correction

All camera lenses have some distortion — usually **barrel distortion** (the image curves outward, like a fisheye) or **pincushion distortion** (it curves inward). This makes straight lines look curved, and causes the homography to have higher error near the image edges.

The app estimates two **radial distortion coefficients** k1 and k2 automatically from the calibration residuals:

- After computing the homography, look at the error for each calibration point
- Points near the edges should have higher error due to lens distortion
- Fit k1 (error ∝ r²) and k2 (error ∝ r⁴) via 2×2 least-squares, where r is the camera-space distance from the image center

The undistortion formula (Brown-Conrady model):
```
r_undistorted ≈ r_distorted × (1 + k1×r² + k2×r⁴)
```

This is applied before the homography in `cameraToScreen`:
```typescript
// src/engine/CalibrationEngine.ts — cameraToScreen()
const undistorted = this.undistort(cameraPoint);  // ← lens correction first
const sx = (H[0]*undistorted.x + H[1]*undistorted.y + H[2]) / w;
const sy = (H[3]*undistorted.x + H[4]*undistorted.y + H[5]) / w;
```

k1 < 0 = barrel distortion (most webcams). k1 > 0 = pincushion. Values are clamped to ±0.5 to prevent runaway corrections from bad calibration data.

---

### Manual Offset Fine-Tuning

Even after a good calibration, there can be a small systematic offset — for example, if the laser-to-bore alignment of the gun isn't perfect, or if the projector has some lens shift. The **manual offset** (dx, dy in screen pixels) is applied after the homography:

```typescript
return {
  x: sx + this.profile.manualOffset.x,
  y: sy + this.profile.manualOffset.y,
};
```

The calibration screen's "Fine-Tune" step lets the user nudge this ±2 pixels at a time using arrow buttons.

A separate **per-weapon offset** (`WeaponProfile.shotOffsetX/Y`) handles laser-to-bore alignment per gun, applied in `ShootingScreen` after the calibration mapping. This means you can have multiple weapon profiles and switch between them without recalibrating.

---

### ROI (Region of Interest)

After calibration, we know exactly where the projected screen appears in the camera image (the 4 camera-space corners of the calibration point cloud). There's no point scanning pixels outside that region for a laser dot.

`getCameraROI()` computes the bounding box of all calibration-point camera coordinates with 10% padding, clamped to camera bounds. This region is passed to `IRDetector.setROI()`, which restricts the BFS scan to that region only.

```typescript
// src/engine/CalibrationEngine.ts — getCameraROI()
for (const p of points) {
  minX = Math.min(minX, p.camera.x);
  // ...
}
// Return bounding box with padding, clamped to camera resolution
```

In `IRDetector.findBlobs()`, when an ROI is set, `visitedBuf.fill(0)` only zeros the scan rows rather than the entire frame buffer — a meaningful saving when the ROI is a small fraction of the total frame.

---

### Code Walkthrough: CalibrationEngine.ts

```
CalibrationEngine
  │
  ├── computeHomography(points[])
  │     ├── normalizePoints(camera points) → { pts, Tₜ }
  │     ├── normalizePoints(screen points) → { pts, Tₛ }
  │     ├── Build DLT matrix A and vector b (2 rows per point)
  │     ├── If 4 points: solveLinear(A, b) — exact solution
  │     │   If >4 points: normalEquations → solveLinear — least-squares
  │     ├── denormalizeHomography(h, Tₜ, Tₛ) → H (3×3, H[8]=1)
  │     ├── Compute reprojectionError (avg px distance across all points)
  │     ├── estimateDistortion(points, H) → { k1, k2, cx, cy }
  │     └── Return updated CalibrationProfile
  │
  ├── cameraToScreen(cameraPoint)
  │     ├── undistort(point) using k1, k2
  │     ├── Apply homography (perspective divide by w)
  │     └── Add manualOffset
  │
  ├── getCameraROI(cameraWidth, cameraHeight)
  │     └── Bounding box of calibration-point camera coords + 10% padding
  │
  ├── nudgeOffset(dx, dy)   ← used by fine-tune arrows
  └── getProfile(), hasValidHomography()
```

---

### Code Walkthrough: CalibrationScreen.tsx

```
CalibrationScreen
  │
  ├── setup step
  │     └── User selects projector display, clicks "Open & Begin"
  │
  ├── projecting step (runAutoCalibration)
  │     ├── Blank projector
  │     ├── Auto-adjust camera exposure (lower until blank screen < 40 brightness)
  │     ├── Measure blank-screen baseline brightness
  │     ├── For each of 25 markers:
  │     │     ├── sendToProjector({ type: 'show-calibration-marker', position, markerIndex })
  │     │     ├── Wait 600ms
  │     │     ├── sampleBrightestPoint(6 frames, 60ms apart)
  │     │     │     └── findBrightestPoint: coarse scan → fine scan → weighted centroid
  │     │     ├── Reject if too dim (< baseline + 50%)
  │     │     └── Record { screen: markerPosition, camera: detectedPosition }
  │     └── CalibrationEngine.computeHomography(25 points)
  │
  ├── testing step
  │     ├── Switch to irTracking camera preset (Brightness = −48)
  │     ├── Run useDetectionLoop (live shot detection)
  │     └── Show live mapping: camera position → screen position → projector hit marker
  │
  ├── adjusting step
  │     └── nudgeOffset arrows → CalibrationEngine.nudgeOffset(dx, dy)
  │
  └── complete step
        └── dbSaveCalibration → SQLite via Electron IPC → setScreen('shooting')
```

---

## Part 3 — How Everything Connects

### Data Flow: Camera Frame to Registered Shot

```
Camera (60fps) ──▶ <video> element in the browser

useDetectionLoop (setTimeout ~120Hz)
  └── IRDetector.processFrame(videoElement)
        ├── Draw frame onto OffscreenCanvas (downscale to 480p)
        ├── Extract pixel data → brightBuf
        ├── findBlobs() → list of bright blobs
        ├── updateHotPixels() → filter persistent sensor defects
        ├── applyThresholdBump() → auto-adjust working threshold
        ├── isNewBlob() → compare to previousBlobs
        └── Return DetectionResult { position, brightness, shotDetected, stats }

ShootingScreen.handleFrame(result)
  ├── If result.shotDetected:
  │     ├── CalibrationEngine.cameraToScreen(result.position)
  │     │     ├── undistort(point)   ← lens correction
  │     │     └── apply homography  ← camera → screen coords
  │     ├── Add WeaponProfile offset (laser-to-bore alignment)
  │     ├── ScoringEngine.calculateScore(screenPosition)
  │     │     └── Distance from target center → scoring ring → score value
  │     ├── addShot(newShot) → Zustand store → React re-render
  │     ├── dbAddShot(...)   → SQLite via Electron IPC
  │     └── sendToProjector({ type: 'show-hit', position, score })
  │           └── ProjectorView draws hit marker on the projector canvas
  └── setIrPosition(screenPos) → updates live crosshair on TargetCanvas
```

---

### The Detection Loop Hook

`src/hooks/useDetectionLoop.ts` manages the IRDetector lifecycle as a React hook:

- Creates an `IRDetector` instance when the video element is ready.
- Updates `IRDetector.config` when settings change (without recreating the detector — preserving its state like hot pixels and threshold history).
- Runs the detection loop using `setTimeout(loop, 8)` (~120Hz) instead of `requestAnimationFrame`.

Why `setTimeout` instead of `requestAnimationFrame`?
- `requestAnimationFrame` is capped at the display refresh rate (60Hz).
- `requestAnimationFrame` is throttled to ~1fps when the app window loses focus (e.g., when you alt-tab). This would stop detecting shots while the window is in the background.
- `setTimeout(fn, 8)` runs at ~120Hz regardless of window focus or refresh rate.

---

### The Camera Hook

`src/hooks/useCamera.ts` handles camera access and preset switching:

- Calls `navigator.mediaDevices.getUserMedia()` to open the camera.
- Starts in **calibration mode** (brighter settings so calibration markers are clearly visible).
- `switchPreset('irTracking')` is called by `ShootingScreen` and `SpeedDrillScreen` before detection starts — this applies Brightness=−48 to make projected content fall below the detection threshold.
- `applyConstraints` sends settings to the camera driver. Not all cameras support all settings (e.g., some don't support manual exposure or brightness adjustment). The code uses optional chaining and try/catch to handle unsupported capabilities gracefully.

The `mapRange` function converts from the original Smokeless Range software's parameter space (Brightness −64 to +64, from CameraParameters.ini) to whatever range the connected camera reports via `getCapabilities()`:

```typescript
function mapRange(value, srcMin, srcMax, capRange) {
  const normalized = (value - srcMin) / (srcMax - srcMin); // 0..1
  return Math.round(capRange.min + (capRange.max - capRange.min) * normalized);
}
```

This makes the camera settings hardware-agnostic — the same target values work on any camera regardless of its driver's native scale.
