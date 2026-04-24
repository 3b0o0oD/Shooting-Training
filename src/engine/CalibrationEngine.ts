import type { Point2D, CalibrationProfile, CalibrationPoint } from '../types';

/**
 * Calibration Engine — Homography-based camera-to-screen mapping
 *
 * The projector displays markers at known screen coordinates.
 * The camera sees those markers at camera coordinates.
 * We compute a 3x3 homography matrix that maps any camera point → screen point.
 *
 * With 4 points we get an exact solution. With more points (8+) we get a
 * least-squares solution that is more robust to noise.
 */
export class CalibrationEngine {
  private profile: CalibrationProfile;

  constructor(profile: CalibrationProfile) {
    this.profile = profile;
  }

  /**
   * Transform a camera coordinate to a screen coordinate.
   * Pipeline (matches SLDriver): undistort → homography → manual offset.
   * "Shot distorted: %0.2f %0.2f" → "Shot undistorted: %0.2f %0.2f"
   */
  cameraToScreen(cameraPoint: Point2D): Point2D | null {
    const H = this.profile.homography;
    if (!H || H.length !== 9) return null;

    // Apply Brown-Conrady radial lens undistortion before homography.
    // k1, k2 are stored in the profile (estimated from calibration point residuals).
    const undistorted = this.undistort(cameraPoint);
    const x = undistorted.x;
    const y = undistorted.y;

    const w = H[6] * x + H[7] * y + H[8];
    if (Math.abs(w) < 1e-10) return null;

    const sx = (H[0] * x + H[1] * y + H[2]) / w;
    const sy = (H[3] * x + H[4] * y + H[5]) / w;

    return {
      x: sx + this.profile.manualOffset.x,
      y: sy + this.profile.manualOffset.y,
    };
  }

  /**
   * Brown-Conrady radial undistortion (barrel/pincushion).
   * r_u ≈ r_d * (1 + k1*r_d² + k2*r_d⁴) where r is distance from image center.
   * k1 < 0 = barrel distortion (most webcams). k1 > 0 = pincushion.
   * Coefficients are auto-estimated by computeHomography from point residuals.
   */
  private undistort(p: Point2D): Point2D {
    const k1 = this.profile.distortion?.k1 ?? 0;
    const k2 = this.profile.distortion?.k2 ?? 0;
    if (k1 === 0 && k2 === 0) return p;

    const cx = this.profile.distortion?.cx ?? 0;
    const cy = this.profile.distortion?.cy ?? 0;

    const dx = p.x - cx;
    const dy = p.y - cy;
    const r2 = dx * dx + dy * dy;
    const factor = 1 + k1 * r2 + k2 * r2 * r2;
    return { x: cx + dx * factor, y: cy + dy * factor };
  }

  /**
   * Compute the homography from 4+ calibration point pairs using DLT.
   * With more than 4 points, uses least-squares via the normal equations
   * (A^T A h = A^T b) for a more accurate, noise-resistant result.
   */
  computeHomography(points: CalibrationPoint[]): CalibrationProfile {
    if (points.length < 4) {
      throw new Error('Need at least 4 calibration points for homography');
    }

    // Hartley normalization: translate to centroid, scale so mean distance = √2.
    // Without this, the DLT normal-equations matrix spans 10+ orders of magnitude
    // (translation terms O(1920) vs perspective terms O(1/1920²)), causing
    // catastrophic floating-point loss in Gaussian elimination.
    const normCam = this.normalizePoints(points.map(p => p.camera));
    const normScr = this.normalizePoints(points.map(p => p.screen));

    // Build DLT in normalized space (h[8]=1, moved to RHS)
    const A: number[][] = [];
    const b: number[] = [];

    for (let i = 0; i < points.length; i++) {
      const cx = normCam.pts[i].x;
      const cy = normCam.pts[i].y;
      const sx = normScr.pts[i].x;
      const sy = normScr.pts[i].y;

      A.push([cx, cy, 1, 0, 0, 0, -sx * cx, -sx * cy]);
      b.push(sx);
      A.push([0, 0, 0, cx, cy, 1, -sy * cx, -sy * cy]);
      b.push(sy);
    }

    let h: number[];
    const rows = points.length * 2;
    if (rows === 8) {
      h = this.solveLinear(A, b);
    } else {
      const { AtA, Atb } = this.normalEquations(A, b);
      h = this.solveLinear(AtA, Atb);
    }

    // Denormalize: H_real = T_screen_inv × H_norm × T_cam
    const Hn = [...h, 1]; // 3×3 in normalized space
    const H = this.denormalizeHomography(Hn, normCam.T, normScr.T);

    // Calculate reprojection error
    let totalError = 0;
    for (const p of points) {
      const w = H[6] * p.camera.x + H[7] * p.camera.y + H[8];
      const px = (H[0] * p.camera.x + H[1] * p.camera.y + H[2]) / w;
      const py = (H[3] * p.camera.x + H[4] * p.camera.y + H[5]) / w;
      const dx = px - p.screen.x;
      const dy = py - p.screen.y;
      totalError += Math.sqrt(dx * dx + dy * dy);
    }
    const reprojectionError = totalError / points.length;

    // Estimate radial lens distortion from residuals.
    // Compute per-point error as a function of camera-space radius from image center.
    // Fit k1 (linear in r²) using least-squares. k2 set to 0 unless error is large.
    const distortion = this.estimateDistortion(points, H);

    this.profile = {
      ...this.profile,
      homography: H,
      calibrationPoints: points,
      reprojectionError,
      distortion,
      manualOffset: { x: 0, y: 0 },
    };

    return { ...this.profile };
  }

