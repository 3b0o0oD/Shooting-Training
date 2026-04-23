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
   * Transform a camera coordinate to a screen coordinate using the homography.
   */
  cameraToScreen(cameraPoint: Point2D): Point2D | null {
    const H = this.profile.homography;
    if (!H || H.length !== 9) return null;

    const x = cameraPoint.x;
    const y = cameraPoint.y;

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
   * Compute the homography from 4+ calibration point pairs using DLT.
   * With more than 4 points, uses least-squares via the normal equations
   * (A^T A h = A^T b) for a more accurate, noise-resistant result.
   */
  computeHomography(points: CalibrationPoint[]): CalibrationProfile {
    if (points.length < 4) {
      throw new Error('Need at least 4 calibration points for homography');
    }

    // Build the DLT equation system.
    // For each point pair we get 2 rows in A.
    // We set h[8] = 1 and move that column to the RHS.
    const rows = points.length * 2;
    const A: number[][] = [];
    const b: number[] = [];

    for (const p of points) {
      const cx = p.camera.x;
      const cy = p.camera.y;
      const sx = p.screen.x;
      const sy = p.screen.y;

      // Row for sx equation
      A.push([cx, cy, 1, 0, 0, 0, -sx * cx, -sx * cy]);
      b.push(sx); // moved -sx * h8 to RHS, h8=1 → RHS = sx

      // Row for sy equation
      A.push([0, 0, 0, cx, cy, 1, -sy * cx, -sy * cy]);
      b.push(sy);
    }

    let h: number[];

    if (rows === 8) {
      // Exactly 4 points → direct solve (8×8 system)
      h = this.solveLinear(A, b);
    } else {
      // Over-determined → least-squares via normal equations: (A^T A) h = A^T b
      const { AtA, Atb } = this.normalEquations(A, b);
      h = this.solveLinear(AtA, Atb);
    }

    const H = [...h, 1]; // h[8] = 1

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
