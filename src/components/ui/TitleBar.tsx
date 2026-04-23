import { useState, useEffect } from 'react';

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const checkMaximized = async () => {
      if (window.electronAPI) {
        const maximized = await window.electronAPI.isMaximized();
        setIsMaximized(maximized);
      }
    };
    checkMaximized();
  }, []);

  const handleMinimize = () => window.electronAPI?.minimize();
  const handleMaximize = async () => {
    await window.electronAPI?.maximize();
    const maximized = await window.electronAPI?.isMaximized();
    setIsMaximized(maximized ?? false);
  };
  const handleClose = () => window.electronAPI?.close();

  return (
    <div
      className="h-8 flex items-center justify-between px-3 bg-tactical-darker border-b border-tactical-border"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* App title */}
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 bg-tactical-accent rounded-sm opacity-80" />
        <span className="font-hud text-[10px] tracking-[0.3em] text-tactical-accent/70 uppercase">
          IR shooting training PoC
        </span>
        <span className="text-[9px] text-slate-600 font-mono ml-2">v1.0.0</span>
      </div>

      {/* Window controls */}
      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={handleMinimize}
          className="w-7 h-5 flex items-center justify-center hover:bg-white/10 rounded-sm transition-colors"
          aria-label="Minimize"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor" className="text-slate-400">
            <rect width="10" height="1" />
          </svg>
        </button>
        <button
          onClick={handleMaximize}
          className="w-7 h-5 flex items-center justify-center hover:bg-white/10 rounded-sm transition-colors"
          aria-label="Maximize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" className="text-slate-400" strokeWidth="1">
            {isMaximized ? (
              <>
                <rect x="2" y="0" width="8" height="8" />
                <rect x="0" y="2" width="8" height="8" />
              </>
            ) : (
              <rect x="0.5" y="0.5" width="9" height="9" />
            )}
          </svg>
        </button>
        <button
          onClick={handleClose}
          className="w-7 h-5 flex items-center justify-center hover:bg-tactical-red/80 rounded-sm transition-colors"
          aria-label="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" className="text-slate-400 hover:text-white" strokeWidth="1.2">
            <line x1="1" y1="1" x2="9" y2="9" />
            <line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </button>
      </div>
    </div>
  );
}
