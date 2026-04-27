import { useState } from 'react';
import { motion } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';

/**
 * Weapon Zeroing — placeholder that uses the Python detector.
 * TODO: implement full zeroing flow with useDetector hook.
 */
export function WeaponZeroScreen() {
  const { setScreen } = useAppStore();

  return (
    <div className="w-full h-full flex flex-col items-center justify-center relative bg-tactical-darker">
      <div className="absolute inset-0 tactical-grid opacity-30" />
      <div className="relative z-10 text-center space-y-6">
        <h2 className="font-hud text-3xl text-tactical-yellow tracking-[0.2em]">WEAPON ZEROING</h2>
        <p className="text-slate-400 font-tactical">Coming soon — use Settings to adjust weapon offset manually.</p>
        <button className="btn-tactical" onClick={() => setScreen('main-menu')}>← Back</button>
      </div>
    </div>
  );
}