  /**
   * Estimate radial distortion coefficients k1, k2 from homography residuals.
   * For each calibration point, the difference between projected-by-H and actual
   * screen position correlates with barrel/pincushion distortion in the camera.
   * Fits k1 via 1D least-squares on the radial axis.
   */
  private estimateDistortion(points: CalibrationPoint[], H: number[]): { k1: number; k2: number; cx: number; cy: number } {
    // Image center (approximate principal point)
    const cxArr = points.map(p => p.camera.x);
    const cyArr = points.map(p => p.camera.y);
    const cx = cxArr.reduce((s, v) => s + v, 0) / cxArr.length;
    const cy = cyArr.reduce((s, v) => s + v, 0) / cyArr.length;

    // Build least-squares system: error_radial = k1 * r² + k2 * r⁴
    let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
    for (const p of points) {
      const dx = p.camera.x - cx;
      const dy = p.camera.y - cy;
      const r2 = dx * dx + dy * dy;
      const r4 = r2 * r2;
      const w = H[6] * p.camera.x + H[7] * p.camera.y + H[8];
      const px = (H[0] * p.camera.x + H[1] * p.camera.y + H[2]) / w;
      const py = (H[3] * p.camera.x + H[4] * p.camera.y + H[5]) / w;
      // Residual in camera space (approximate — proper iterative solve omitted for simplicity)
      const errX = p.screen.x - px;
      const errY = p.screen.y - py;
      // Project residual onto radial direction
      const r = Math.sqrt(r2);
      const err = r > 0 ? (errX * dx / r + errY * dy / r) : 0;
      a11 += r2 * r2; a12 += r2 * r4; a22 += r4 * r4;
      b1 += err * r2;  b2 += err * r4;
    }

    // Solve 2×2 system for k1, k2
    const det = a11 * a22 - a12 * a12;
    if (Math.abs(det) < 1e-20) return { k1: 0, k2: 0, cx, cy };
    const k1 = (b1 * a22 - b2 * a12) / det;
    const k2 = (a11 * b2 - a12 * b1) / det;

    // Sanity clamp — extreme values indicate bad calibration, not real distortion
    return {
      k1: Math.max(-0.5, Math.min(0.5, k1)),
      k2: Math.max(-0.5, Math.min(0.5, k2)),
      cx,
      cy,
    };
  }

  /**
   * Hartley normalization: translate points to centroid, scale so average
   * distance from origin is √2. Returns normalized points + 3×3 transform T.
   * T maps original → normalized: x_norm = T × x_orig (homogeneous).
   */
  private normalizePoints(pts: Point2D[]): { pts: Point2D[]; T: number[] } {
    const n = pts.length;
    let mx = 0, my = 0;
    for (const p of pts) { mx += p.x; my += p.y; }
    mx /= n; my /= n;

    let meanDist = 0;
    for (const p of pts) {
      meanDist += Math.sqrt((p.x - mx) ** 2 + (p.y - my) ** 2);
    }
    meanDist /= n;

    const scale = meanDist < 1e-8 ? 1 : Math.SQRT2 / meanDist;

    // T = [scale, 0, -scale*mx; 0, scale, -scale*my; 0, 0, 1]
    const T = [scale, 0, -scale * mx, 0, scale, -scale * my, 0, 0, 1];

    const normalized = pts.map(p => ({
      x: scale * (p.x - mx),
      y: scale * (p.y - my),
    }));

    return { pts: normalized, T };
  }

