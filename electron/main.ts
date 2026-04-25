import { app, BrowserWindow, ipcMain, screen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import * as db from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let projectorWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1280,
    minHeight: 720,
    frame: false,
    backgroundColor: '#060a12',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('maximize', () =>
    mainWindow?.webContents.send('window:maximizeChanged', true)
  );
  mainWindow.on('unmaximize', () =>
    mainWindow?.webContents.send('window:maximizeChanged', false)
  );
  mainWindow.on('enter-full-screen', () =>
    mainWindow?.webContents.send('window:fullscreenChanged', true)
  );
  mainWindow.on('leave-full-screen', () =>
    mainWindow?.webContents.send('window:fullscreenChanged', false)
  );

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (projectorWindow) {
      projectorWindow.close();
      projectorWindow = null;
    }
  });
}

// ─── Window control IPC ───

ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized());
ipcMain.handle('window:fullscreen', () => {
  mainWindow?.setFullScreen(!mainWindow.isFullScreen());
});

// ─── Display enumeration ───

ipcMain.handle('displays:getAll', () => {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  console.log(`[displays] Found ${displays.length} display(s):`);
  const result = displays.map((d, i) => {
    const info = {
      id: d.id,
      label: `Display ${i + 1}${d.id === primary.id ? ' (Primary)' : ''} — ${d.size.width}×${d.size.height}`,
      width: d.size.width,
      height: d.size.height,
      isPrimary: d.id === primary.id,
      bounds: d.bounds,
    };
    console.log(`  [${i}] ${info.label} bounds=(${d.bounds.x},${d.bounds.y})`);
    return info;
  });
  return result;
});

// Notify renderer when displays change
app.whenReady().then(() => {
  screen.on('display-added', () => {
    mainWindow?.webContents.send('displays:changed');
  });
  screen.on('display-removed', () => {
    mainWindow?.webContents.send('displays:changed');
  });
});

// ─── Projector window management ───

ipcMain.handle('projector:open', (_event, displayIndex: number) => {
  if (projectorWindow) {
    projectorWindow.close();
  }

  const displays = screen.getAllDisplays();
  const targetDisplay = displays[displayIndex] || displays[0];

  projectorWindow = new BrowserWindow({
    x: targetDisplay.bounds.x,
    y: targetDisplay.bounds.y,
    width: targetDisplay.size.width,
    height: targetDisplay.size.height,
    fullscreen: true,
    frame: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    projectorWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#/projector`);
  } else {
    projectorWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
      hash: '/projector',
    });
  }

  projectorWindow.on('closed', () => {
    projectorWindow = null;
  });

  return {
    width: targetDisplay.size.width,
    height: targetDisplay.size.height,
  };
});

ipcMain.handle('projector:close', () => {
  if (projectorWindow) {
    projectorWindow.close();
    projectorWindow = null;
  }
});

ipcMain.handle('projector:send', (_event, data: unknown) => {
  if (projectorWindow && !projectorWindow.isDestroyed()) {
    projectorWindow.webContents.send('projector:message', data);
  }
});

// ─── App lifecycle ───

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  db.closeDatabase();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ─── Database IPC ───

// Profiles
ipcMain.handle('db:profiles:getAll', () => db.getAllProfiles());
ipcMain.handle('db:profiles:create', (_e, id: string, name: string) => db.createProfile(id, name));
ipcMain.handle('db:profiles:delete', (_e, id: string) => db.deleteProfile(id));

// Sessions
ipcMain.handle('db:sessions:create', (_e, ...args: Parameters<typeof db.createSession>) => db.createSession(...args));
ipcMain.handle('db:sessions:end', (_e, id: string, endTime: number) => db.endSession(id, endTime));
ipcMain.handle('db:sessions:getAll', (_e, profileId?: string) => db.getAllSessions(profileId));
ipcMain.handle('db:sessions:get', (_e, id: string) => db.getSession(id));
ipcMain.handle('db:sessions:delete', (_e, id: string) => db.deleteSession(id));

// Shots
ipcMain.handle('db:shots:add', (_e, ...args: Parameters<typeof db.addShot>) => db.addShot(...args));
ipcMain.handle('db:shots:getForSession', (_e, sessionId: string) => db.getShotsForSession(sessionId));
ipcMain.handle('db:shots:deleteLast', (_e, sessionId: string) => db.deleteLastShot(sessionId));

// Calibrations
ipcMain.handle('db:calibrations:save', (_e, ...args: Parameters<typeof db.saveCalibration>) => db.saveCalibration(...args));
ipcMain.handle('db:calibrations:getAll', () => db.getAllCalibrations());
ipcMain.handle('db:calibrations:get', (_e, id: string) => db.getCalibration(id));
