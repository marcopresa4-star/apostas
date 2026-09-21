import type { Fixture, PlayedMatch } from "./footballModel";

// Results and the next few days' games from football-data.co.uk (free CSV files,
// no key). The results files hold a whole season of one league, with half-time
// scores; "fixtures.csv" holds the games of the next days for most of the same
// leagues, updated a couple of times a week, and has no rounds. Austria (and a
// few other countries) come in another layout with all the seasons in one file.
// Names of the clubs are the site's own ("Sp Braga", "Man United").

const BASE = "https://www.football-data.co.uk";
const TTL_MS = 3 * 60 * 60 * 1000;

// Leagues whose file is the "new" layout: Country,League,Season,Date,Time,Home,Away,HG,AG...
const NEW_LAYOUT = new Set(["AUT"]);
export const isNewLayout = (fd: string): boolean => NEW_LAYOUT.has(fd);

export type Row = Record<string, string>;

// A CSV file as rows keyed by the header (a byte order mark, quotes and CRLF handled).
export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

// "20/09/2026" or "09/08/14" -> "2026-09-20" / "2014-08-09"; null if it is not a date.
export function isoDate(text: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text.trim());
  if (!m) return null;
  const year = m[3].length === 2 ? (Number(m[3]) < 60 ? 2000 : 1900) + Number(m[3]) : Number(m[3]);
  return `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

// "2026-27" -> "2627", the folder of that season's files.
export const seasonFolder = (season: string): string => season.slice(2, 4) + season.slice(5);

const goals = (text: string | undefined): number | null => {
  if (text === undefined || text.trim() === "") return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

// The games with a result in a results file of the main layout.
export function matchesFromMain(rows: Row[]): PlayedMatch[] {
  const out: PlayedMatch[] = [];
  for (const r of rows) {
    const date = isoDate(r.Date ?? "");
    const hg = goals(r.FTHG);
    const ag = goals(r.FTAG);
    if (!date || hg === null || ag === null || !r.HomeTeam || !r.AwayTeam) continue;
    const hth = goals(r.HTHG);
    const hta = goals(r.HTAG);
    out.push({
      date,
      team1: r.HomeTeam,
      team2: r.AwayTeam,
      ft: [hg, ag],
      ht: hth !== null && hta !== null ? [hth, hta] : null,
    });
  }
  return out;
}

// Same for the "new" layout, which has no half-time score.
export function matchesFromNew(rows: Row[]): PlayedMatch[] {
  const out: PlayedMatch[] = [];
  for (const r of rows) {
    const date = isoDate(r.Date ?? "");
    const hg = goals(r.HG);
    const ag = goals(r.AG);
    if (!date || hg === null || ag === null || !r.Home || !r.Away) continue;
    out.push({ date, team1: r.Home, team2: r.Away, ft: [hg, ag], ht: null });
  }
  return out;
}

// The games of a season (1 July to 30 June) in a list that spans several.
export function inSeason(matches: PlayedMatch[], season: string): PlayedMatch[] {
  const start = Number(season.slice(0, 4));
  return matches.filter((m) => m.date >= `${start}-07-01` && m.date <= `${start + 1}-06-30`);
}

export interface Upcoming {
  date: string;
  time: string | undefined;
  team1: string;
  team2: string;
}

// The games of one league in fixtures.csv.
export function upcomingFrom(rows: Row[], div: string): Upcoming[] {
  const out: Upcoming[] = [];
  for (const r of rows) {
    if (r.Div !== div) continue;
    const date = isoDate(r.Date ?? "");
    if (!date || !r.HomeTeam || !r.AwayTeam) continue;
    out.push({ date, time: /^\d{1,2}:\d{2}$/.test(r.Time ?? "") ? r.Time : undefined, team1: r.HomeTeam, team2: r.AwayTeam });
  }
  return out;
}

const DAY_MS = 86_400_000;
const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

// These files have no rounds, so games are grouped by the days they are played:
// a gap of more than two days starts a new group ("a weekend", "a midweek round").
export function withRounds(fixtures: Fixture[]): Fixture[] {
  const sorted = [...fixtures].sort((a, b) => `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`));
  const groups: Fixture[][] = [];
  for (const f of sorted) {
    const last = groups.at(-1)?.at(-1);
    const gap = last ? (new Date(`${f.date}T12:00:00`).getTime() - new Date(`${last.date}T12:00:00`).getTime()) / DAY_MS : Infinity;
    if (gap > 2) groups.push([f]);
    else groups.at(-1)!.push(f);
  }
  return groups.flatMap((g) => {
    const from = g[0].date;
    const to = g.at(-1)!.date;
    const round = from === to ? `Jogos de ${dayMonth(from)}` : `Jogos de ${dayMonth(from)} a ${dayMonth(to)}`;
    return g.map((f) => ({ ...f, round }));
  });
}

// --- fetching, with a short memory ------------------------------------------

const cache = new Map<string, { at: number; text: string | null }>();

function decode(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

// null when there is no such file (or it could not be read).
async function fetchText(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.text;
  let text: string | null = null;
  let missing = false;
  try {
    const res = await fetch(`${BASE}/${path}`, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (res.ok) text = decode(await res.arrayBuffer());
    else missing = res.status === 404;
  } catch {
    text = null;
  }
  // A failure is remembered only briefly, a file that does not exist for the whole time.
  cache.set(path, { at: text || missing ? Date.now() : Date.now() - TTL_MS + 60_000, text });
  return text;
}

// The rows of a league's results file for one season ("2026-27").
export async function fetchResults(fd: string, season: string): Promise<Row[] | null> {
  const text = await fetchText(isNewLayout(fd) ? `new/${fd}.csv` : `mmz4281/${seasonFolder(season)}/${fd}.csv`);
  return text === null ? null : parseCsv(text);
}

export async function fetchFixtures(): Promise<Row[] | null> {
  const text = await fetchText("fixtures.csv");
  return text === null ? null : parseCsv(text);
}
