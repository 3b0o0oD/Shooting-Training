import { motion } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';
import { ParticleField } from '../components/effects/ParticleField';

const menuItems = [
  {
    label: 'Start Shooting',
    screen: 'shooting' as const,
    description: 'Begin a live shooting session',
    color: 'cyan',
  },
  {
    label: 'Calibration',
    screen: 'calibration' as const,
    description: 'Setup and calibrate your system',
    color: 'orange',
  },
  {
    label: 'Results',
    screen: 'results' as const,
    description: 'View session history and stats',
    color: 'green',
  },
  {
    label: 'Settings',
    screen: 'settings' as const,
    description: 'Configure targets, cameras, and detection',
    color: 'yellow',
  },
];

const colorMap: Record<string, string> = {
  cyan: '#00f0ff',
  orange: '#ff6b00',
  green: '#00ff88',
  yellow: '#ffd600',
};

export function MainMenu() {
  const setScreen = useAppStore((s) => s.setScreen);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center relative">
      {/* Background effects */}
      <ParticleField />
      <div className="scan-line absolute inset-0 pointer-events-none" />

      {/* Vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 40%, rgba(6,10,18,0.8) 100%)',
        }}
      />

      {/* Logo */}
      <motion.div
        initial={{ opacity: 0, y: -40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        className="relative z-10 mb-16 text-center"
      >
        <h1 className="font-hud text-7xl font-black tracking-[0.2em] text-tactical-accent text-glow-cyan">
          SPLATT
        </h1>
        <div className="flex items-center justify-center gap-3 mt-3">
          <div className="h-px w-16 bg-gradient-to-r from-transparent to-tactical-accent/50" />
          <span className="font-tactical text-sm tracking-[0.4em] text-slate-400 uppercase">
            Target Training System
          </span>
          <div className="h-px w-16 bg-gradient-to-l from-transparent to-tactical-accent/50" />
        </div>
      </motion.div>

      {/* Menu items */}
      <div className="relative z-10 flex flex-col gap-3 w-full max-w-md px-8">
        {menuItems.map((item, index) => (
          <motion.button
            key={item.screen}
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.3 + index * 0.1 }}
            onClick={() => setScreen(item.screen)}
            className="group relative flex items-center gap-4 px-6 py-4 text-left transition-all duration-200 hover:pl-8"
            style={{
              border: `1px solid ${colorMap[item.color]}22`,
              background: `linear-gradient(135deg, ${colorMap[item.color]}05, transparent)`,
              clipPath:
                'polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px))',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = `${colorMap[item.color]}66`;
              e.currentTarget.style.background = `linear-gradient(135deg, ${colorMap[item.color]}15, transparent)`;
              e.currentTarget.style.boxShadow = `0 0 30px ${colorMap[item.color]}15, inset 0 0 30px ${colorMap[item.color]}05`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = `${colorMap[item.color]}22`;
              e.currentTarget.style.background = `linear-gradient(135deg, ${colorMap[item.color]}05, transparent)`;
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            {/* Index number */}
            <span
              className="font-hud text-2xl font-bold opacity-30 group-hover:opacity-70 transition-opacity"
              style={{ color: colorMap[item.color] }}
            >
              {String(index + 1).padStart(2, '0')}
            </span>

            {/* Text */}
            <div className="flex-1">
              <div
                className="font-tactical text-lg font-semibold tracking-wider uppercase transition-colors"
                style={{ color: colorMap[item.color] }}
              >
                {item.label}
              </div>
              <div className="text-xs text-slate-500 font-tactical tracking-wide">
                {item.description}
              </div>
            </div>

            {/* Arrow */}
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              className="opacity-0 group-hover:opacity-70 transition-all transform group-hover:translate-x-1"
              style={{ stroke: colorMap[item.color] }}
              strokeWidth="1.5"
            >
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </motion.button>
        ))}
      </div>

      {/* Footer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        className="absolute bottom-6 text-center z-10"
      >
        <p className="text-[10px] text-slate-600 font-mono tracking-wider">
          IR DETECTION SYSTEM • CAMERA BASED • NO AUDIO
        </p>
      </motion.div>
    </div>
  );
}
