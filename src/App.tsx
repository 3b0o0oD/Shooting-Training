import { useAppStore } from './store/useAppStore';
import { TitleBar } from './components/ui/TitleBar';
import { MainMenu } from './screens/MainMenu';
import { ShootingScreen } from './screens/ShootingScreen';
import { CalibrationScreen } from './screens/CalibrationScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { ProjectorView } from './screens/ProjectorView';

export default function App() {
  const currentScreen = useAppStore((s) => s.currentScreen);

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