  /**
   * Denormalize homography: H_real = T_screen_inv × H_norm × T_cam
   * where T matrices are 3×3 stored row-major as flat 9-element arrays.
   */
  private denormalizeHomography(Hn: number[], Tc: number[], Ts: number[]): number[] {
    // Invert Ts (similarity transform — easy closed form)
    const s = Ts[0]; // scale
    const tx = Ts[2]; const ty = Ts[5];
    // Ts_inv = [1/s, 0, -tx/s; 0, 1/s, -ty/s; 0, 0, 1]
    const TsInv = [1/s, 0, -tx/s, 0, 1/s, -ty/s, 0, 0, 1];

    const mat3mul = (A: number[], B: number[]): number[] => {
      const C = new Array(9).fill(0);
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++)
          for (let k = 0; k < 3; k++)
            C[r*3+c] += A[r*3+k] * B[k*3+c];
      return C;
    };

    const H = mat3mul(mat3mul(TsInv, Hn), Tc);
    // Normalize so H[8] = 1
    if (Math.abs(H[8]) > 1e-10) {
      const inv = 1 / H[8];
      return H.map(v => v * inv);
    }
    return H;
  }

  /**
   * Compute A^T A and A^T b for least-squares.
   */
  private normalEquations(A: number[][], b: number[]): { AtA: number[][]; Atb: number[] } {
    const m = A.length;    // rows
    const n = A[0].length; // cols (8)

    const AtA: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    const Atb: number[] = new Array(n).fill(0);

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let sum = 0;
        for (let k = 0; k < m; k++) {
          sum += A[k][i] * A[k][j];
        }
        AtA[i][j] = sum;
      }
      let sum = 0;
      for (let k = 0; k < m; k++) {
        sum += A[k][i] * b[k];
      }
      Atb[i] = sum;
    }

    return { AtA, Atb };
  }

  /**
   * Solve an n×n linear system Mx = rhs using Gaussian elimination
   * with partial pivoting.
   */
  private solveLinear(M_in: number[][], rhs_in: number[]): number[] {
    const n = M_in.length;
    // Clone to avoid mutating input
    const M = M_in.map((row) => [...row]);
    const rhs = [...rhs_in];

    // Forward elimination
    for (let col = 0; col < n; col++) {
      // Partial pivoting
      let maxVal = Math.abs(M[col][col]);
      let maxRow = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(M[row][col]) > maxVal) {
          maxVal = Math.abs(M[row][col]);
          maxRow = row;
        }
      }
      if (maxRow !== col) {
        [M[col], M[maxRow]] = [M[maxRow], M[col]];
        [rhs[col], rhs[maxRow]] = [rhs[maxRow], rhs[col]];
      }

      // Eliminate below
      for (let row = col + 1; row < n; row++) {
        const factor = M[row][col] / M[col][col];
        for (let j = col; j < n; j++) {
          M[row][j] -= factor * M[col][j];
        }
        rhs[row] -= factor * rhs[col];
      }
    }

    // Back substitution
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let sum = rhs[i];
      for (let j = i + 1; j < n; j++) {
        sum -= M[i][j] * x[j];
      }
      x[i] = sum / M[i][i];
    }

    return x;
  }

  nudgeOffset(dx: number, dy: number): CalibrationProfile {
    this.profile = {
      ...this.profile,
      manualOffset: {
        x: this.profile.manualOffset.x + dx,
        y: this.profile.manualOffset.y + dy,
      },
    };
    return { ...this.profile };
  }

  resetOffset(): CalibrationProfile {
    this.profile = {
      ...this.profile,
      manualOffset: { x: 0, y: 0 },
    };
    return { ...this.profile };
  }

  getProfile(): CalibrationProfile {
    return { ...this.profile };
  }

  hasValidHomography(): boolean {
    return (
      this.profile.homography.length === 9 &&
      this.profile.homography.some((v) => v !== 0)
    );
  }

  /**
   * Compute the camera-space bounding box of the projected screen area.
   * Uses the calibration points to determine where the screen appears
   * in the camera frame. Returns an ROI with some padding.
   */
  getCameraROI(cameraWidth: number, cameraHeight: number, padding = 0.1): { x: number; y: number; w: number; h: number } | null {
    const points = this.profile.calibrationPoints;
    if (points.length < 4) return null;

    // Get the bounding box of all camera-side calibration points
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.camera.x);
      minY = Math.min(minY, p.camera.y);
      maxX = Math.max(maxX, p.camera.x);
      maxY = Math.max(maxY, p.camera.y);
    }

    // Add padding (percentage of the ROI size)
    const roiW = maxX - minX;
    const roiH = maxY - minY;
    const padX = roiW * padding;
    const padY = roiH * padding;

    // Clamp to camera bounds
    const x = Math.max(0, Math.floor(minX - padX));
    const y = Math.max(0, Math.floor(minY - padY));
    const w = Math.min(cameraWidth - x, Math.ceil(roiW + padX * 2));
    const h = Math.min(cameraHeight - y, Math.ceil(roiH + padY * 2));

    return { x, y, w, h };
  }
}
