import type { Point2D, CalibrationProfile, CalibrationPoint } from '../types';

/**
 * Calibration Engine — Homography-based camera-to-screen mapping
 *
 * The projector displays 4 known markers at screen coordinates.
 * The camera sees those markers at camera coordinates.
 * We compute a 3x3 homography matrix that maps any camera point → screen point.
 *
 * This handles perspective distortion from the camera viewing the projection
 * wall at an angle, different zoom levels, rotation, etc.
 */
export class CalibrationEngine {
  private profile: CalibrationProfile;

  constructor(profile: CalibrationProfile) {
    this.profile = profile;
  }

  /**
   * Transform a camera coordinate to a screen coordinate using the homography.
   * Returns null if no valid homography exists.
   */
  cameraToScreen(cameraPoint: Point2D): Point2D | null {
    const H = this.profile.homography;
    if (!H || H.length !== 9) return null;

    // Apply 3x3 homography: [x', y', w'] = H * [x, y, 1]
    const x = cameraPoint.x;
    const y = cameraPoint.y;

    const w = H[6] * x + H[7] * y + H[8];
    if (Math.abs(w) < 1e-10) return null; // Degenerate

    const sx = (H[0] * x + H[1] * y + H[2]) / w;
    const sy = (H[3] * x + H[4] * y + H[5]) / w;

    // Apply manual offset
    return {
      x: sx + this.profile.manualOffset.x,
      y: sy + this.profile.manualOffset.y,
    };
  }

  /**
   * Compute the homography from 4+ calibration point pairs.
   * Uses Direct Linear Transform (DLT) algorithm.
   *
   * Each pair: { screen: where we projected, camera: where camera saw it }
   * We want H such that: screen = H * camera
   */
  computeHomography(points: CalibrationPoint[]): CalibrationProfile {
    if (points.length < 4) {
      throw new Error('Need at least 4 calibration points for homography');
    }

    // Build the system of equations for DLT
    // For each point pair (camera → screen), we get 2 equations:
    // -x*h1 - y*h2 - h3 + sx*x*h7 + sx*y*h8 + sx*h9 = 0  (... but rearranged)
    //
    // We solve Ah = 0 where h = [h1..h9] flattened from H

    const n = points.length;
    const A: number[][] = [];

    for (const p of points) {
      const cx = p.camera.x;
      const cy = p.camera.y;
      const sx = p.screen.x;
      const sy = p.screen.y;

      A.push([cx, cy, 1, 0, 0, 0, -sx * cx, -sx * cy, -sx]);
      A.push([0, 0, 0, cx, cy, 1, -sy * cx, -sy * cy, -sy]);
    }

    // Solve using SVD-like approach (simplified for 4 points: solve 8x9 system)
    const H = this.solveDLT(A);

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

    this.profile = {
      ...this.profile,
      homography: H,
      calibrationPoints: points,
      reprojectionError,
      manualOffset: { x: 0, y: 0 },
    };

    return { ...this.profile };
  }

  /**
   * Solve the DLT system Ah = 0 using Gaussian elimination.
   * Returns the 9-element homography vector, normalized so h[8] = 1.
   */
  private solveDLT(A: number[][]): number[] {
    const rows = A.length;  // 2*n (at least 8)
    const cols = 9;

    // We need to solve for the null space of A.
    // For exactly 4 points (8 equations, 9 unknowns), we can set h[8]=1
    // and solve the 8x8 system.

    // Build 8x8 system: move the h[8] column to the right side
    const M: number[][] = [];
    const b: number[] = [];

    for (let i = 0; i < Math.min(rows, 8); i++) {
      const row: number[] = [];
      for (let j = 0; j < 8; j++) {
        row.push(A[i][j]);
      }
      M.push(row);
      b.push(-A[i][8]); // Move h[8]=1 term to RHS
    }

    // Gaussian elimination with partial pivoting
    const n = 8;
    for (let col = 0; col < n; col++) {
      // Find pivot
      let maxVal = Math.abs(M[col][col]);
      let maxRow = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(M[row][col]) > maxVal) {
          maxVal = Math.abs(M[row][col]);
          maxRow = row;
        }
      }

      // Swap rows
      if (maxRow !== col) {
        [M[col], M[maxRow]] = [M[maxRow], M[col]];
        [b[col], b[maxRow]] = [b[maxRow], b[col]];
      }

      // Eliminate below
      for (let row = col + 1; row < n; row++) {
        const factor = M[row][col] / M[col][col];
        for (let j = col; j < n; j++) {
          M[row][j] -= factor * M[col][j];
        }
        b[row] -= factor * b[col];
      }
    }

    // Back substitution
    const h = new Array(8).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let sum = b[i];
      for (let j = i + 1; j < n; j++) {
        sum -= M[i][j] * h[j];
      }
      h[i] = sum / M[i][i];
    }

    // h[8] = 1
    return [...h, 1];
  }

  /**
   * Nudge the manual offset (applied after homography transform)
   */
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

  /**
   * Reset manual offset
   */
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
}
