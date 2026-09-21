import type { Fixture, PlayedMatch } from "./footballModel";
import { canonicalNames } from "./teamNames";
import {
  fetchFixtures,
  fetchResults,
  inSeason,
  isNewLayout,
  matchesFromMain,
  matchesFromNew,
  seasonRange,
  upcomingFrom,
  withRounds,
} from "./footballDataUk";
import { WINDOW_YEARS, type IntlGame } from "./internationalModel";
import { activeTeams, isoDaysAgo, loadInternationalGames, toPlayed } from "./internationalData";

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
  { code: "ro.1", fd: "ROU", label: "Roménia · Superliga" },
  { code: "pl.1", fd: "POL", label: "Polónia · Ekstraklasa" },
  { code: "dk.1", fd: "DNK", label: "Dinamarca · Superliga" },
  { code: "ch.1", fd: "SWZ", label: "Suíça · Super League" },
  { code: "mx.1", fd: "MEX", label: "México · Liga MX" },
  { code: "jp.1", fd: "JPN", label: "Japão · J1 League" },
  { code: "br.1", fd: "BRA", label: "Brasil · Série A" },
  { code: "ar.1", fd: "ARG", label: "Argentina · Liga Profesional" },
  { code: "us.1", fd: "USA", label: "EUA · MLS" },
  { code: "no.1", fd: "NOR", label: "Noruega · Eliteserien" },
  { code: "se.1", fd: "SWE", label: "Suécia · Allsvenskan" },
  { code: "fi.1", fd: "FIN", label: "Finlândia · Veikkausliiga" },
  { code: "ie.1", fd: "IRL", label: "Irlanda · Premier Division" },
  { code: "cn.1", fd: "CHN", label: "China · Super League" },
  // National teams: not a league, so `fd` is empty; see internationalModel.ts.
  { code: "int.1", fd: "", label: "Seleções · Todas" },
  { code: "int.nl", fd: "", label: "Seleções · Liga das Nações (UEFA)" },
] as const;

// National teams instead of a league: their own model, no calendar and no table.
export const isInternational = (code: string): boolean => code.startsWith("int.");

// Leagues the calendar project (openfootball) does not have at all: they are
// read from football-data.co.uk only.
const ONLY_FOOTBALL_DATA = new Set(["ro.1", "pl.1", "dk.1", "ch.1", "mx.1", "jp.1", "br.1", "ar.1", "us.1", "no.1", "se.1", "fi.1", "ie.1", "cn.1"]);

// Seasons that run over a calendar year (March to November) rather than from
// summer to spring. Japan is not here: it moved to August to May in 2026/27.
const CALENDAR_YEAR = new Set(["br.1", "ar.1", "us.1", "no.1", "se.1", "fi.1", "ie.1", "cn.1"]);

// One division of a file that holds several.
const DIVISION: Record<string, string> = { "ch.1": "Super League" };

// Whether the league has games still to come in the data at all: the files of
// some countries only have results.
export function hasFixtures(code: string): boolean {
  const league = LEAGUES.find((l) => l.code === code);
  return league ? !isInternational(code) && !isNewLayout(league.fd) : false;
}

export const seasonKindOf = (code: string): "summer" | "calendar" => (CALENDAR_YEAR.has(code) ? "calendar" : "summer");

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

// "2026-27" for a date in September 2026 (a season starts around July), newest
// first; for a calendar-year league it is "2026".
export function seasonsFor(now: Date, count = SEASONS_BACK, kind: "summer" | "calendar" = "summer"): string[] {
  if (kind === "calendar") return Array.from({ length: count }, (_, i) => String(now.getFullYear() - i));
  const start = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return Array.from({ length: count }, (_, i) => {
    const y = start - i;
    return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  });
}

export interface SeasonInfo {
  id: string; // "2026-27" or "2026"
  from: string; // first day
  to: string; // last day
  label: string; // "26/27" or "2026"
}

export function seasonInfo(id: string): SeasonInfo {
  return { id, ...seasonRange(id), label: /^\d{4}$/.test(id) ? id : seasonLabel(id) };
}

// The season before this one.
export function previousSeason(season: SeasonInfo): SeasonInfo {
  if (/^\d{4}$/.test(season.id)) return seasonInfo(String(Number(season.id) - 1));
  const y = Number(season.id.slice(0, 4)) - 1;
  return seasonInfo(`${y}-${String((y + 1) % 100).padStart(2, "0")}`);
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
  // For national teams: the games the model is fitted on.
  intl?: IntlGame[];
  // The season the league is in (the newest one with games).
  season: SeasonInfo;
  // What the calendar holds: the whole season by "rounds", only the next few
  // "days" (football-data.co.uk), or "none" (results only, no games to come).
  calendar: "rounds" | "days" | "none";
}

// "2018-19" -> "2018/19"; a calendar year stays "2024".
export const seasonSpan = (season: string): string => (/^\d{4}$/.test(season) ? season : `${season.slice(0, 4)}/${season.slice(5)}`);

