import type { TargetConfig } from '../types';

/**
 * Built-in target library.
 *
 * Each target defines scoring rings as radiusPercent (0-1) of the total target radius.
 * These are rendered digitally on the projector — no physical target images needed.
 */

export const TARGET_LIBRARY: TargetConfig[] = [
  // ─── Standard Concentric Ring Targets ───
  {
    id: 'standard-10ring',
    name: 'Standard 10-Ring',
    scoringRings: [
      { score: 10, radiusPercent: 0.05 },
      { score: 9, radiusPercent: 0.15 },
      { score: 8, radiusPercent: 0.25 },
      { score: 7, radiusPercent: 0.35 },
      { score: 6, radiusPercent: 0.45 },
      { score: 5, radiusPercent: 0.55 },
      { score: 4, radiusPercent: 0.65 },
      { score: 3, radiusPercent: 0.75 },
      { score: 2, radiusPercent: 0.85 },
      { score: 1, radiusPercent: 1.0 },
    ],
    gaugingMethod: 'inward',
    bullseyeColor: '#ff2d55',
    backgroundColor: '#000000',
  },

  // ─── NSRA-style targets (proportions based on real ring diameters) ───
  {
    id: 'nsra-6yard',
    name: 'NSRA 6 Yard Air Rifle',
    scoringRings: [
      { score: 10, radiusPercent: 0.032 },   // 1.00mm / 31mm
      { score: 9, radiusPercent: 0.097 },
      { score: 8, radiusPercent: 0.177 },
      { score: 7, radiusPercent: 0.258 },
      { score: 6, radiusPercent: 0.339 },
      { score: 5, radiusPercent: 0.419 },
      { score: 4, radiusPercent: 0.500 },
      { score: 3, radiusPercent: 0.581 },
      { score: 2, radiusPercent: 0.661 },
      { score: 1, radiusPercent: 1.0 },
    ],
    gaugingMethod: 'inward',
    bullseyeColor: '#ff2d55',
    backgroundColor: '#000000',
  },
  {
    id: 'nsra-10m',
    name: 'NSRA 10m Air Rifle',
    scoringRings: [
      { score: 10, radiusPercent: 0.141 },   // 8.80mm / 31.20mm radius
      { score: 9, radiusPercent: 0.192 },
      { score: 8, radiusPercent: 0.244 },
      { score: 7, radiusPercent: 0.295 },
      { score: 6, radiusPercent: 0.346 },
      { score: 5, radiusPercent: 0.397 },
      { score: 4, radiusPercent: 0.449 },
      { score: 3, radiusPercent: 0.500 },
      { score: 2, radiusPercent: 0.551 },
      { score: 1, radiusPercent: 1.0 },
    ],
    gaugingMethod: 'outward',
    bullseyeColor: '#ff2d55',
    backgroundColor: '#000000',
  },
  {
    id: 'nsra-25yard',
    name: 'NSRA 25 Yard Prone',
    scoringRings: [
      { score: 10, radiusPercent: 0.126 },
      { score: 9, radiusPercent: 0.197 },
      { score: 8, radiusPercent: 0.268 },
      { score: 7, radiusPercent: 0.339 },
      { score: 6, radiusPercent: 0.410 },
      { score: 5, radiusPercent: 0.481 },
      { score: 4, radiusPercent: 0.553 },
      { score: 3, radiusPercent: 0.624 },
      { score: 2, radiusPercent: 0.695 },
      { score: 1, radiusPercent: 1.0 },
    ],
    gaugingMethod: 'outward',
    bullseyeColor: '#ff2d55',
    backgroundColor: '#000000',
  },
  {
    id: 'nsra-50yard',
    name: 'NSRA 50 Yard Prone',
    scoringRings: [
      { score: 10, radiusPercent: 0.044 },
      { score: 9, radiusPercent: 0.115 },
      { score: 8, radiusPercent: 0.186 },
      { score: 7, radiusPercent: 0.257 },
      { score: 6, radiusPercent: 0.329 },
      { score: 5, radiusPercent: 0.400 },
      { score: 4, radiusPercent: 0.471 },
      { score: 1, radiusPercent: 1.0 },
    ],
    gaugingMethod: 'inward',
    bullseyeColor: '#ff2d55',
    backgroundColor: '#000000',
  },
  {
    id: 'nsra-100yard',
    name: 'NSRA 100 Yard Prone',
    scoringRings: [
      { score: 10, radiusPercent: 0.064 },
      { score: 9, radiusPercent: 0.139 },
      { score: 8, radiusPercent: 0.214 },
      { score: 7, radiusPercent: 0.289 },
      { score: 6, radiusPercent: 0.364 },
      { score: 5, radiusPercent: 0.440 },
      { score: 4, radiusPercent: 0.515 },
      { score: 3, radiusPercent: 0.590 },
      { score: 2, radiusPercent: 0.665 },
      { score: 1, radiusPercent: 1.0 },
    ],
    gaugingMethod: 'inward',
    bullseyeColor: '#ff2d55',
    backgroundColor: '#000000',
  },

  // ─── Fun / Training targets ───
  {
    id: 'bullseye-simple',
    name: 'Simple Bullseye (5 Ring)',
    scoringRings: [
      { score: 10, radiusPercent: 0.1 },
      { score: 8, radiusPercent: 0.3 },
      { score: 6, radiusPercent: 0.5 },
      { score: 4, radiusPercent: 0.7 },
      { score: 2, radiusPercent: 1.0 },
    ],
    gaugingMethod: 'inward',
    bullseyeColor: '#ff2d55',
    backgroundColor: '#000000',
  },
  {
    id: 'precision-small',
    name: 'Precision (Tight Rings)',
    scoringRings: [
      { score: 10, radiusPercent: 0.02 },
      { score: 9, radiusPercent: 0.06 },
      { score: 8, radiusPercent: 0.12 },
      { score: 7, radiusPercent: 0.20 },
      { score: 6, radiusPercent: 0.30 },
      { score: 5, radiusPercent: 0.42 },
      { score: 4, radiusPercent: 0.56 },
      { score: 3, radiusPercent: 0.72 },
      { score: 2, radiusPercent: 0.88 },
      { score: 1, radiusPercent: 1.0 },
    ],
    gaugingMethod: 'inward',
    bullseyeColor: '#00ff88',
    backgroundColor: '#000000',
  },
  {
    id: 'speed-large',
    name: 'Speed Shooting (Large Zones)',
    scoringRings: [
      { score: 10, radiusPercent: 0.15 },
      { score: 8, radiusPercent: 0.35 },
      { score: 5, radiusPercent: 0.60 },
      { score: 2, radiusPercent: 1.0 },
    ],
    gaugingMethod: 'inward',
    bullseyeColor: '#ffd600',
    backgroundColor: '#000000',
  },
];

export function getTargetById(id: string): TargetConfig | undefined {
  return TARGET_LIBRARY.find((t) => t.id === id);
}
