// Local SQLite database (better-sqlite3) — replaces Supabase/Postgres so the
// app stops paying egress for data that lives on this same Mac. The schema is
// the migration set ported 1:1 (minus RLS: there is one admin, one user id).
// Column types map: boolean -> 0/1, jsonb/text[] -> TEXT (JSON string).
// See dbShim for the Supabase-shaped query layer on top of this.
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

export const LOCAL_USER_ID = "00000000-0000-0000-0000-000000000000";

const dbFile = process.env.LOCAL_DB_FILE ?? path.join(process.cwd(), "data", "app.db");
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  db = new Database(dbFile);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
create table if not exists profiles (
  id text primary key,
  role text not null default 'admin',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table if not exists countries (
  id text primary key,
  name text not null unique,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table if not exists competitions (
  id text primary key,
  name text not null,
  country_id text not null references countries(id) on delete restrict,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (name, country_id)
);

create table if not exists teams (
  id text primary key,
  name text not null,
  aliases text,
  country_id text not null references countries(id) on delete restrict,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (name, country_id)
);

create table if not exists tickets (
  id text primary key,
  user_id text not null,
  competition_id text not null references competitions(id) on delete restrict,
  home_team_id text not null references teams(id) on delete restrict,
  away_team_id text not null references teams(id) on delete restrict,
  match_date text not null,
  match_time text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table if not exists picks (
  id text primary key,
  ticket_id text not null references tickets(id) on delete cascade,
  selection text not null,
  reason text,
  status text not null default 'pending',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table if not exists watched_matches (
  id text primary key,
  user_id text not null,
  home_team text not null,
  away_team text not null,
  home_aliases text,
  away_aliases text,
  sofascore_url text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table if not exists favorite_games (
  id text primary key,
  user_id text not null,
  event_id integer not null,
  home text not null,
  away text not null,
  tournament text not null default '',
  promoted_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (user_id, event_id)
);

create table if not exists feed_games (
  id text primary key,
  user_id text not null,
  event_id integer not null,
  home text not null,
  away text not null,
  tournament text not null default '',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (user_id, event_id)
);

create table if not exists user_notes (
  user_id text primary key,
  content text not null default '',
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table if not exists bots (
  id text primary key,
  user_id text not null,
  name text not null,
  enabled integer not null default 1,
  silent integer not null default 0,
  mode text not null default 'and',
  leagues text not null default '[]',
  minute_from integer not null default 1,
  minute_to integer not null default 90,
  period text not null default 'any',
  score text not null default 'any',
  market text not null default 'mais1',
  min_prob real,
  min_odd real,
  stats text not null default '[]',
  pregame text not null default '[]',
  refire integer not null default 0,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table if not exists bot_alerts (
  id text primary key,
  user_id text not null,
  bot_id text not null references bots(id) on delete cascade,
  event_id integer not null,
  minute integer not null,
  home text not null,
  away text not null,
  hg integer not null,
  ag integer not null,
  market text not null,
  text text not null,
  hit integer,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (bot_id, event_id, minute, hg, ag)
);

create table if not exists live_tables (
  id text primary key,
  user_id text not null,
  name text not null,
  leagues_mode text not null default 'all',
  leagues text not null default '[]',
  sample text not null default 'last10',
  venue_split integer not null default 0,
  criteria text not null default '[]',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table if not exists calibration_picks (
  user_id text not null,
  league text not null,
  home text not null,
  away text not null,
  match_date text not null,
  pick_key text not null,
  pick_group text not null,
  label text not null,
  p real not null,
  base real not null,
  fair real not null,
  result text,
  settled_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  primary key (user_id, league, home, away, match_date, pick_key)
);

create table if not exists sofascore_maps (
  user_id text not null,
  kind text not null,
  name_key text not null,
  sofascore_id integer not null,
  name text not null,
  slug text not null default '',
  local_name text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  primary key (user_id, kind, name_key)
);

create table if not exists sofascore_cache (
  user_id text not null,
  key text not null,
  payload text not null,
  fetched_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  primary key (user_id, key)
);
`);
  // The one admin profile, in case imports/back-compat reads look for it.
  db.prepare("insert or ignore into profiles (id, role) values (?, 'admin')").run(LOCAL_USER_ID);
  return db;
}

// Per-table type awareness so the shim can decode booleans and JSON the way
// Postgres did. Anything not listed here stays raw.
export interface TableMeta {
  idDefaults?: boolean; // text primary key: generate randomUUID when missing
  timestamps?: string[]; // columns defaulting to now() when absent
  bools?: string[];
  json?: string[];
}

export const TABLE_META: Record<string, TableMeta> = {
  profiles: {},
  countries: { idDefaults: true, timestamps: ["created_at"] },
  competitions: { idDefaults: true, timestamps: ["created_at"] },
  teams: { idDefaults: true, timestamps: ["created_at"] },
  tickets: { idDefaults: true, timestamps: ["created_at"] },
  picks: { idDefaults: true, timestamps: ["created_at"] },
  watched_matches: { idDefaults: true, timestamps: ["created_at"] },
  favorite_games: { idDefaults: true, timestamps: ["created_at"] },
  feed_games: { idDefaults: true, timestamps: ["created_at"] },
  user_notes: { timestamps: ["updated_at"] },
  bots: {
    idDefaults: true,
    timestamps: ["created_at"],
    bools: ["enabled", "silent", "refire"],
    json: ["leagues", "stats", "pregame"],
  },
  bot_alerts: { idDefaults: true, timestamps: ["created_at"], bools: ["hit"] },
  live_tables: {
    idDefaults: true,
    timestamps: ["created_at"],
    bools: ["venue_split"],
    json: ["leagues", "criteria"],
  },
  calibration_picks: { timestamps: ["created_at"] },
  sofascore_maps: { timestamps: ["created_at"] },
  sofascore_cache: {},
};

// Table names used with .from() — anything else is refused, mirroring
// PostgREST's "relation does not exist".
export const TABLES = new Set(Object.keys(TABLE_META));
