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
  const hue = (shot.score / 10) * 120;
  const color = `hsl(${hue}, 100%, 50%)`;
  const isBullseye = shot.score >= 10;

  return (
    <>
      {/* Screen edge flash */}
      <motion.div
        initial={{ opacity: 0.6 }}
        animate={{ opacity: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="absolute inset-0 pointer-events-none z-30"
        style={{
          boxShadow: `inset 0 0 100px ${isBullseye ? 'rgba(0, 255, 136, 0.3)' : 'rgba(255, 107, 0, 0.2)'}`,
        }}
      />

      {/* Score popup */}
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.5 }}
        animate={{ opacity: 1, y: -60, scale: 1 }}
        exit={{ opacity: 0, y: -120, scale: 0.8 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        className="absolute z-40 pointer-events-none"
        style={{
          left: '50%',
          top: '40%',
          transform: 'translateX(-50%)',
        }}
      >
        <div className="text-center">
          {/* Score number */}
          <div
            className="font-hud text-6xl font-black"
            style={{
              color,
              textShadow: `0 0 20px ${color}, 0 0 60px ${color}`,
            }}
          >
            {shot.score}
          </div>

          {/* Bullseye text */}
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

      {/* Hit ring pulse effect */}
      <motion.div
        initial={{ scale: 0, opacity: 0.8 }}
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
