import path from 'path';
import fs from 'fs';
import { app } from 'electron';

/**
 * JSON-based config storage — replaces SQLite.
 * Stores calibration, camera settings, sessions, and profiles
 * in a single JSON file in the user data directory.
 */

interface ConfigData {
  calibrations: Record<string, any>;
  profiles: Record<string, any>;
  sessions: Record<string, any>;
  shots: Record<string, any[]>; // sessionId -> shots[]
  lastCalibrationId: string | null;
}

let configPath = '';
let data: ConfigData = {
  calibrations: {},
  profiles: {},
  sessions: {},
  shots: {},
  lastCalibrationId: null,
};

function getConfigPath(): string {
  if (!configPath) {
    configPath = path.join(app.getPath('userData'), 'shooting-config.json');
  }
  return configPath;
}

function loadConfig(): ConfigData {
  try {
    const filePath = getConfigPath();
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      data = JSON.parse(raw);
    }
  } catch (e) {
    console.error('[config] Failed to load config:', e);
  }
  return data;
}

function saveConfig() {
  try {
    const filePath = getConfigPath();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('[config] Failed to save config:', e);
  }
}

// Initialize on first import
loadConfig();

// ─── Profile operations ───

export function getAllProfiles() {
  return Object.values(data.profiles).map((p: any) => {
    const sessions = Object.values(data.sessions).filter((s: any) => s.profile_id === p.id);
    const allShots = sessions.flatMap((s: any) => data.shots[s.id] || []);
    return {
      ...p,
      sessions: sessions.length,
      total_shots: allShots.length,
      average_score: allShots.length > 0 ? allShots.reduce((s: number, sh: any) => s + sh.score, 0) / allShots.length : 0,
      best_score: allShots.length > 0 ? Math.max(...allShots.map((sh: any) => sh.score)) : 0,
    };
  });
}

export function createProfile(id: string, name: string) {
  data.profiles[id] = { id, name, created_at: Date.now() };
  saveConfig();
}

export function deleteProfile(id: string) {
  // Delete associated sessions and shots
  Object.values(data.sessions)
    .filter((s: any) => s.profile_id === id)
    .forEach((s: any) => {
      delete data.shots[s.id];
      delete data.sessions[s.id];
    });
  delete data.profiles[id];
  saveConfig();
}

// ─── Session operations ───

export function createSession(
  id: string,
  profileId: string | null,
  targetId: string,
  targetConfig: string,
  calibrationConfig: string | null,
  mode: string,
  startTime: number
) {
  data.sessions[id] = {
    id, profile_id: profileId, target_id: targetId,
    target_config: targetConfig, calibration_config: calibrationConfig,
    mode, start_time: startTime, end_time: null,
  };
  data.shots[id] = [];
  saveConfig();
}

export function endSession(id: string, endTime: number) {
  if (data.sessions[id]) {
    data.sessions[id].end_time = endTime;
    saveConfig();
  }
}

export function getAllSessions(profileId?: string) {
  let sessions = Object.values(data.sessions) as any[];
  if (profileId) {
    sessions = sessions.filter((s: any) => s.profile_id === profileId);
  }
  return sessions
    .sort((a: any, b: any) => b.start_time - a.start_time)
    .map((s: any) => {
      const shots = data.shots[s.id] || [];
      return {
        ...s,
        shot_count: shots.length,
        total_score: shots.reduce((sum: number, sh: any) => sum + sh.score, 0),
        avg_score: shots.length > 0 ? shots.reduce((sum: number, sh: any) => sum + sh.score, 0) / shots.length : 0,
      };
    });
}

export function getSession(id: string) {
  return data.sessions[id] || null;
}

export function deleteSession(id: string) {
  delete data.shots[id];
  delete data.sessions[id];
  saveConfig();
}

// ─── Shot operations ───

export function addShot(
  id: string,
  sessionId: string,
  cameraX: number,
  cameraY: number,
  screenX: number,
  screenY: number,
  score: number,
  timestamp: number,
  tracePoints: string | null
) {
  if (!data.shots[sessionId]) data.shots[sessionId] = [];
  data.shots[sessionId].push({
    id, session_id: sessionId,
    camera_x: cameraX, camera_y: cameraY,
    screen_x: screenX, screen_y: screenY,
    score, timestamp, trace_points: tracePoints,
  });
  saveConfig();
}

export function getShotsForSession(sessionId: string) {
  return (data.shots[sessionId] || []).sort((a: any, b: any) => a.timestamp - b.timestamp);
}

export function deleteLastShot(sessionId: string) {
  const shots = data.shots[sessionId];
  if (shots && shots.length > 0) {
    shots.pop();
    saveConfig();
  }
}

// ─── Calibration operations ───

export function saveCalibration(
  id: string,
  name: string,
  homography: string,
  calibrationPoints: string,
  manualOffsetX: number,
  manualOffsetY: number,
  reprojectionError: number
) {
  data.calibrations[id] = {
    id, name, homography, calibration_points: calibrationPoints,
    manual_offset_x: manualOffsetX, manual_offset_y: manualOffsetY,
    reprojection_error: reprojectionError,
    created_at: Date.now(),
  };
  data.lastCalibrationId = id;
  saveConfig();
}

export function getAllCalibrations() {
  return Object.values(data.calibrations).sort((a: any, b: any) => b.created_at - a.created_at);
}

export function getCalibration(id: string) {
  return data.calibrations[id] || null;
}

export function closeDatabase() {
  // Save any pending changes
  saveConfig();
}
