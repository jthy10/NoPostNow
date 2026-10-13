import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// One SQLite file holds every account, session and document. Photos are plain
// files on disk beside it (see files.ts), so the whole instance is one folder.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  uid          TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash    TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member',
  disabled     INTEGER NOT NULL DEFAULT 0,
  totp_secret  TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  uid        TEXT NOT NULL REFERENCES accounts(uid) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  auth_at    INTEGER NOT NULL,
  mfa        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sessions_uid ON sessions(uid);

CREATE TABLE IF NOT EXISTS invites (
  code       TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  max_uses   INTEGER NOT NULL,
  uses       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS resets (
  token_hash TEXT PRIMARY KEY,
  uid        TEXT NOT NULL REFERENCES accounts(uid) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- Document store. parent is the collection path ("photos",
-- "photos/abc/comments"); coll is its last segment, for group queries.
CREATE TABLE IF NOT EXISTS docs (
  path       TEXT PRIMARY KEY,
  parent     TEXT NOT NULL,
  coll       TEXT NOT NULL,
  id         TEXT NOT NULL,
  data       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS docs_parent ON docs(parent);
CREATE INDEX IF NOT EXISTS docs_coll ON docs(coll);

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDatabase(dataDir: string): DatabaseSync {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "nopostnow.db");
  const db = new DatabaseSync(file);
  // Private to the host user where the platform has file modes.
  try {
    fs.chmodSync(file, 0o600);
  } catch {}
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);
  return db;
}

export type Db = DatabaseSync;
