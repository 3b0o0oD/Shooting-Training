import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';
import { TARGET_LIBRARY } from '../data/targets';
import type { CameraDevice, DisplayInfo } from '../types';

type SettingsTab = 'camera' | 'projection' | 'detection' | 'target';

export function SettingsScreen() {
  const {
    cameraConfig,
    setCameraConfig,
    projectionConfig,
    setProjectionConfig,
    detectionConfig,
    setDetectionConfig,
    activeTarget,
    setActiveTarget,
    setScreen,
  } = useAppStore();

  const [activeTab, setActiveTab] = useState<SettingsTab>('camera');
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      const videoDevices = devices
        .filter((d) => d.kind === 'videoinput')
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${d.deviceId.slice(0, 8)}`,
          resolution: { width: 640, height: 480 },
        }));
      setCameras(videoDevices);
    });

    refreshDisplays();

    const api = window.electronAPI;
    if (api?.onDisplaysChanged) {
      const cleanup = api.onDisplaysChanged(() => refreshDisplays());
      return cleanup;
    }
  }, []);

  const refreshDisplays = () => {
    const api = window.electronAPI;
    if (api?.getDisplays) {
      api.getDisplays().then((d: DisplayInfo[]) => setDisplays(d));
    }
  };

  const tabs: { id: SettingsTab; label: string;  }[] = [
    { id: 'camera', label: 'Camera' },
    { id: 'projection', label: 'Projection'},
    { id: 'detection', label: 'Detection' },
    { id: 'target', label: 'Target' },
  ];

  return (
    <div className="w-full h-full flex flex-col items-center relative bg-tactical-darker overflow-y-auto">
      <div className="absolute inset-0 tactical-grid opacity-30" />

      <div className="relative z-10 w-full max-w-3xl px-8 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <h2
            className="font-hud text-3xl text-tactical-accent tracking-[0.2em] text-glow-gold"
          >
            Zero Bullet
          </h2>
          <div className="text-sm text-slate-500 font-tactical tracking-wider mt-1">
            System Configuration
          </div>
        </motion.div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-tactical tracking-wider uppercase transition-all ${
                activeTab === tab.id
                  ? 'border-b-2 border-tactical-accent text-tactical-accent'
                  : 'text-amber-900/50 hover:text-amber-600/80'
              }`}
            >
              {/* <span>{tab.icon}</span> */}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="hud-border p-6">
          {activeTab === 'camera' && (
            <div className="space-y-6">
              <SettingGroup label="Camera Device">
                <select
                  value={cameraConfig.deviceId}
                  onChange={(e) => setCameraConfig({ deviceId: e.target.value })}
                  className="w-full bg-tactical-darker border border-tactical-border rounded px-3 py-2 text-sm text-slate-300 font-mono focus:border-tactical-accent outline-none"
                >
                  <option value="">Auto-detect</option>
                  {cameras.map((cam) => (
                    <option key={cam.deviceId} value={cam.deviceId}>
                      {cam.label}
                    </option>
                  ))}
                </select>
              </SettingGroup>

              <SettingGroup label="Capture Resolution">
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="text-[10px] text-slate-500 font-mono">Width</label>
                    <input
                      type="number"
                      value={cameraConfig.width}
                      onChange={(e) => setCameraConfig({ width: Number(e.target.value) })}
                      className="w-full bg-tactical-darker border border-tactical-border rounded px-3 py-2 text-sm text-slate-300 font-mono focus:border-tactical-accent outline-none"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] text-slate-500 font-mono">Height</label>
                    <input
                      type="number"
                      value={cameraConfig.height}
                      onChange={(e) => setCameraConfig({ height: Number(e.target.value) })}
                      className="w-full bg-tactical-darker border border-tactical-border rounded px-3 py-2 text-sm text-slate-300 font-mono focus:border-tactical-accent outline-none"
                    />
                  </div>
                </div>
              </SettingGroup>

              <SettingGroup label="Image Flip">
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cameraConfig.flipHorizontal}
                      onChange={(e) => setCameraConfig({ flipHorizontal: e.target.checked })}
                      className="accent-tactical-accent"
                    />
                    Horizontal
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cameraConfig.flipVertical}
                      onChange={(e) => setCameraConfig({ flipVertical: e.target.checked })}
                      className="accent-tactical-accent"
                    />
                    Vertical
                  </label>
                </div>
              </SettingGroup>
            </div>
          )}

          {activeTab === 'projection' && (
            <div className="space-y-6">
              <SettingGroup label="Projector Display">
                <div className="flex gap-2">
                  <select
                    value={projectionConfig.displayIndex}
                    onChange={(e) => setProjectionConfig({ displayIndex: Number(e.target.value) })}
                    className="flex-1 bg-tactical-darker border border-tactical-border rounded px-3 py-2 text-sm text-slate-300 font-mono focus:border-tactical-accent outline-none"
                  >
                    {displays.map((d, i) => (
                      <option key={d.id} value={i}>
                        {d.label}
                      </option>
                    ))}
                    {displays.length === 0 && <option value={0}>No displays detected</option>}
                  </select>
                  <button
                    onClick={refreshDisplays}
                    className="px-3 py-2 border border-tactical-border rounded text-sm text-slate-400 hover:text-tactical-accent hover:border-tactical-accent transition-colors font-mono"
                    title="Refresh displays"
                  >
                    ↻
                  </button>
                </div>
                <div className="text-[10px] text-slate-500 font-mono mt-1">
                  {displays.length} display(s) detected
                </div>
              </SettingGroup>

              <SliderSetting
                label="Target Size (% of screen)"
                value={projectionConfig.targetSizePercent}
                min={30}
                max={100}
                onChange={(v) => setProjectionConfig({ targetSizePercent: v })}
              />

              <SliderSetting
                label="Hit Marker Size (px)"
                value={projectionConfig.hitMarkerSize}
                min={4}
                max={40}
                onChange={(v) => setProjectionConfig({ hitMarkerSize: v })}
              />

              <SettingGroup label="Target Offset (pixels from center)">
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="text-[10px] text-slate-500 font-mono">X</label>
                    <input
                      type="number"
                      value={projectionConfig.targetOffset.x}
                      onChange={(e) =>
                        setProjectionConfig({
                          targetOffset: {
                            ...projectionConfig.targetOffset,
                            x: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full bg-tactical-darker border border-tactical-border rounded px-3 py-2 text-sm text-slate-300 font-mono focus:border-tactical-accent outline-none"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] text-slate-500 font-mono">Y</label>
                    <input
                      type="number"
                      value={projectionConfig.targetOffset.y}
                      onChange={(e) =>
                        setProjectionConfig({
                          targetOffset: {
                            ...projectionConfig.targetOffset,
                            y: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full bg-tactical-darker border border-tactical-border rounded px-3 py-2 text-sm text-slate-300 font-mono focus:border-tactical-accent outline-none"
                    />
                  </div>
                </div>
              </SettingGroup>

              <div className="p-3 border border-tactical-border/30 rounded text-xs text-slate-500">
                <strong className="text-slate-400">How it works:</strong> The app opens a
                full-screen window on the selected display showing the target. Your camera watches
                the projection wall. During calibration, 4 markers are projected and you shoot each
                one — this builds a perspective mapping from camera → screen coordinates.
              </div>
            </div>
          )}

          {activeTab === 'detection' && (
            <div className="space-y-6">
              <SliderSetting
                label="Tracking Threshold"
                value={detectionConfig.trackingThreshold}
                min={180}
                max={254}
                hint="CameraParameters.ini TrackingThreshold3=220. Raise if false positives occur; lower if shots are missed."
                onChange={(v) => setDetectionConfig({ trackingThreshold: v })}
              />

              <SliderSetting
                label="Shot Connected Distance (px)"
                value={detectionConfig.shotConnectedDistance}
                min={5}
                max={150}
                step={5}
                hint="SLDriver: ShotConnectedDistance. Max distance between a new blob and any previous-frame blob to count as the same blob (not a new shot). Increase for slow lasers; decrease for precision."
                onChange={(v) => setDetectionConfig({ shotConnectedDistance: v })}
              />

              <SliderSetting
                label="Threshold Bump Step"
                value={detectionConfig.thresholdBumpStep}
                min={0}
                max={10}
                hint="SLDriver: ThresholdBump. When too many blobs are detected the threshold auto-raises by this amount. Set to 0 to disable auto-adjustment."
                onChange={(v) => setDetectionConfig({ thresholdBumpStep: v })}
              />

              <div className="p-3 border border-tactical-border/30 rounded text-xs text-slate-500 space-y-1">
                <div><span className="text-slate-400">Tracking Threshold</span> — pixels above this value are candidate laser hits. Tuned for CameraParameters.ini Channel 3 (Brightness=−48).</div>
                <div><span className="text-slate-400">Shot Connected Distance</span> — blobs within this radius of a previous-frame blob are treated as the same ongoing blob, not a new shot.</div>
                <div><span className="text-slate-400">Threshold Bump</span> — auto-raises threshold when the camera sees too many false blobs (projector bleed-through). Resets toward base when scene is dark again.</div>
              </div>
            </div>
          )}

          {activeTab === 'target' && (
            <div className="space-y-4">
              <SettingGroup label="Select Target">
                <div className="grid grid-cols-1 gap-2 max-h-80 overflow-y-auto pr-1">
                  {TARGET_LIBRARY.map((target) => (
                    <button
                      key={target.id}
                      onClick={() => setActiveTarget(target)}
                      className={`text-left p-3 rounded border transition-all ${
                        activeTarget.id === target.id
                          ? 'border-tactical-accent bg-tactical-accent/10'
                          : 'border-tactical-border hover:border-tactical-border/60 hover:bg-white/[0.02]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className={`text-sm font-tactical font-semibold tracking-wide ${
                            activeTarget.id === target.id ? 'text-tactical-accent' : 'text-slate-300'
                          }`}>
                            {target.name}
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                            {target.scoringRings.length} rings • {target.gaugingMethod} gauging
                          </div>
                        </div>
                        {activeTarget.id === target.id && (
                          <span className="text-tactical-accent text-xs font-mono">ACTIVE</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </SettingGroup>

              <div className="hud-border-orange p-3">
                <div className="text-[10px] text-slate-500 font-mono uppercase tracking-wider mb-1">Active Target</div>
                <div className="text-sm font-tactical text-tactical-orange font-semibold">{activeTarget.name}</div>
                <div className="text-[10px] text-slate-500 font-mono mt-1">
                  {activeTarget.scoringRings.length} scoring rings • Gauging: {activeTarget.gaugingMethod}
                  {activeTarget.scoringRings[0] && ` • Bullseye: ${(activeTarget.scoringRings[0].radiusPercent * 100).toFixed(1)}% radius`}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Back */}
        <div className="flex justify-center mt-8 pb-8">
          <button className="btn-tactical" onClick={() => setScreen('main-menu')}>
            ← Back to Menu
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-slate-500 font-mono uppercase tracking-wider mb-2">
        {label}
      </div>
      {children}
    </div>
  );
}

function SliderSetting({
  label,
  value,
  min,
  max,
  step = 1,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  hint?: string;
  onChange: (value: number) => void;
}) {
  return (
    <SettingGroup label={label}>
      <div className="flex items-center gap-4">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-tactical-accent"
        />
        <span className="font-mono text-sm text-tactical-accent w-16 text-right">
          {typeof step === 'number' && step < 1 ? value.toFixed(1) : value}
        </span>
      </div>
      {hint && <div className="text-[10px] text-slate-600 font-mono mt-1 leading-relaxed">{hint}</div>}
    </SettingGroup>
  );
}
