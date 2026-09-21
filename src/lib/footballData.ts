import type { Fixture, PlayedMatch } from "./footballModel";

// Free results of the main European leagues from the openfootball project
// (public domain JSON on GitHub, no key): date, teams, full-time and half-time
// score for every game of a season. Only goals, so no corners, cards or shots.
// Brazil, Mexico, the US, Argentina and Greece are not covered (Greece stops in
// November 2025 and has no 2026/27 file).
const BASE = "https://raw.githubusercontent.com/openfootball/football.json/master";

export const LEAGUES = [
  { code: "pt.1", label: "Portugal · Primeira Liga" },
  { code: "en.1", label: "Inglaterra · Premier League" },
  { code: "en.2", label: "Inglaterra · Championship" },
  { code: "en.3", label: "Inglaterra · League One" },
  { code: "en.4", label: "Inglaterra · League Two" },
  { code: "es.1", label: "Espanha · La Liga" },
  { code: "es.2", label: "Espanha · Segunda División" },
  { code: "it.1", label: "Itália · Serie A" },
  { code: "it.2", label: "Itália · Serie B" },
  { code: "de.1", label: "Alemanha · Bundesliga" },
  { code: "de.2", label: "Alemanha · 2. Bundesliga" },
  { code: "fr.1", label: "França · Ligue 1" },
  { code: "fr.2", label: "França · Ligue 2" },
  { code: "nl.1", label: "Países Baixos · Eredivisie" },
  { code: "be.1", label: "Bélgica · Pro League" },
  { code: "at.1", label: "Áustria · Bundesliga" },
  { code: "sco.1", label: "Escócia · Premiership" },
  { code: "tr.1", label: "Turquia · Süper Lig" },
] as const;

const SEASONS_BACK = 3;
const TTL_MS = 6 * 60 * 60 * 1000;

interface RawMatch {
  date: string;
  team1: string;
  team2: string;
  score?: { ft?: [number, number]; ht?: [number, number] };
}

// "2026-27" for a date in September 2026; a season starts around July.
export function seasonsFor(now: Date, count = SEASONS_BACK): string[] {
  const start = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return Array.from({ length: count }, (_, i) => {
    const y = start - i;
    return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  });
}

// The first day of the current season ("2026-07-01"): what counts as "this
// season" when only its own games are wanted.
export function seasonStartDate(now: Date): string {
  return `${seasonsFor(now, 1)[0].slice(0, 4)}-07-01`;
}

// "2026-27" -> "26/27"
export function seasonLabel(season: string): string {
  return `${season.slice(2, 4)}/${season.slice(5)}`;
}

const cache = new Map<string, { at: number; matches: RawMatch[] | null }>();

// null when the season has no file (or it could not be read).
async function fetchSeason(season: string, code: string): Promise<RawMatch[] | null> {
  const key = `${season}/${code}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.matches;

  let matches: RawMatch[] | null = null;
  try {
    const res = await fetch(`${BASE}/${season}/${code}.json`, {
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (res.ok) matches = ((await res.json()) as { matches?: RawMatch[] }).matches ?? null;
  } catch {
    matches = null;
  }
  // A failure is remembered only briefly, a missing season for the whole TTL.
  cache.set(key, { at: matches ? Date.now() : Date.now() - TTL_MS + 60_000, matches });
  return matches;
}

export interface LeagueData {
  // Finished games of the last seasons, oldest first.
  matches: PlayedMatch[];
  // The teams of the latest season available.
  teams: string[];
  // Every game of that season, played or still to come.
  fixtures: Fixture[];
  // Date of the most recent result.
  latest: string | null;
  seasons: string[];
}

export async function loadLeague(code: string, now: Date): Promise<LeagueData | null> {
  if (!LEAGUES.some((l) => l.code === code)) return null;

  const wanted = seasonsFor(now);
  const files = await Promise.all(wanted.map((season) => fetchSeason(season, code)));

  const seasons: string[] = [];
  const matches: PlayedMatch[] = [];
  let teams: string[] = [];
  let fixtures: Fixture[] = [];

  files.forEach((file, i) => {
    if (!file) return;
    seasons.push(wanted[i]);
    // The first season that exists is the latest one: its teams are the current ones.
    if (teams.length === 0) {
      teams = [...new Set(file.flatMap((m) => [m.team1, m.team2]))].sort((a, b) => a.localeCompare(b));
      fixtures = file.map((m) => ({
        date: m.date,
        team1: m.team1,
        team2: m.team2,
        ft: m.score?.ft ?? null,
      }));
    }
    for (const m of file) {
      if (!m.score?.ft) continue;
      matches.push({
        date: m.date,
        team1: m.team1,
        team2: m.team2,
        ft: m.score.ft,
        ht: m.score.ht ?? null,
      });
    }
  });

  if (seasons.length === 0) return null;
  matches.sort((a, b) => a.date.localeCompare(b.date));
  return { matches, teams, fixtures, latest: matches.at(-1)?.date ?? null, seasons };
}
