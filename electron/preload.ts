import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  fullscreen: () => ipcRenderer.invoke('window:fullscreen'),

  // Display management
  getDisplays: () => ipcRenderer.invoke('displays:getAll'),

  // Projector window
  openProjectorWindow: (displayIndex: number) => ipcRenderer.invoke('projector:open', displayIndex),
  closeProjectorWindow: () => ipcRenderer.invoke('projector:close'),
  sendToProjector: (data: unknown) => ipcRenderer.invoke('projector:send', data),
  onProjectorMessage: (callback: (data: unknown) => void) => {
    ipcRenderer.on('projector:message', (_event, data) => callback(data));
    return () => { ipcRenderer.removeAllListeners('projector:message'); };
  },

  // Database — Profiles
  dbGetProfiles: () => ipcRenderer.invoke('db:profiles:getAll'),
  dbCreateProfile: (id: string, name: string) => ipcRenderer.invoke('db:profiles:create', id, name),
  dbDeleteProfile: (id: string) => ipcRenderer.invoke('db:profiles:delete', id),

  // Database — Sessions
  dbCreateSession: (...args: unknown[]) => ipcRenderer.invoke('db:sessions:create', ...args),
  dbEndSession: (id: string, endTime: number) => ipcRenderer.invoke('db:sessions:end', id, endTime),
  dbGetSessions: (profileId?: string) => ipcRenderer.invoke('db:sessions:getAll', profileId),
  dbGetSession: (id: string) => ipcRenderer.invoke('db:sessions:get', id),
  dbDeleteSession: (id: string) => ipcRenderer.invoke('db:sessions:delete', id),

  // Database — Shots
  dbAddShot: (...args: unknown[]) => ipcRenderer.invoke('db:shots:add', ...args),
  dbGetShotsForSession: (sessionId: string) => ipcRenderer.invoke('db:shots:getForSession', sessionId),
  dbDeleteLastShot: (sessionId: string) => ipcRenderer.invoke('db:shots:deleteLast', sessionId),

  // Database — Calibrations
  dbSaveCalibration: (...args: unknown[]) => ipcRenderer.invoke('db:calibrations:save', ...args),
  dbGetCalibrations: () => ipcRenderer.invoke('db:calibrations:getAll'),
  dbGetCalibration: (id: string) => ipcRenderer.invoke('db:calibrations:get', id),
});
