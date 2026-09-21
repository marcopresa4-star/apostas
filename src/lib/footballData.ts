import type { Fixture, PlayedMatch } from "./footballModel";
import { canonicalNames } from "./teamNames";
import {
  fetchFixtures,
  fetchResults,
  inSeason,
  isNewLayout,
  matchesFromMain,
  matchesFromNew,
  upcomingFrom,
  withRounds,
} from "./footballDataUk";

// Free results of the main European leagues from the openfootball project
// (public domain JSON on GitHub, no key): date, teams, full-time and half-time
// score for every game of a season, and the whole calendar by rounds.
//
// Not every league of it is kept up to date (in some the files of the current
// season do not exist, or stop in November), so when there is no file for the
// current season the league is read from football-data.co.uk instead, see
// footballDataUk.ts: results with half-time scores, and only the next few days
// of fixtures. `fd` is the league's code in those files.
const BASE = "https://raw.githubusercontent.com/openfootball/football.json/master";

export const LEAGUES = [
  { code: "pt.1", fd: "P1", label: "Portugal · Primeira Liga" },
  { code: "en.1", fd: "E0", label: "Inglaterra · Premier League" },
  { code: "en.2", fd: "E1", label: "Inglaterra · Championship" },
  { code: "en.3", fd: "E2", label: "Inglaterra · League One" },
  { code: "en.4", fd: "E3", label: "Inglaterra · League Two" },
  { code: "es.1", fd: "SP1", label: "Espanha · La Liga" },
  { code: "es.2", fd: "SP2", label: "Espanha · Segunda División" },
  { code: "it.1", fd: "I1", label: "Itália · Serie A" },
  { code: "it.2", fd: "I2", label: "Itália · Serie B" },
  { code: "de.1", fd: "D1", label: "Alemanha · Bundesliga" },
  { code: "de.2", fd: "D2", label: "Alemanha · 2. Bundesliga" },
  { code: "fr.1", fd: "F1", label: "França · Ligue 1" },
  { code: "fr.2", fd: "F2", label: "França · Ligue 2" },
  { code: "nl.1", fd: "N1", label: "Países Baixos · Eredivisie" },
  { code: "be.1", fd: "B1", label: "Bélgica · Pro League" },
  { code: "at.1", fd: "AUT", label: "Áustria · Bundesliga" },
  { code: "sco.1", fd: "SC0", label: "Escócia · Premiership" },
  { code: "tr.1", fd: "T1", label: "Turquia · Süper Lig" },
  { code: "gr.1", fd: "G1", label: "Grécia · Super League" },
] as const;

const SEASONS_BACK = 3;
// Head to head goes further back than the model does: the seasons the model
// uses plus these many older ones (the files simply do not exist for some
// leagues, from some year on).
const HISTORY_TOTAL = 13;
const TTL_MS = 3 * 60 * 60 * 1000;

interface RawMatch {
  round?: string;
  time?: string;
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
  // Older seasons, only loaded when asked for (head to head): their games are
  // not in `matches`, so the model does not use them.
  history: PlayedMatch[];
  // The oldest season with data, "2018/19", or null if only the recent ones.
  historyFrom: string | null;
  // The calendar only has the next few days' games, not the whole season by
  // rounds (leagues read from football-data.co.uk).
  calendarDays: boolean;
}

// "2018-19" -> "2018/19"
export const seasonSpan = (season: string): string => `${season.slice(0, 4)}/${season.slice(5)}`;