// The league read from football-data.co.uk: results of the last seasons from its
// files, and as calendar the games of the season plus the next days' fixtures
// (grouped by the days they are played, as these files have no rounds; some
// countries have no fixtures at all). The current season is the newest one with
// games: a new one has none until it starts. null if there are no games.
async function loadFromFootballData(
  league: { code: string; fd: string },
  now: Date,
  options: { history?: boolean }
): Promise<LeagueData | null> {
  const fd = league.fd;
  const newLayout = isNewLayout(fd);
  const ids = seasonsFor(now, HISTORY_TOTAL, seasonKindOf(league.code)); // newest first

  // The "new layout" file holds every season, so it is read once.
  let everything: PlayedMatch[] = [];
  if (newLayout) {
    const rows = await fetchResults(fd, ids[0]);
    everything = rows ? matchesFromNew(rows, DIVISION[league.code]) : [];
  }
  const bySeason = new Map<string, PlayedMatch[]>();
  const games = async (id: string): Promise<PlayedMatch[]> => {
    let list = bySeason.get(id);
    if (!list) {
      if (newLayout) list = inSeason(everything, id);
      else {
        const rows = await fetchResults(fd, id);
        list = rows ? matchesFromMain(rows) : [];
      }
      bySeason.set(id, list);
    }
    return list;
  };

  let at = -1;
  for (let i = 0; i < 2 && at < 0; i++) if ((await games(ids[i])).length > 0) at = i;
  if (at < 0) return null;
  const wanted = ids.slice(at, at + SEASONS_BACK);
  const older = options.history ? ids.slice(at + SEASONS_BACK) : [];
  await Promise.all([...wanted, ...older].map(games));

  const current = await games(ids[at]);
  const matches = wanted
    .flatMap((id) => bySeason.get(id) ?? [])
    .sort((a, b) => a.date.localeCompare(b.date));
  const seasons = wanted.filter((id) => (bySeason.get(id) ?? []).length > 0);

  // The season's calendar: what was played, and the games coming that the
  // results do not have yet (some already played, whose result is still missing).
  let fixtures: Fixture[] = current.map((m) => ({ date: m.date, team1: m.team1, team2: m.team2, ft: m.ft }));
  if (!newLayout && at === 0) {
    const played = new Set(current.map((m) => `${m.date}|${m.team1}|${m.team2}`));
    const fixtureRows = await fetchFixtures();
    for (const u of fixtureRows ? upcomingFrom(fixtureRows, fd) : []) {
      if (played.has(`${u.date}|${u.team1}|${u.team2}`)) continue;
      fixtures.push({ date: u.date, team1: u.team1, team2: u.team2, ft: null, time: u.time });
    }
    fixtures = withRounds(fixtures);
  }
  const teams = [...new Set(fixtures.flatMap((f) => [f.team1, f.team2]))].sort((a, b) => a.localeCompare(b));

  const history: PlayedMatch[] = [];
  let oldest = seasons.at(-1) ?? null;
  if (older.length > 0) {
    const canon = canonicalNames([...new Set([...teams, ...matches.flatMap((m) => [m.team1, m.team2])])]);
    for (const id of older) {
      const list = bySeason.get(id) ?? [];
      if (list.length === 0) continue;
      oldest = id;
      for (const m of list) history.push({ ...m, team1: canon(m.team1), team2: canon(m.team2) });
    }
  }

  return {
    matches,
    teams,
    fixtures,
    latest: matches.at(-1)?.date ?? null,
    seasons,
    history,
    historyFrom: oldest ? seasonSpan(oldest) : null,
    season: seasonInfo(ids[at]),
    calendar: newLayout ? "none" : "days",
  };
}

// National teams: the last WINDOW_YEARS of games feed the model, the "season" is
// the last twelve months, and the older games since 1990 are for the head to head.
async function loadInternational(code: string, now: Date, options: { history?: boolean }): Promise<LeagueData | null> {
  const all = await loadInternationalGames();
  if (!all || all.length === 0) return null;
  const windowFrom = isoDaysAgo(now, WINDOW_YEARS * 365);
  const recent = all.filter((g) => g.date >= windowFrom);
  const from = isoDaysAgo(now, 365);
  const teams = activeTeams(all, now, code === "int.nl" ? "UEFA Nations League" : undefined);
  return {
    matches: recent.map(toPlayed),
    teams,
    // The games of the last twelve months, each with its competition.
    fixtures: recent
      .filter((g) => g.date >= from)
      .map((g) => ({ date: g.date, team1: g.home, team2: g.away, ft: [g.hg, g.ag] as [number, number], competition: g.tournament })),
    latest: all.at(-1)?.date ?? null,
    seasons: [],
    history: options.history ? all.filter((g) => g.date < windowFrom).map(toPlayed) : [],
    historyFrom: options.history ? all[0].date.slice(0, 4) : null,
    intl: recent,
    season: { id: "12m", from, to: now.toISOString().slice(0, 10), label: "últimos 12 meses" },
    calendar: "none",
  };
}

export async function loadLeague(
  code: string,
  now: Date,
  options: { history?: boolean } = {}
): Promise<LeagueData | null> {
  const league = LEAGUES.find((l) => l.code === code);
  if (!league) return null;
  if (isInternational(code)) return loadInternational(code, now, options);

  // Not in the calendar project at all: only the other source has it.
  if (ONLY_FOOTBALL_DATA.has(code)) return loadFromFootballData(league, now, options);

  const wanted = seasonsFor(now);
  const files = await Promise.all(wanted.map((season) => fetchSeason(season, code)));

  // No file of the current season: read the league from the other source. If
  // that fails too, what there is of the older seasons is still used.
  if (!files[0]) {
    const other = await loadFromFootballData(league, now, options);
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
    season: seasonInfo(seasons[0]),
    calendar: "rounds",
  };
}
