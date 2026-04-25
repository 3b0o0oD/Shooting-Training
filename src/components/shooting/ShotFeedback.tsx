import { motion } from 'framer-motion';
import type { Shot } from '../../types';

interface ShotFeedbackProps {
  shot: Shot;
}

/**
 * Animated feedback when a shot is detected.
 * Shows score popup, hit ring pulse, and screen flash.
 */
export function ShotFeedback({ shot }: ShotFeedbackProps) {
  const isBullseye = shot.score >= 10;
  const isGood = shot.score >= 8;
  // Warm color scheme: gold for good, amber for mid, red for poor
  const color = isBullseye ? '#4ade80' : isGood ? '#c8a35a' : shot.score >= 5 ? '#d97706' : '#dc3232';

  return (
    <>
      {/* Screen edge flash */}
      <motion.div
        initial={{ opacity: 0.5 }}
        animate={{ opacity: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="absolute inset-0 pointer-events-none z-30"
        style={{
          boxShadow: `inset 0 0 80px ${isBullseye ? 'rgba(74, 222, 128, 0.25)' : isGood ? 'rgba(200, 163, 90, 0.2)' : 'rgba(217, 119, 6, 0.15)'}`,
        }}
      />

      {/* Score popup */}
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.5 }}
        animate={{ opacity: 1, y: -60, scale: 1 }}
        exit={{ opacity: 0, y: -120, scale: 0.8 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        className="absolute z-40 pointer-events-none"
        style={{ left: '50%', top: '40%', transform: 'translateX(-50%)' }}
      >
        <div className="text-center">
          <div
            className="font-hud text-6xl font-black"
            style={{ color, textShadow: `0 0 20px ${color}, 0 0 50px ${color}` }}
          >
            {shot.score}
          </div>

          {isBullseye && (
            <motion.div
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, duration: 0.3 }}
              className="font-hud text-lg tracking-[0.3em] text-tactical-green text-glow-green"
            >
              BULLSEYE
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* Hit ring pulse */}
      <motion.div
        initial={{ scale: 0, opacity: 0.7 }}
        animate={{ scale: 3, opacity: 0 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        className="absolute pointer-events-none z-30"
        style={{
          left: '50%',
          top: '50%',
          width: 40,
          height: 40,
          marginLeft: -20,
          marginTop: -20,
          borderRadius: '50%',
          border: `2px solid ${color}`,
        }}
      />
    </>
  );
}
