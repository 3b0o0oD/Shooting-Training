import type { TargetConfig } from '../types';

/**
 * Shared canvas target drawing used by both ProjectorView (projector window)
 * and TargetCanvas (control screen mirror).
 *
 * cx/cy/targetRadius are all in canvas display pixels — callers are responsible
 * for mapping from projector coordinates to their own canvas space.
 */
export function drawTargetOnCanvas(
  ctx: CanvasRenderingContext2D,
  target: TargetConfig,
  cx: number,
  cy: number,
  targetRadius: number,
) {
  if (target.targetStyle === 'disc') {
    drawDiscTarget(ctx, target, cx, cy, targetRadius);
  } else {
    drawClassicTarget(ctx, target, cx, cy, targetRadius);
  }
}

// ─── Disc style ───────────────────────────────────────────────────────────────
// Black aiming disc on cream paper, white ring lines inside the disc.
// Used by: 1989 10m Air Rifle and similar ISSF-style targets.

function drawDiscTarget(
  ctx: CanvasRenderingContext2D,
  target: TargetConfig,
  cx: number,
  cy: number,
  targetRadius: number,
) {
  const rings = [...target.scoringRings].sort((a, b) => a.radiusPercent - b.radiusPercent);
  const maxScore = Math.max(...rings.map(r => r.score));

  // The black disc outer edge is defined as the ring where the visible black area ends.
  // We treat score 3 (or the score just above score 1) as the disc boundary.
  // Everything from that ring outward is cream paper.
  const discBoundaryRing = rings.find(r => r.score === 3) ?? rings.find(r => r.score === 2);
  const discRadius = (discBoundaryRing?.radiusPercent ?? 0.73) * targetRadius;

  // 1. Cream paper background (fills the whole canvas area around the target)
  const paper = target.backgroundColor ?? '#c8a882';
  ctx.fillStyle = paper;
  ctx.beginPath();
  ctx.arc(cx, cy, targetRadius, 0, Math.PI * 2);
  ctx.fill();

  // Faint ring lines on the cream paper (scores 1-3) — subtle, for reference only
  const paperRings = rings.filter(r => r.radiusPercent > (discBoundaryRing?.radiusPercent ?? 0.73));
  for (const ring of paperRings) {
    ctx.beginPath();
    ctx.arc(cx, cy, ring.radiusPercent * targetRadius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  // 2. Black aiming disc
  ctx.beginPath();
  ctx.arc(cx, cy, discRadius, 0, Math.PI * 2);
  ctx.fillStyle = '#000000';
  ctx.fill();

  // Thin white border at disc edge — matches the original target
  ctx.beginPath();
  ctx.arc(cx, cy, discRadius, 0, Math.PI * 2);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, targetRadius * 0.004);
  ctx.stroke();

  // 3. White ring lines inside the disc (scores 4 and above, excluding the centre dot)
  const internalRings = rings.filter(
    r => r.score >= 4 && r.score < maxScore && r.radiusPercent <= (discBoundaryRing?.radiusPercent ?? 0.73)
  );

  for (const ring of internalRings) {
    const r = ring.radiusPercent * targetRadius;
    // Even-numbered rings (4, 6, 8) are slightly thicker — these are the labeled rings
    const isLabeled = ring.score % 2 === 0;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = isLabeled
      ? Math.max(1.5, targetRadius * 0.006)
      : Math.max(0.8, targetRadius * 0.003);
    ctx.stroke();
  }

  // 4. Score labels at labeled rings (scores 4, 6, 8) along all 4 axes
  const labeledRings = rings.filter(r => r.score % 2 === 0 && r.score >= 4 && r.score < maxScore);
  const fontSize = Math.max(10, targetRadius * 0.06);
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.fillStyle = '#ffffff';

  for (const ring of labeledRings) {
    const r = ring.radiusPercent * targetRadius;
    const label = String(ring.score);
    const pad = fontSize * 0.55;

    // Top
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, cx, cy - r + pad);

    // Bottom
    ctx.textBaseline = 'top';
    ctx.fillText(label, cx, cy + r - pad);

    // Left
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx - r + pad * 1.2, cy);

    // Right
    ctx.textAlign = 'left';
    ctx.fillText(label, cx + r - pad * 1.2, cy);
  }

  // 5. White filled centre dot (bullseye / score 10)
  const bullseye = rings.find(r => r.score === maxScore);
  if (bullseye) {
    ctx.beginPath();
    ctx.arc(cx, cy, bullseye.radiusPercent * targetRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
}

// ─── Classic style ────────────────────────────────────────────────────────────
// White outer rings, black inner rings — traditional paper target look.

function drawClassicTarget(
  ctx: CanvasRenderingContext2D,
  target: TargetConfig,
  cx: number,
  cy: number,
  targetRadius: number,
) {
  const WHITE_ZONE_THRESHOLD = 4;

  // White paper circle
  ctx.beginPath();
  ctx.arc(cx, cy, targetRadius, 0, Math.PI * 2);
  ctx.fillStyle = target.backgroundColor ?? '#ffffff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const rings = [...target.scoringRings].sort((a, b) => b.radiusPercent - a.radiusPercent);
  for (const ring of rings) {
    const radius = ring.radiusPercent * targetRadius;

    ctx.fillStyle = ring.score > WHITE_ZONE_THRESHOLD ? '#000000'
      : ring.score % 2 === 0 ? '#ffffff' : '#f0f0f0';

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = ring.score > WHITE_ZONE_THRESHOLD ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (ring.score >= 1) {
      ctx.fillStyle = ring.score > WHITE_ZONE_THRESHOLD ? '#ffffff' : '#000000';
      ctx.font = `bold ${Math.max(12, targetRadius * 0.07)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(String(ring.score), cx, cy - radius + 2);
    }
  }

  const maxScore = Math.max(...rings.map(r => r.score));
  const bullseye = rings.find(r => r.score === maxScore);
  if (bullseye) {
    ctx.beginPath();
    ctx.arc(cx, cy, bullseye.radiusPercent * targetRadius, 0, Math.PI * 2);
    ctx.fillStyle = target.bullseyeColor ?? '#000000';
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(2, targetRadius * 0.01), 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}
