import type { Shot, Point2D } from '../../types';

interface HUDOverlayProps {
  shots: Shot[];
  brightness: number;
  irPosition: Point2D | null;
  isPaused: boolean;
  isCalibrated: boolean;
  shotTimer: number;
  shotsPerSeries: number;
  targetName: string;
  showCamera: boolean;
  onToggleCamera: () => void;
  onBack: () => void;
  onPause: () => void;
  onClear: () => void;
  onUndo: () => void;
}

export function HUDOverlay({
  shots,
  brightness,
  irPosition,
  isPaused,
  isCalibrated,
  shotTimer,
  shotsPerSeries,
  targetName,
  showCamera,
  onToggleCamera,
  onBack,
  onPause,
  onClear,
  onUndo,
}: HUDOverlayProps) {
  const totalScore = shots.reduce((sum, s) => sum + s.score, 0);
  const maxPossible = shots.length * 10;
  const seriesShots = shots.length % shotsPerSeries || (shots.length > 0 ? shotsPerSeries : 0);

  return (
    <div className="absolute inset-0 pointer-events-none z-20">
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-2">
        <div className="hud-border px-4 py-2 pointer-events-auto corner-brackets">
          <div className="text-[10px] text-amber-900/50 font-mono uppercase tracking-wider">Target</div>
          <div className="text-sm font-tactical text-tactical-accent font-semibold tracking-wide">{targetName}</div>
        </div>

        <div className="hud-border px-6 py-2 text-center">
          <div className="text-[10px] text-amber-900/50 font-mono uppercase tracking-wider">Timer</div>
          <div className="font-hud text-2xl text-amber-100 tabular-nums">{shotTimer.toFixed(2)}</div>
        </div>

        <div className="hud-border px-4 py-2 text-right corner-brackets">
          <div className="text-[10px] text-amber-900/50 font-mono uppercase tracking-wider">Score</div>
          <div className="font-hud text-2xl text-tactical-green text-glow-green">
            {totalScore}
            <span className="text-sm text-amber-900/40">/{maxPossible}</span>
          </div>
        </div>
      </div>

      {/* Left panel: Shot list */}
      <div className="absolute left-4 top-20 bottom-16 w-48">
        <div className="hud-border h-full p-3 overflow-y-auto">
          <div className="text-[10px] text-amber-900/50 font-mono uppercase tracking-wider mb-2">Shot Log</div>
          {shots.length === 0 ? (
            <div className="text-xs text-amber-900/30 italic">Waiting for shots...</div>
          ) : (
            <div className="space-y-1">
              {shots.map((shot, i) => (
                <div key={shot.id} className="flex items-center justify-between text-xs py-1 border-b border-amber-900/10">
                  <span className="text-amber-900/40 font-mono">#{String(i + 1).padStart(2, '0')}</span>
                  <span className="font-hud font-bold" style={{ color: shot.score >= 8 ? '#4ade80' : shot.score >= 5 ? '#c8a35a' : '#dc3232' }}>
                    {shot.score}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right panel: Status */}
      <div className="absolute right-4 top-20 w-44">
        <div className="hud-border p-3 space-y-3">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${irPosition ? 'bg-tactical-green' : 'bg-amber-900/30'}`} />
            <span className="text-[10px] text-amber-800/60 font-mono uppercase">
              {irPosition ? 'Tracking' : 'No Signal'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isCalibrated ? 'bg-tactical-accent' : 'bg-tactical-orange animate-pulse'}`} />
            <span className="text-[10px] text-amber-800/60 font-mono uppercase">
              {isCalibrated ? 'Calibrated' : 'Not Calibrated'}
            </span>
          </div>

          <div>
            <div className="text-[10px] text-amber-900/50 font-mono uppercase mb-1">IR Level</div>
            <div className="h-1.5 bg-tactical-darker rounded-full overflow-hidden">
              <div
                className="h-full transition-all duration-100 rounded-full"
                style={{
                  width: `${Math.min(100, (brightness / 255) * 100)}%`,
                  background: brightness > 200 ? '#dc3232' : brightness > 100 ? '#d97706' : '#c8a35a',
                }}
              />
            </div>
          </div>

          <div>
            <div className="text-[10px] text-amber-900/50 font-mono uppercase mb-1">Series</div>
            <div className="flex gap-1">
              {Array.from({ length: shotsPerSeries }).map((_, i) => (
                <div
                  key={i}
                  className={`w-3 h-3 rounded-sm border ${
                    i < seriesShots ? 'bg-tactical-accent/40 border-tactical-accent' : 'border-amber-900/20 bg-transparent'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar: Controls */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 pointer-events-auto">
        <button onClick={onBack} className="btn-tactical text-xs px-4 py-2">ESC • Menu</button>
        <button onClick={onPause} className={`btn-tactical text-xs px-4 py-2 ${isPaused ? 'btn-tactical-orange' : ''}`}>
          P • {isPaused ? 'Resume' : 'Pause'}
        </button>
        <button onClick={onUndo} className="btn-tactical text-xs px-4 py-2">Space • Undo</button>
        <button onClick={onClear} className="btn-tactical btn-tactical-red text-xs px-4 py-2">C • Clear</button>
        <button
          onClick={onToggleCamera}
          className={`btn-tactical text-xs px-4 py-2 ${showCamera ? 'btn-tactical-orange' : ''}`}
        >
          V • Cam
        </button>
      </div>

      {/* Corner decorations */}
      <svg className="absolute top-2 left-2 w-6 h-6 text-tactical-accent/15" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1"><path d="M0 12V0h12" /></svg>
      <svg className="absolute top-2 right-2 w-6 h-6 text-tactical-accent/15" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1"><path d="M32 12V0H20" /></svg>
      <svg className="absolute bottom-2 left-2 w-6 h-6 text-tactical-accent/15" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1"><path d="M0 20v12h12" /></svg>
      <svg className="absolute bottom-2 right-2 w-6 h-6 text-tactical-accent/15" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1"><path d="M32 20v12H20" /></svg>
    </div>
  );
}
