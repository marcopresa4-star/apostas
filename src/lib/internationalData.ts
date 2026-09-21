import type { PlayedMatch } from "./footballModel";
import type { IntlGame } from "./internationalModel";
import { parseCsv, type Row } from "./footballDataUk";

// Results of every game between national teams since 1872, from the free
// "international_results" project on GitHub (public domain, no key): friendlies,
// qualifiers, the Nations Leagues, the World Cup... with whether the venue was
// neutral. It has no fixtures, no half-time scores and no groups, and is updated
// by hand every week or two.
const URL = "https://raw.githubusercontent.com/martj42/international_results/master/results.csv";
const TTL_MS = 3 * 60 * 60 * 1000;
// Older games are kept for the head to head only.
const HISTORY_FROM = "1990-01-01";

let cache: { at: number; rows: Row[] | null } | null = null;

async function fetchRows(): Promise<Row[] | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  let rows: Row[] | null = null;
  try {
    const res = await fetch(URL, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
    if (res.ok) rows = parseCsv(await res.text());
  } catch {
    rows = null;
  }
  cache = { at: rows ? Date.now() : Date.now() - TTL_MS + 60_000, rows };
  return rows;
}

// The games with a result, oldest first. `since` drops the older ones.
export function gamesFrom(rows: Row[], since = HISTORY_FROM): IntlGame[] {
  const out: IntlGame[] = [];
  for (const r of rows) {
    const hg = Number(r.home_score);
    const ag = Number(r.away_score);
    if (!r.date || r.date < since || r.home_score === "" || r.away_score === "" || !Number.isInteger(hg) || !Number.isInteger(ag)) continue;
    out.push({
      date: r.date,
      home: r.home_team,
      away: r.away_team,
      hg,
      ag,
      neutral: r.neutral === "TRUE",
      tournament: r.tournament,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export async function loadInternationalGames(): Promise<IntlGame[] | null> {
  const rows = await fetchRows();
  return rows ? gamesFrom(rows) : null;
}

export const toPlayed = (g: IntlGame): PlayedMatch => ({
  date: g.date,
  team1: g.home,
  team2: g.away,
  ft: [g.hg, g.ag],
  ht: null,
  competition: g.tournament,
  ...(g.neutral ? { neutral: true } : {}),
});

const DAY_MS = 86_400_000;
export const isoDaysAgo = (now: Date, days: number): string => new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);

// The teams worth listing: those with at least MIN_GAMES games in the last three
// years; or, for a competition, those that played it in the last two and a half.
const MIN_GAMES = 6;
export function activeTeams(games: IntlGame[], now: Date, tournament?: string): string[] {
  const counts = new Map<string, number>();
  const since = isoDaysAgo(now, tournament ? 913 : 3 * 365);
  for (const g of games) {
    if (g.date < since) continue;
    if (tournament && g.tournament !== tournament) continue;
    counts.set(g.home, (counts.get(g.home) ?? 0) + 1);
    counts.set(g.away, (counts.get(g.away) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => tournament || n >= MIN_GAMES)
    .map(([team]) => team)
    .sort((a, b) => a.localeCompare(b));
}
