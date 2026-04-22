/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        tactical: {
          dark: '#0a0e17',
          darker: '#060a12',
          panel: '#111827',
          border: '#1e293b',
          accent: '#00f0ff',
          'accent-dim': '#00a0aa',
          orange: '#ff6b00',
          red: '#ff2d55',
          green: '#00ff88',
          yellow: '#ffd600',
          muzzle: '#ffaa00',
        },
      },
      fontFamily: {
        tactical: ['Rajdhani', 'Orbitron', 'monospace'],
        hud: ['Orbitron', 'monospace'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      boxShadow: {
        'neon-cyan': '0 0 20px rgba(0, 240, 255, 0.3), 0 0 60px rgba(0, 240, 255, 0.1)',
        'neon-orange': '0 0 20px rgba(255, 107, 0, 0.3), 0 0 60px rgba(255, 107, 0, 0.1)',
        'neon-red': '0 0 20px rgba(255, 45, 85, 0.3), 0 0 60px rgba(255, 45, 85, 0.1)',
        'neon-green': '0 0 20px rgba(0, 255, 136, 0.3), 0 0 60px rgba(0, 255, 136, 0.1)',
      },
      animation: {
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'scan-line': 'scanLine 3s linear infinite',
        'fade-up': 'fadeUp 0.5s ease-out',
        'hit-ring': 'hitRing 0.8s ease-out forwards',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
        scanLine: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        hitRing: {
          '0%': { transform: 'scale(0)', opacity: '1' },
          '100%': { transform: 'scale(3)', opacity: '0' },
        },
      },
    },
  },
  plugins: [],
};
