// One-time data import: Supabase (PostgREST) -> local SQLite.
// Run when the Supabase project is serving again (billing reset / upgrade):
//   node scripts/import-from-supabase.mjs
// Uses NEXT_PUBLIC_* env vars from .env.local. Non-destructive: existing
// rows are kept; each imported row upserts by its key/conflict columns.
// sofascore_cache is NOT imported — the scraper rebuilds it in minutes.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

const env = {};
const envFile = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  }
}
const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  process.exit(1);
}

const dbFile = process.env.LOCAL_DB_FILE ?? path.join(process.cwd(), "data", "app.db");
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
const db = new Database(dbFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Postgres type -> SQLite value
function toSqlite(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (Array.isArray(v) || typeof v === "object") return JSON.stringify(v); // jsonb + text[]
  return v;
}

const TABLES = [
  "profiles",
  "countries",
  "competitions",
  "teams",
  "tickets",
  "picks",
  "watched_matches",
  "favorite_games",
  "feed_games",
  "user_notes",
  "bots",
  "bot_alerts",
  "live_tables",
  "calibration_picks",
  "sofascore_maps",
];

async function fetchAll(table) {
  // 1000-row pages the way the API caps them.
  const rows = [];
  let from = 0;
  while (true) {
    const res = await fetch(`${url}/rest/v1/${table}?select=*`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${from}-${from + 999}`,
        Prefer: "count=exact",
      },
    });
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const chunk = await res.json();
    rows.push(...chunk);
    const total = Number(res.headers.get("content-range")?.split("/")[1] ?? rows.length);
    from += chunk.length;
    if (rows.length >= total || chunk.length === 0) break;
  }
  return rows;
}

for (const table of TABLES) {
  let rows;
  try {
    rows = await fetchAll(table);
  } catch (e) {
    console.error(`✗ ${table}: ${e.message}`);
    continue;
  }
  if (rows.length === 0) {
    console.log(`  ${table}: vazio`);
    continue;
  }
  const cols = Object.keys(rows[0]);
  const info = db.prepare("select name from pragma_table_info(?)").all(table);
  const usable = cols.filter((c) => info.some((i) => i.name === c));
  if (usable.length === 0) {
    console.error(`✗ ${table}: sem colunas comuns à schema local`);
    continue;
  }
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO "${table}" (${usable.map((c) => `"${c}"`).join(",")}) VALUES (${usable.map(() => "?").join(",")})`
  );
  let done = 0;
  db.transaction(() => {
    for (const row of rows) stmt.run(...usable.map((c) => toSqlite(row[c])));
    done = rows.length;
  })();
  console.log(`✓ ${table}: ${done} linhas importadas`);
}

db.close();
console.log("Feito — dados do Supabase agora vivem em data/app.db.");
