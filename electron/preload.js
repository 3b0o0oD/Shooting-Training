const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  fullscreen: () => ipcRenderer.invoke('window:fullscreen'),
  onMaximizeChanged: (callback) => {
    ipcRenderer.on('window:maximizeChanged', (_e, value) => callback(value));
    return () => ipcRenderer.removeAllListeners('window:maximizeChanged');
  },
  onFullscreenChanged: (callback) => {
    ipcRenderer.on('window:fullscreenChanged', (_e, value) => callback(value));
    return () => ipcRenderer.removeAllListeners('window:fullscreenChanged');
  },

  getDisplays: () => ipcRenderer.invoke('displays:getAll'),
  onDisplaysChanged: (callback) => {
    ipcRenderer.on('displays:changed', () => callback());
    return () => { ipcRenderer.removeAllListeners('displays:changed'); };
  },

  openProjectorWindow: (displayIndex) => ipcRenderer.invoke('projector:open', displayIndex),
  closeProjectorWindow: () => ipcRenderer.invoke('projector:close'),
  sendToProjector: (data) => ipcRenderer.invoke('projector:send', data),
  onProjectorMessage: (callback) => {
    ipcRenderer.on('projector:message', (_event, data) => callback(data));
    return () => { ipcRenderer.removeAllListeners('projector:message'); };
  },

  dbGetProfiles: () => ipcRenderer.invoke('db:profiles:getAll'),
  dbCreateProfile: (id, name) => ipcRenderer.invoke('db:profiles:create', id, name),
  dbDeleteProfile: (id) => ipcRenderer.invoke('db:profiles:delete', id),

  dbCreateSession: (...args) => ipcRenderer.invoke('db:sessions:create', ...args),
  dbEndSession: (id, endTime) => ipcRenderer.invoke('db:sessions:end', id, endTime),
  dbGetSessions: (profileId) => ipcRenderer.invoke('db:sessions:getAll', profileId),
  dbGetSession: (id) => ipcRenderer.invoke('db:sessions:get', id),
  dbDeleteSession: (id) => ipcRenderer.invoke('db:sessions:delete', id),

  dbAddShot: (...args) => ipcRenderer.invoke('db:shots:add', ...args),
  dbGetShotsForSession: (sessionId) => ipcRenderer.invoke('db:shots:getForSession', sessionId),
  dbDeleteLastShot: (sessionId) => ipcRenderer.invoke('db:shots:deleteLast', sessionId),

  dbSaveCalibration: (...args) => ipcRenderer.invoke('db:calibrations:save', ...args),
  dbGetCalibrations: () => ipcRenderer.invoke('db:calibrations:getAll'),
  dbGetCalibration: (id) => ipcRenderer.invoke('db:calibrations:get', id),
});
