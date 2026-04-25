/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        tactical: {
          dark: '#0a0704',
          darker: '#080502',
          panel: '#120e08',
          border: '#2a2010',
          accent: '#c8a35a',
          'accent-dim': '#8a7040',
          orange: '#d97706',
          red: '#dc3232',
          green: '#4ade80',
          yellow: '#fbbf24',
          muzzle: '#f59e0b',
        },
      },
      fontFamily: {
        tactical: ['Rajdhani', 'Orbitron', 'monospace'],
        hud: ['Orbitron', 'monospace'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      boxShadow: {
        'neon-gold': '0 0 20px rgba(200, 163, 90, 0.2), 0 0 60px rgba(200, 163, 90, 0.06)',
        'neon-orange': '0 0 20px rgba(217, 119, 6, 0.2), 0 0 60px rgba(217, 119, 6, 0.06)',
        'neon-red': '0 0 20px rgba(220, 50, 50, 0.2), 0 0 60px rgba(220, 50, 50, 0.06)',
        'neon-green': '0 0 20px rgba(74, 222, 128, 0.2), 0 0 60px rgba(74, 222, 128, 0.06)',
      },
      animation: {
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'scan-line': 'scanLine 4s linear infinite',
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
