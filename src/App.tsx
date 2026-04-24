import { useEffect } from 'react';
import { useAppStore } from './store/useAppStore';
import { TitleBar } from './components/ui/TitleBar';
import { MainMenu } from './screens/MainMenu';
import { ShootingScreen } from './screens/ShootingScreen';
import { SpeedDrillScreen } from './screens/SpeedDrillScreen';
import { CalibrationScreen } from './screens/CalibrationScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { ProjectorView } from './screens/ProjectorView';
import type { CalibrationProfile } from './types';

export default function App() {
  const currentScreen = useAppStore((s) => s.currentScreen);
  const setCalibrationProfile = useAppStore((s) => s.setCalibrationProfile);
  const setCalibrated = useAppStore((s) => s.setCalibrated);
  const setCameraConfig = useAppStore((s) => s.setCameraConfig);

  // Load last calibration from disk on startup
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.dbGetCalibrations) return;

    api.dbGetCalibrations().then((calibrations: any[]) => {
      if (calibrations && calibrations.length > 0) {
        const latest = calibrations[0]; // sorted by created_at DESC
        try {
          const profile: CalibrationProfile = {
            id: latest.id,
            name: latest.name,
            homography: JSON.parse(latest.homography),
            calibrationPoints: JSON.parse(latest.calibration_points),
            manualOffset: { x: latest.manual_offset_x, y: latest.manual_offset_y },
            reprojectionError: latest.reprojection_error,
            createdAt: latest.created_at,
          };
          setCalibrationProfile(profile);
          setCalibrated(true);
          console.log('[App] Loaded previous calibration:', profile.name, 'error:', profile.reprojectionError.toFixed(1) + 'px');
        } catch (e) {
          console.log('[App] Could not parse saved calibration:', e);
        }
      }
    });
  }, []);

  // If this window was opened as the projector (hash route #/projector),
  // render only the projector view — no title bar, no navigation.
  const isProjector = window.location.hash === '#/projector';

  if (isProjector) {
    return <ProjectorView />;
  }

  const renderScreen = () => {
    switch (currentScreen) {
      case 'main-menu':
        return <MainMenu />;
      case 'shooting':
        return <ShootingScreen />;
      case 'speed-drill':
        return <SpeedDrillScreen />;
      case 'calibration':
        return <CalibrationScreen />;
      case 'results':
        return <ResultsScreen />;
      case 'settings':
        return <SettingsScreen />;
      default:
        return <MainMenu />;
    }
  };

  return (
    <div className="w-full h-full flex flex-col tactical-grid">
      <TitleBar />
      <div className="flex-1 relative overflow-hidden">{renderScreen()}</div>
    </div>
  );
}
