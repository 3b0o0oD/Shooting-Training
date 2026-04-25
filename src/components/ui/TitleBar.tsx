import { useState, useEffect } from 'react';

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    api.isMaximized().then(setIsMaximized);

    const cleanupMax = api.onMaximizeChanged(setIsMaximized);
    const cleanupFs = api.onFullscreenChanged(setIsFullscreen);
    return () => {
      cleanupMax();
      cleanupFs();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        window.electronAPI?.fullscreen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (isFullscreen) return null;

  return (
    <div
      className="h-8 flex items-center justify-between px-3 bg-tactical-darker border-b border-slate-800/60 shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* App title */}
      <div className="flex items-center gap-2">
        <div className="w-2.5 h-2.5 rotate-45 bg-amber-600/80" />
        <span className="font-hud text-[10px] tracking-[0.3em] text-amber-700/80 uppercase">
          Zero Bullet
        </span>
        <span className="text-[9px] text-slate-700 font-mono ml-2">v1.0.0</span>
      </div>

      {/* Window controls */}
      <div
        className="flex items-center gap-0.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Fullscreen toggle */}
        <button
          onClick={() => window.electronAPI?.fullscreen()}
          title="Toggle fullscreen (F11)"
          className="w-8 h-6 flex items-center justify-center hover:bg-white/8 rounded-sm transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" className="text-slate-500 hover:text-slate-300" strokeWidth="1.2">
            <polyline points="0,3.5 0,0 3.5,0" />
            <polyline points="7.5,0 11,0 11,3.5" />
            <polyline points="0,7.5 0,11 3.5,11" />
            <polyline points="11,7.5 11,11 7.5,11" />
          </svg>
        </button>

        {/* Minimize */}
        <button
          onClick={() => window.electronAPI?.minimize()}
          title="Minimize"
          className="w-8 h-6 flex items-center justify-center hover:bg-white/8 rounded-sm transition-colors"
        >
          <svg width="11" height="1" viewBox="0 0 11 1" fill="currentColor" className="text-slate-500 hover:text-slate-300">
            <rect width="11" height="1" />
          </svg>
        </button>

        {/* Maximize / Restore */}
        <button
          onClick={() => window.electronAPI?.maximize()}
          title={isMaximized ? 'Restore' : 'Maximize'}
          className="w-8 h-6 flex items-center justify-center hover:bg-white/8 rounded-sm transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" className="text-slate-500 hover:text-slate-300" strokeWidth="1.1">
            {isMaximized ? (
              <>
                <rect x="2.5" y="0.5" width="8" height="8" />
                <rect x="0.5" y="2.5" width="8" height="8" fill="#060a12" />
              </>
            ) : (
              <rect x="0.5" y="0.5" width="10" height="10" />
            )}
          </svg>
        </button>

        {/* Close */}
        <button
          onClick={() => window.electronAPI?.close()}
          title="Close"
          className="w-8 h-6 flex items-center justify-center hover:bg-red-700/70 rounded-sm transition-colors group ml-0.5"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" stroke="currentColor" fill="none" className="text-slate-500 group-hover:text-white transition-colors" strokeWidth="1.3">
            <line x1="1" y1="1" x2="10" y2="10" />
            <line x1="10" y1="1" x2="1" y2="10" />
          </svg>
        </button>
      </div>
    </div>
  );
}
