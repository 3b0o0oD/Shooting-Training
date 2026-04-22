import { motion } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';

export function ResultsScreen() {
  const { shots, activeTarget, projectionConfig, setScreen } = useAppStore();

  const totalScore = shots.reduce((sum, s) => sum + s.score, 0);
  const maxScore = shots.length * 10;
  const avgScore = shots.length > 0 ? totalScore / shots.length : 0;
  const bestShot = shots.length > 0 ? Math.max(...shots.map((s) => s.score)) : 0;
  const worstShot = shots.length > 0 ? Math.min(...shots.map((s) => s.score)) : 0;

  // Score distribution
  const distribution = Array.from({ length: 11 }, (_, i) => ({
    score: i,
    count: shots.filter((s) => s.score === i).length,
  }));

  return (
    <div className="w-full h-full flex flex-col items-center relative bg-tactical-darker overflow-y-auto">
      <div className="absolute inset-0 tactical-grid opacity-30" />

      <div className="relative z-10 w-full max-w-4xl px-8 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-10"
        >
          <h2 className="font-hud text-3xl text-tactical-green text-glow-green tracking-[0.2em]">
            DEBRIEF
          </h2>
          <div className="text-sm text-slate-500 font-tactical tracking-wider mt-1">
            Session Results • {activeTarget.name}
          </div>
        </motion.div>

        {shots.length === 0 ? (
          <div className="text-center text-slate-500 py-20">
            <div className="font-hud text-xl mb-4">NO DATA</div>
            <p className="text-sm">Complete a shooting session to see results here.</p>
            <button
              className="btn-tactical mt-6"
              onClick={() => setScreen('shooting')}
            >
              Start Shooting
            </button>
          </div>
        ) : (
          <>
            {/* Stats grid */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8"
            >
              <StatCard label="Total Score" value={`${totalScore}/${maxScore}`} color="cyan" />
              <StatCard label="Average" value={avgScore.toFixed(1)} color="green" />
              <StatCard label="Best Shot" value={String(bestShot)} color="green" />
              <StatCard label="Worst Shot" value={String(worstShot)} color="orange" />
            </motion.div>

            {/* Score distribution */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="hud-border p-6 mb-8"
            >
              <div className="text-[10px] text-slate-500 font-mono uppercase tracking-wider mb-4">
                Score Distribution
              </div>
              <div className="flex items-end gap-2 h-32">
                {distribution.map((d) => {
                  const maxCount = Math.max(...distribution.map((x) => x.count), 1);
                  const height = (d.count / maxCount) * 100;
                  const hue = (d.score / 10) * 120;
                  return (
                    <div key={d.score} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-[10px] text-slate-500 font-mono">
                        {d.count > 0 ? d.count : ''}
                      </span>
                      <div
                        className="w-full rounded-t transition-all"
                        style={{
                          height: `${height}%`,
                          minHeight: d.count > 0 ? 4 : 0,
                          background: `hsl(${hue}, 80%, 45%)`,
                          boxShadow: d.count > 0 ? `0 0 10px hsla(${hue}, 80%, 45%, 0.3)` : 'none',
                        }}
                      />
                      <span className="text-[10px] text-slate-500 font-mono">{d.score}</span>
                    </div>
                  );
                })}
              </div>
            </motion.div>

            {/* Shot list */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="hud-border p-6"
            >
              <div className="text-[10px] text-slate-500 font-mono uppercase tracking-wider mb-4">
                Shot Details
              </div>
              <div className="grid grid-cols-5 gap-2">
                {shots.map((shot, i) => {
                  const hue = (shot.score / 10) * 120;
                  return (
                    <div
                      key={shot.id}
                      className="flex items-center gap-2 p-2 rounded border border-tactical-border/30"
                    >
                      <span className="text-xs text-slate-600 font-mono w-6">
                        #{i + 1}
                      </span>
                      <span
                        className="font-hud text-lg font-bold"
                        style={{ color: `hsl(${hue}, 100%, 50%)` }}
                      >
                        {shot.score}
                      </span>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}

        {/* Navigation */}
        <div className="flex justify-center gap-4 mt-8 pb-8">
          <button className="btn-tactical" onClick={() => setScreen('main-menu')}>
            Menu
          </button>
          <button
            className="btn-tactical btn-tactical-orange"
            onClick={() => setScreen('shooting')}
          >
            Shoot Again
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: 'cyan' | 'green' | 'orange' | 'red';
}) {
  const colorMap = {
    cyan: 'text-tactical-accent text-glow-cyan',
    green: 'text-tactical-green text-glow-green',
    orange: 'text-tactical-orange text-glow-orange',
    red: 'text-tactical-red text-glow-red',
  };

  return (
    <div className="hud-border p-4 text-center corner-brackets">
      <div className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">
        {label}
      </div>
      <div className={`font-hud text-2xl font-bold mt-1 ${colorMap[color]}`}>
        {value}
      </div>
    </div>
  );
}
