'use strict';
/* Veritabanı katmanı: node:sqlite (Node ≥ 22.5, yerleşik — bir ek bağımlılık yok).
   Tek bağlantı, WAL modu; şema kurulumu burada (migration). */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });
const db = new DatabaseSync(config.DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  username    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  passhash    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  cls         TEXT NOT NULL,
  level       INTEGER NOT NULL DEFAULT 1,
  exp         REAL NOT NULL DEFAULT 0,
  x           REAL NOT NULL DEFAULT 0,
  z           REAL NOT NULL DEFAULT 0,
  yaw         REAL NOT NULL DEFAULT 0,
  zone        TEXT NOT NULL DEFAULT '',
  hp          REAL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_characters_user ON characters(user_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel     TEXT NOT NULL DEFAULT 'global',
  from_id     INTEGER REFERENCES users(id),
  from_name   TEXT NOT NULL,
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_channel_id ON chat_messages(channel, id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

module.exports = db;
