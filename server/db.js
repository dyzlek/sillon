// Base SQLite (node:sqlite, intégré à Node ≥ 22.5) : source de vérité de la bibliothèque.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const MUSIC = path.join(ROOT, 'music');
const DATA = path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });

export const MODES = ['sphere', 'spectre', 'anneau'];
export const AUDIO = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.webm': 'audio/webm' };
export const IMAGES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

export const db = new DatabaseSync(path.join(DATA, 'sillon.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS tracks (
    id           TEXT PRIMARY KEY,
    file         TEXT NOT NULL UNIQUE,          -- nom du fichier dans music/
    title        TEXT NOT NULL,
    artist       TEXT NOT NULL DEFAULT 'Artiste inconnu',
    album        TEXT,
    genre        TEXT,
    year         INTEGER,
    duration     REAL,                          -- secondes (renseignée par le client à la première lecture)
    cover        TEXT,                          -- image à côté du son dans music/
    visual       TEXT NOT NULL DEFAULT 'sphere,spectre,anneau', -- vues du visualiseur, dans l'ordre
    visual_every INTEGER NOT NULL DEFAULT 24,   -- secondes entre deux vues (0 = jamais)
    position     INTEGER NOT NULL DEFAULT 0,    -- ordre dans l'index
    size         INTEGER NOT NULL,
    added        INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS plays (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    at       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS plays_track ON plays(track_id);
`);

export const q = {
  all: db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM plays p WHERE p.track_id = t.id) AS plays FROM tracks t ORDER BY position, added`),
  get: db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM plays p WHERE p.track_id = t.id) AS plays FROM tracks t WHERE id = ?`),
  byFile: db.prepare('SELECT * FROM tracks WHERE file = ?'),
  files: db.prepare('SELECT id, file FROM tracks'),
  insert: db.prepare(`INSERT INTO tracks (id, file, title, artist, cover, size, added, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM tracks))`),
  touch: db.prepare('UPDATE tracks SET size = ?, cover = COALESCE(?, cover) WHERE id = ?'),
  remove: db.prepare('DELETE FROM tracks WHERE id = ?'),
  duration: db.prepare('UPDATE tracks SET duration = ? WHERE id = ? AND (duration IS NULL OR ABS(duration - ?) > 0.5)'),
  play: db.prepare('INSERT INTO plays (track_id, at) VALUES (?, ?)'),
};

// Seuls ces champs sont modifiables (script db, route PATCH).
export const EDITABLE = ['title', 'artist', 'album', 'genre', 'year', 'cover', 'visual', 'visual_every', 'position'];
export function update(id, fields) {
  const keys = Object.keys(fields).filter((k) => EDITABLE.includes(k));
  if (!keys.length) return q.get.get(id);
  if (fields.visual !== undefined) {
    const modes = String(fields.visual).split(',').map((s) => s.trim()).filter((m) => MODES.includes(m));
    if (!modes.length) throw new Error(`visual : une ou plusieurs vues parmi ${MODES.join(', ')}`);
    fields.visual = modes.join(',');
  }
  db.prepare(`UPDATE tracks SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k] ?? null), id);
  return q.get.get(id);
}
