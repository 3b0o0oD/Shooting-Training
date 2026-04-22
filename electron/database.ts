import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) return db;

  const dbPath = path.join(app.getPath('userData'), 'splatt.db');
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatar TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      profile_id TEXT,
      target_id TEXT NOT NULL,
      target_config TEXT NOT NULL,
      calibration_config TEXT,
      mode TEXT NOT NULL DEFAULT 'practice',
      start_time INTEGER NOT NULL,
      end_time INTEGER,
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
    );

    CREATE TABLE IF NOT EXISTS shots (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      camera_x REAL NOT NULL,
      camera_y REAL NOT NULL,
      screen_x REAL NOT NULL,
      screen_y REAL NOT NULL,
      score INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      trace_points TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS calibrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      homography TEXT NOT NULL,
      calibration_points TEXT NOT NULL,
      manual_offset_x REAL NOT NULL DEFAULT 0,
      manual_offset_y REAL NOT NULL DEFAULT 0,
      reprojection_error REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_shots_session ON shots(session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_profile ON sessions(profile_id);
  `);

  return db;
}

// ─── Profile operations ───

export function getAllProfiles() {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT p.*,
      COUNT(DISTINCT s.id) as sessions,
      COUNT(sh.id) as total_shots,
      COALESCE(AVG(sh.score), 0) as average_score,
      COALESCE(MAX(sh.score), 0) as best_score
    FROM profiles p
    LEFT JOIN sessions s ON s.profile_id = p.id
    LEFT JOIN shots sh ON sh.session_id = s.id
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `).all();
  return rows;
}

export function createProfile(id: string, name: string) {
  const db = getDatabase();
  db.prepare('INSERT INTO profiles (id, name) VALUES (?, ?)').run(id, name);
}

export function deleteProfile(id: string) {
  const db = getDatabase();
  db.prepare('DELETE FROM shots WHERE session_id IN (SELECT id FROM sessions WHERE profile_id = ?)').run(id);
  db.prepare('DELETE FROM sessions WHERE profile_id = ?').run(id);
  db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
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
  const db = getDatabase();
  db.prepare(`
    INSERT INTO sessions (id, profile_id, target_id, target_config, calibration_config, mode, start_time)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, profileId, targetId, targetConfig, calibrationConfig, mode, startTime);
}

export function endSession(id: string, endTime: number) {
  const db = getDatabase();
  db.prepare('UPDATE sessions SET end_time = ? WHERE id = ?').run(endTime, id);
}

export function getAllSessions(profileId?: string) {
  const db = getDatabase();
  let query = `
    SELECT s.*,
      COUNT(sh.id) as shot_count,
      COALESCE(SUM(sh.score), 0) as total_score,
      COALESCE(AVG(sh.score), 0) as avg_score
    FROM sessions s
    LEFT JOIN shots sh ON sh.session_id = s.id
  `;
  if (profileId) {
    query += ' WHERE s.profile_id = ?';
    query += ' GROUP BY s.id ORDER BY s.start_time DESC';
    return db.prepare(query).all(profileId);
  }
  query += ' GROUP BY s.id ORDER BY s.start_time DESC';
  return db.prepare(query).all();
}

export function getSession(id: string) {
  const db = getDatabase();
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

export function deleteSession(id: string) {
  const db = getDatabase();
  db.prepare('DELETE FROM shots WHERE session_id = ?').run(id);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
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
  const db = getDatabase();
  db.prepare(`
    INSERT INTO shots (id, session_id, camera_x, camera_y, screen_x, screen_y, score, timestamp, trace_points)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, sessionId, cameraX, cameraY, screenX, screenY, score, timestamp, tracePoints);
}

export function getShotsForSession(sessionId: string) {
  const db = getDatabase();
  return db.prepare('SELECT * FROM shots WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId);
}

export function deleteLastShot(sessionId: string) {
  const db = getDatabase();
  db.prepare(`
    DELETE FROM shots WHERE id = (
      SELECT id FROM shots WHERE session_id = ? ORDER BY timestamp DESC LIMIT 1
    )
  `).run(sessionId);
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
  const db = getDatabase();
  db.prepare(`
    INSERT OR REPLACE INTO calibrations (id, name, homography, calibration_points, manual_offset_x, manual_offset_y, reprojection_error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, homography, calibrationPoints, manualOffsetX, manualOffsetY, reprojectionError);
}

export function getAllCalibrations() {
  const db = getDatabase();
  return db.prepare('SELECT * FROM calibrations ORDER BY created_at DESC').all();
}

export function getCalibration(id: string) {
  const db = getDatabase();
  return db.prepare('SELECT * FROM calibrations WHERE id = ?').get(id);
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}
