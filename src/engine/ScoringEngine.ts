import type { Point2D, TargetConfig, ProjectionConfig } from '../types';

/**
 * Scoring Engine — Screen/Projection based
 *
 * Since the target is projected on screen, scoring works in screen pixels.
 * The target center and radius are known from the ProjectionConfig.
 * Shot positions are already in screen coordinates (after homography).
 */
export class ScoringEngine {
  private target: TargetConfig;
  private targetCenter: Point2D;
  private targetRadiusPx: number;

  constructor(target: TargetConfig, projection: ProjectionConfig) {
    this.target = target;

    // Target is centered on screen (with optional offset)
    const shortSide = Math.min(projection.width, projection.height);
    this.targetRadiusPx = (shortSide * projection.targetSizePercent) / 200; // /2 for radius, /100 for percent

    this.targetCenter = {
      x: projection.width / 2 + projection.targetOffset.x,
      y: projection.height / 2 + projection.targetOffset.y,
    };
  }

  /**
   * Calculate the score for a shot at the given screen position.
   */
  calculateScore(screenPosition: Point2D): number {
    const dx = screenPosition.x - this.targetCenter.x;
    const dy = screenPosition.y - this.targetCenter.y;
    const distFromCenter = Math.sqrt(dx * dx + dy * dy);

    // Normalize distance: 0 = center, 1 = edge of target
    const normalizedDist = distFromCenter / this.targetRadiusPx;

    // Find the highest scoring ring the shot falls within
    // Rings are sorted highest score first (10, 9, 8...)
    for (const ring of this.target.scoringRings) {
      if (normalizedDist <= ring.radiusPercent) {
        return ring.score;
      }
    }

    return 0; // Off target
  }

  /**
   * Get distance from target center in pixels and as a normalized value
   */
  getDistanceFromCenter(screenPosition: Point2D): {
    pixels: number;
    normalized: number;
    angle: number;
  } {
    const dx = screenPosition.x - this.targetCenter.x;
    const dy = screenPosition.y - this.targetCenter.y;
    const pixels = Math.sqrt(dx * dx + dy * dy);
    return {
      pixels,
      normalized: pixels / this.targetRadiusPx,
      angle: Math.atan2(dy, dx),
    };
  }

  getTargetCenter(): Point2D {
    return { ...this.targetCenter };
  }

  getTargetRadius(): number {
    return this.targetRadiusPx;
  }
}