// The league read from football-data.co.uk: results of the last seasons from its
// files, and as calendar the games of the season plus the next days' fixtures
// (grouped by the days they are played, as these files have no rounds). null if
// the current season has no games there.
async function loadFromFootballData(
  fd: string,
  now: Date,
  options: { history?: boolean }
): Promise<LeagueData | null> {
  const wanted = seasonsFor(now);
  const older = options.history ? seasonsFor(now, HISTORY_TOTAL).slice(SEASONS_BACK) : [];
  const all = [...wanted, ...older];

  // The "new layout" file holds every season, so it is read once.
  const bySeason = new Map<string, PlayedMatch[]>();
  if (isNewLayout(fd)) {
    const rows = await fetchResults(fd, wanted[0]);
    const everything = rows ? matchesFromNew(rows) : [];
    for (const season of all) bySeason.set(season, inSeason(everything, season));
  } else {
    const files = await Promise.all(all.map((season) => fetchResults(fd, season)));
    files.forEach((rows, i) => bySeason.set(all[i], rows ? matchesFromMain(rows) : []));
  }

  const current = bySeason.get(wanted[0]) ?? [];
  if (current.length === 0) return null;

  const matches = wanted
    .flatMap((season) => bySeason.get(season) ?? [])
    .sort((a, b) => a.date.localeCompare(b.date));
  const seasons = wanted.filter((season) => (bySeason.get(season) ?? []).length > 0);

  // The season's calendar: what was played, and the games coming that the
  // results do not have yet (some already played, whose result is still missing).
  const fixtures: Fixture[] = current.map((m) => ({ date: m.date, team1: m.team1, team2: m.team2, ft: m.ft }));
  const played = new Set(current.map((m) => `${m.date}|${m.team1}|${m.team2}`));
  const fixtureRows = isNewLayout(fd) ? null : await fetchFixtures();
  for (const u of fixtureRows ? upcomingFrom(fixtureRows, fd) : []) {
    if (played.has(`${u.date}|${u.team1}|${u.team2}`)) continue;
    fixtures.push({ date: u.date, team1: u.team1, team2: u.team2, ft: null, time: u.time });
  }
  const teams = [...new Set(fixtures.flatMap((f) => [f.team1, f.team2]))].sort((a, b) => a.localeCompare(b));

  const history: PlayedMatch[] = [];
  let oldest = seasons.at(-1) ?? null;
  if (older.length > 0) {
    const canon = canonicalNames([...new Set([...teams, ...matches.flatMap((m) => [m.team1, m.team2])])]);
    for (const season of older) {
      const games = bySeason.get(season) ?? [];
      if (games.length === 0) continue;
      oldest = season;
      for (const m of games) history.push({ ...m, team1: canon(m.team1), team2: canon(m.team2) });
    }
  }

  return {
    matches,
    teams,
    fixtures: withRounds(fixtures),
    latest: matches.at(-1)?.date ?? null,
    seasons,
    history,
    historyFrom: oldest ? seasonSpan(oldest) : null,
    calendarDays: true,
  };
}

export async function loadLeague(
  code: string,
  now: Date,
  options: { history?: boolean } = {}
): Promise<LeagueData | null> {
  const league = LEAGUES.find((l) => l.code === code);
  if (!league) return null;

  const wanted = seasonsFor(now);
  const files = await Promise.all(wanted.map((season) => fetchSeason(season, code)));

  // No file of the current season: read the league from the other source. If
  // that fails too, what there is of the older seasons is still used.
  if (!files[0]) {
    const other = await loadFromFootballData(league.fd, now, options);
    if (other) return other;
  }

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
        round: m.round,
        time: m.time,
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

  const history: PlayedMatch[] = [];
  let oldest = seasons.at(-1) ?? null;
  if (options.history) {
    const older = seasonsFor(now, HISTORY_TOTAL).slice(SEASONS_BACK);
    const olderFiles = await Promise.all(older.map((season) => fetchSeason(season, code)));
    // Old files may spell a club differently: what they call it is mapped to the
    // name it has today (the model's seasons already agree on it).
    const canon = canonicalNames([...new Set([...teams, ...matches.flatMap((m) => [m.team1, m.team2])])]);
    olderFiles.forEach((file, i) => {
      if (!file) return;
      oldest = older[i];
      for (const m of file) {
        if (!m.score?.ft) continue;
        history.push({
          date: m.date,
          team1: canon(m.team1),
          team2: canon(m.team2),
          ft: m.score.ft,
          ht: m.score.ht ?? null,
        });
      }
    });
  }
  return {
    matches,
    teams,
    fixtures,
    latest: matches.at(-1)?.date ?? null,
    seasons,
    history,
    historyFrom: oldest ? seasonSpan(oldest) : null,
    calendarDays: false,
  };
}

// The dates of this season so far, or of the whole last one, and its label.
export function seasonWindow(now: Date, which: "atual" | "passada"): { from: string; to: string; label: string } {
  const current = seasonsFor(now, 1)[0];
  const startYear = Number(current.slice(0, 4));
  if (which === "atual") {
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return { from: `${startYear}-07-01`, to: today, label: seasonLabel(current) };
  }
  return {
    from: `${startYear - 1}-07-01`,
    to: `${startYear}-06-30`,
    label: seasonLabel(seasonsFor(now, 2)[1]),
  };
}
