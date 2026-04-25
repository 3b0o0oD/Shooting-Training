import { motion } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';
import menuBg from '../assets/main-menu-bg.png';

const menuItems = [
  { label: 'Start Shooting', screen: 'shooting' as const, primary: true },
  { label: 'Speed Drill', screen: 'speed-drill' as const, primary: false },
  { label: 'Calibration', screen: 'calibration' as const, primary: false },
  { label: 'Settings', screen: 'settings' as const, primary: false },
];

export function MainMenu() {
  const setScreen = useAppStore((s) => s.setScreen);

  return (
    <div className="w-full h-full relative overflow-hidden">
      {/* Background image */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${menuBg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />

      {/* Left-side panel gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(to right, rgba(8,5,2,0.97) 0%, rgba(8,5,2,0.93) 32%, rgba(8,5,2,0.6) 52%, rgba(8,5,2,0.15) 70%, transparent 85%)',
        }}
      />

      {/* Top / bottom vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(to bottom, rgba(8,5,2,0.55) 0%, transparent 22%, transparent 78%, rgba(8,5,2,0.75) 100%)',
        }}
      />

      {/* Scan-line overlay */}
      <div className="scan-line absolute inset-0 pointer-events-none" />

      {/* Left content column */}
      <div
        className="relative z-10 h-full flex flex-col justify-center pl-14"
        style={{ maxWidth: 500 }}
      >
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className="mb-12"
        >
          {/* Tag */}
          <div className="flex items-center gap-2 mb-5">
            <div className="w-1.5 h-1.5 rotate-45 bg-amber-600" />
            <span className="font-mono text-xs tracking-[0.35em] uppercase text-amber-900/70">
              Tactical Training System
            </span>
          </div>

          {/* Title */}
          <h1
            className="font-hud font-black leading-none tracking-[0.12em]"
            style={{
              fontSize: '5rem',
              color: '#f0deb0',
              textShadow: '0 2px 32px rgba(200,155,50,0.22)',
            }}
          >
            ZERO
          </h1>
          <div
            className="font-hud font-bold tracking-[0.38em] mt-1"
            style={{ fontSize: '2.4rem', color: '#c8a35a' }}
          >
            Bullet
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 mt-5">
            <div
              className="h-px w-16"
              style={{
                background: 'linear-gradient(to right, #b8903a, transparent)',
              }}
            />
            <span className="font-mono text-xs tracking-[0.3em] text-amber-900/50">
              PoC v0.1
            </span>
          </div>
        </motion.div>

        {/* Menu */}
        <nav className="flex flex-col">
          {menuItems.map((item, index) => (
            <motion.button
              key={item.screen}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.3 + index * 0.09 }}
              onClick={() => setScreen(item.screen)}
              className="group flex items-center gap-4 py-3.5 text-left transition-[padding] duration-200"
              onMouseEnter={(e) => {
                e.currentTarget.style.paddingLeft = '10px';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.paddingLeft = '0px';
              }}
            >
              {/* Index */}
              <span
                className={`font-mono text-xs w-5 shrink-0 transition-colors duration-200 ${
                  item.primary
                    ? 'text-amber-600'
                    : 'text-amber-900/40 group-hover:text-amber-700/60'
                }`}
              >
                {String(index + 1).padStart(2, '0')}
              </span>

              {/* Dash */}
              <div
                className={`h-px shrink-0 transition-all duration-300 ${
                  item.primary
                    ? 'w-5 bg-amber-500/80'
                    : 'w-3 bg-amber-900/40 group-hover:w-5 group-hover:bg-amber-600/60'
                }`}
              />

              {/* Label */}
              <span
                className={`font-tactical text-lg font-semibold tracking-[0.12em] uppercase transition-colors duration-200 ${
                  item.primary
                    ? 'text-amber-100 group-hover:text-white'
                    : 'text-amber-800/70 group-hover:text-amber-300'
                }`}
              >
                {item.label}
              </span>

              {/* Arrow */}
              <span className="ml-auto font-mono text-base text-amber-500 opacity-0 group-hover:opacity-50 transition-all duration-200 translate-x-0 group-hover:translate-x-1">
                ›
              </span>
            </motion.button>
          ))}
        </nav>

        {/* Exit button */}
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          onClick={() => window.electronAPI?.close()}
          className="group flex items-center gap-4 py-3.5 mt-6 text-left transition-[padding] duration-200 border-t border-amber-900/15 pt-5"
          onMouseEnter={(e) => { e.currentTarget.style.paddingLeft = '10px'; }}
          onMouseLeave={(e) => { e.currentTarget.style.paddingLeft = '0px'; }}
        >
          <span className="font-mono text-xs w-5 shrink-0 text-red-900/50 group-hover:text-red-600/70 transition-colors duration-200">
            ✕
          </span>
          <div className="h-px w-3 shrink-0 bg-red-900/30 group-hover:w-5 group-hover:bg-red-600/50 transition-all duration-300" />
          <span className="font-tactical text-lg font-semibold tracking-[0.12em] uppercase text-red-900/50 group-hover:text-red-500/80 transition-colors duration-200">
            Exit
          </span>
        </motion.button>

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.1 }}
          className="mt-14"
        >
          <div className="h-px w-10 bg-amber-900/30 mb-3" />
          {/* <p className="font-mono text-xs tracking-widest text-amber-900/40">
            FIELD OPERATIONS — AUTHORIZED USE ONLY
          </p> */}
        </motion.div>
      </div>
    </div>
  );
}
