/* ==========================================================================
   Metadata store.

   node:sqlite, so the server needs no native dependency and the schema is
   transactional. Filesystem holds assets and exports; this holds metadata,
   jobs, events and the cost ledger — per docs/architecture/data.md.

   The important constraint encoded here is atomic intent de-duplication: the
   UNIQUE index on `intent_id` is what stops a double-click from becoming two
   paid submissions. Doing this with a read-then-write in JavaScript would
   race.
   ========================================================================== */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS jobs (
  id               TEXT PRIMARY KEY,
  intent_id        TEXT NOT NULL UNIQUE,
  type             TEXT NOT NULL,
  provider_id      TEXT NOT NULL,
  model_id         TEXT,
  credential_ref   TEXT NOT NULL,
  input_snapshot   TEXT NOT NULL,
  status           TEXT NOT NULL,
  revision         INTEGER NOT NULL DEFAULT 1,
  request_id       TEXT,
  generation_id    TEXT,
  output_asset_ids TEXT NOT NULL DEFAULT '[]',
  error_json       TEXT,
  usage_json       TEXT,
  cancel_requested_at TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_events (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  at          TEXT NOT NULL,
  kind        TEXT NOT NULL,
  payload     TEXT
);

CREATE INDEX IF NOT EXISTS job_events_by_job ON job_events(job_id, seq);

CREATE TABLE IF NOT EXISTS usage_entries (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  state       TEXT NOT NULL,
  amount      REAL,
  unit        TEXT,
  currency    TEXT,
  source      TEXT,
  as_of       TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE (job_id, state)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDb(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

/** Read a JSON settings value, with a fallback. */
export function getSetting(db, key, fallback = null) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

export function setSetting(db, key, value) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, JSON.stringify(value));
}
