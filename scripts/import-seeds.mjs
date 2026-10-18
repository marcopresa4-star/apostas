// One-off: port the SQL seed files (countries/teams/competitions) into the
// local SQLite DB. These are Wikidata-based reference data committed as
// files — they need no network, no Supabase. The cloud schema dialects
// (uuid/text[]/::casts/values-join) are parsed out here.
//   node scripts/import-seeds.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

const mig = (f) => fs.readFileSync(path.join(process.cwd(), "supabase", "migrations", f), "utf8");
const dbFile = process.env.LOCAL_DB_FILE ?? path.join(process.cwd(), "data", "app.db");
const db = new Database(dbFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Tokenize a "(...)" values section of 'quoted' / null literals into flat
// constants ('' inside quotes is an escaped quote).
function parseLiterals(section) {
  const out = [];
  let i = 0;
  while (i < section.length) {
    const ch = section[i];
    if (ch === "'") {
      i++;
      let s = "";
      while (i < section.length) {
        if (section[i] === "'" && section[i + 1] === "'") {
          s += "'";
          i += 2;
          continue;
        }
        if (section[i] === "'") {
          i++;
          break;
        }
        s += section[i++];
      }
      out.push(s);
    } else if (section.startsWith("null", i)) {
      out.push(null);
      i += 4;
    } else {
      i++;
    }
  }
  return out;
}

function valuesSection(body, arity) {
  const idx = body.indexOf("(values");
  if (idx < 0) throw new Error("bloco (values não encontrado");
  let end = body.indexOf(") as v(", idx);
  if (end < 0) end = body.indexOf("on conflict", idx);
  const lit = parseLiterals(body.slice(idx + 1, end));
  const rows = [];
  for (let i = 0; i + arity <= lit.length; i += arity) rows.push(lit.slice(i, i + arity));
  return rows;
}

const readId = (() => {
  const stmt = db.prepare("select id from countries where name = ?");
  return (name) => stmt.get(name)?.id ?? null;
})();
// --- countries: 0002 (mundo, PT-PT) — "Reino Unido" vira Inglaterra (0023) ---
const countryNames = new Set([...parseLiterals(mig("0002_seed_countries.sql")), ...parseLiterals(mig("0023_uk_countries.sql"))]);
countryNames.delete("Reino Unido"); // end state: renamed to Inglaterra
const insCountry = db.prepare("insert or ignore into countries (id, name) values (?, ?)");
let nCountries = 0;
db.transaction(() => {
  for (const name of countryNames) {
    const r = insCountry.run(crypto.randomUUID(), name);
    nCountries += r.changes;
  }
})();
console.log(`✓ countries: +${nCountries} (${countryNames.size} na lista)`);

// --- teams (4 partes): (name, country, aliases) ---
const insTeam = db.prepare(
  `insert into teams (id, name, country_id, aliases) values (?, ?, ?, ?)
   on conflict (name, country_id) do update set aliases = coalesce(teams.aliases, excluded.aliases)`
);
let nTeams = 0;
for (const f of ["0024_seed_teams_part1.sql", "0025_seed_teams_part2.sql", "0026_seed_teams_part3.sql", "0027_seed_teams_part4.sql"]) {
  const rows = valuesSection(mig(f), 3);
  const missingCountries = new Set();
  db.transaction(() => {
    for (const [name, country, aliases] of rows) {
      const cid = readId(country);
      if (!cid) {
        missingCountries.add(country);
        continue;
      }
      nTeams += insTeam.run(crypto.randomUUID(), name, cid, aliases).changes;
    }
  })();
  const miss = [...missingCountries].join(", ");
  console.log(`✓ ${f}: ${rows.length} equipas${miss ? ` — países em falta: ${miss}` : ""}`);
}

// --- competitions: (name, country) ---
const insComp = db.prepare("insert or ignore into competitions (id, name, country_id) values (?, ?, ?)");
const rowsComp = valuesSection(mig("0028_seed_competitions.sql"), 2);
let nComp = 0;
db.transaction(() => {
  for (const [name, country] of rowsComp) {
    const cid = readId(country);
    if (!cid) continue;
    nComp += insComp.run(crypto.randomUUID(), name, cid).changes;
  }
})();
console.log(`✓ competitions: +${nComp} de ${rowsComp.length}`);

db.close();
console.log("Feito — seeds vivem agora na SQLite local.");
