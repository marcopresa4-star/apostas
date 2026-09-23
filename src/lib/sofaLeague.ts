// Phase 3: one SofaScore-backed LeagueData per mapped league, so every model
// tab can switch source with a toggle instead of a rewrite. Same shape as
// loadLeague (matches, teams, fixtures, seasons, history...), same model
// maths on top — only the reader changes. Club leagues only; national teams
// keep the files until their own mapping exists.
import type { SupabaseClient } from "@supabase/supabase-js";
import { seasonKindOf, seasonInfo, seasonSpan, type LeagueData } from "./footballData";
import { slugify } from "./slugify";
import { todayISO } from "./searchParams";
import type { Fixture, PlayedMatch } from "./footballModel";
import {
  loadMaps,
  seasonFixtures,
  seasonResults,
  seasonStandings,
  seasonStandingsTables,
  seasonTeamNames,
  tournamentSeasons,
  eventGoalMinutes,
  teamEvents,
  searchTeams,
  lisbonParts,
  alignScore,
  type SofaMap,
  type SofaSeason,
} from "./sofaHistory";
import { sofaRaw } from "./sofaRaw";
import { parseSofascoreId } from "./sofascore";
import { cacheGet, cacheSet, DAY_MS, HOUR_MS } from "./sofaCache";
// SofaScore season year ("26/27", "2026") -> the file-style id the rest of the
// app reasons about ("2026-27", "2026").
function fileSeasonId(year: string, code: string): string {
  if (/^\d{4}$/.test(year)) return year;
  const m = /^(\d{2})\/(\d{2})$/.exec(year);
  if (!m) return year;
  const start = 2000 + Number(m[1]);
  return seasonKindOf(code) === "calendar" ? String(start) : `${start}-${m[2]}`;
}

export interface SofaLeague {
  data: LeagueData;
  // SofaScore spellings with no local link (counted apart, flagged in UI).
  unlinked: string[];
  // Season names as SofaScore spells them, newest first.
  seasonNames: string[];
  // Official standings tables of the current season (leagues with conferences
  // get one each): official W/D/L/points with local spellings, for the table
  // selector. Strength columns still come from our own ratings.
  tables: { name: string; rows: OfficialStanding[] }[];
}

export interface OfficialStanding {
  position: number;
  team: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  points: number;
}

// The SofaScore event id rides on each fixture (as `sid`) so later reads —
// a finished game's real odds for the profit check — can find the game.
// Fixture itself is untouched (shared model type).
export interface SofaFixtureWithId extends Fixture {
  sid: number;
}

export function fixtureEventId(f: Fixture): number | null {
  const sid = (f as Partial<SofaFixtureWithId>).sid;
  return typeof sid === "number" && Number.isInteger(sid) && sid > 0 ? sid : null;
}

export async function loadSofaLeague(
  supabase: SupabaseClient,
  userId: string,
  code: string,
  options: { history?: boolean; fixtures?: boolean } = {}
): Promise<SofaLeague | null> {
  const wantFixtures = options.fixtures ?? true;
  const maps = await loadMaps(supabase, userId, "tournament");
  const map = maps.find((m) => m.name_key === code);
  if (!map) return null;
  const uniqueId = map.sofascore_id;

  const seasons: SofaSeason[] = await tournamentSeasons(supabase, userId, uniqueId).catch(() => []);
  if (seasons.length === 0) return null;

  // The season being played: the newest season with any fixtures at all (a
  // future season may already exist but hold no games, then the previous one
  // wins). Only the two newest seasons qualify: archived seasons can outlive
  // the current one's structure (MLS 2026 lists no rounds while 2018 still
  // serves full fixtures), and picking one freezes the league in the past. A
  // newest season with no games at all is a data hole, handled by the
  // team-events fallback below. Skipped when only results matter.
  let currentIdx = 0;
  const fixturesBySeason = new Map<number, Awaited<ReturnType<typeof seasonFixtures>>>();
  if (wantFixtures) {
    const today = todayISO(new Date());
    for (let i = 0; i < Math.min(2, seasons.length); i++) {
      const fx = await seasonFixtures(supabase, userId, uniqueId, seasons[i].id, i === 0, today).catch(() => []);
      fixturesBySeason.set(seasons[i].id, fx);
      if (fx.length > 0) {
        currentIdx = i;
        break;
      }
    }
  }
  const current = seasons[currentIdx];
  const currentFx = fixturesBySeason.get(current.id) ?? [];

  // Local spellings: linked names convert, the rest stays in SofaScore
  // spelling and is flagged (never silently dropped).
  const teamMaps = await loadMaps(supabase, userId, "team");
  const toLocal = new Map<string, string>();
  for (const m of teamMaps) {
    if (m.local_name) toLocal.set(m.name, m.local_name);
  }
  const unlinked = new Set<string>();
  const convert = (name: string): string => {
    const local = toLocal.get(name);
    if (local) return local;
    unlinked.add(name);
    return name;
  };
  const convertFixture = (f: Fixture & Partial<SofaFixtureWithId>): SofaFixtureWithId => ({
    date: f.date,
    team1: convert(f.team1),
    team2: convert(f.team2),
    ft: f.ft ?? null,
    round: typeof f.round === "string" ? f.round : "",
    time: f.time ?? undefined,
    sid: typeof f.sid === "number" ? f.sid : 0,
  });

  const convertMatch = (m: PlayedMatch): PlayedMatch => ({ ...m, team1: convert(m.team1), team2: convert(m.team2) });

  // Seasons with no rounds on SofaScore (MLS 2026 lists none): the round path
  // above finds no fixtures and no results for the season being played.
  // Collect it from the teams' own event lists instead (league games only).
  let fallback: { results: PlayedMatch[]; fixtures: Fixture[] } | null = null;
  if (currentFx.length === 0) {
    const rows = await seasonStandings(supabase, userId, uniqueId, current.id, true).catch(() => []);
    const names = [...new Set(rows.map((r) => r.team))];
    const { resolved: teamIdByName } = await resolveLeagueTeamIds(supabase, userId, teamMaps, names).catch(
      () => ({ resolved: new Map<string, number>(), missing: names })
    );
    if (teamIdByName.size > 0) {
      fallback = await seasonEventsFromTeams(supabase, userId, uniqueId, current.id, teamIdByName).catch(
        () => null
      );
    }
  }

  // The model reads the last three seasons with games.
  const wanted = seasons.slice(currentIdx, currentIdx + 3);
  const matchLists = await Promise.all(
    wanted.map((s, i) => seasonResults(supabase, userId, uniqueId, s.id, i === 0, true).catch(() => [] as PlayedMatch[]))
  );
  const seenMatch = new Set(
    matchLists.flat().map((m) => `${m.date}|${m.team1}|${m.team2}|${m.ft[0]}-${m.ft[1]}`)
  );
  const fallbackMatches = (fallback?.results ?? [])
    .map(convertMatch)
    .filter((m) => {
      const key = `${m.date}|${m.team1}|${m.team2}|${m.ft[0]}-${m.ft[1]}`;
      if (seenMatch.has(key)) return false;
      seenMatch.add(key);
      return true;
    });
  const matches = [...matchLists.flat().map(convertMatch), ...fallbackMatches].sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  const fixtures: Fixture[] = !wantFixtures
    ? []
    : currentFx.length > 0
      ? currentFx.map(
          (f): SofaFixtureWithId => ({
            date: f.date,
            team1: convert(f.team1),
            team2: convert(f.team2),
            ft: f.ft ? ([f.ft[0], f.ft[1]] as [number, number]) : null,
            round: `Matchday ${f.round}`,
            time: f.time ?? undefined,
            sid: f.id,
          })
        )
      : (fallback?.fixtures ?? []).map((f) => convertFixture(f));

  const order: string[] = [];
  const teamSource = wantFixtures ? fixtures : matches;
  for (const f of teamSource) {
    for (const t of [f.team1, f.team2]) if (!order.includes(t)) order.push(t);
  }
  order.sort((a, b) => a.localeCompare(b));

  const older = options.history ? seasons.slice(currentIdx + 3, currentIdx + 10) : [];
  const historyLists = await Promise.all(
    older.map((s) => seasonResults(supabase, userId, uniqueId, s.id, false).catch(() => [] as PlayedMatch[]))
  );
  const history = historyLists.flat().map(convertMatch).sort((a, b) => a.date.localeCompare(b.date));

  const seasonIds = wanted.map((s) => fileSeasonId(s.year, code));
  const oldest = options.history && older.length > 0 ? older[older.length - 1] : wanted[wanted.length - 1];

  const data: LeagueData = {
    matches,
    teams: order,
    fixtures,
    latest: matches.at(-1)?.date ?? null,
    seasons: seasonIds,
    history,
    historyFrom: oldest ? seasonSpan(fileSeasonId(oldest.year, code)) : null,
    source: "sofascore",
    season: seasonInfo(fileSeasonId(current.year, code)),
    calendar: "rounds",
  };
  // Official standings tables of the current season (most teams first, so the
  // overall table leads where conferences exist). One cached read.
  let tables: { name: string; rows: OfficialStanding[] }[] = [];
  try {
    const st = await seasonStandingsTables(supabase, userId, uniqueId, current.id, true).catch(
      () => []
    );
    tables = st
      .filter((t) => t.rows.length > 0)
      .map((t) => ({
        name: t.name,
        rows: t.rows.map((r) => ({
          position: r.position,
          team: convert(r.team),
          played: r.played,
          wins: r.wins,
          draws: r.draws,
          losses: r.losses,
          gf: r.goalsFor,
          ga: r.goalsAgainst,
          points: r.points,
        })),
      }))
      .sort((a, b) => b.rows.length - a.rows.length);
  } catch {
    // No official tables: the page falls back to counting our own fixtures.
  }
  return { data, unlinked: [...unlinked].sort((a, b) => a.localeCompare(b)), seasonNames: seasons.map((s) => s.name), tables };
}

// Finds the mapped league holding both clubs, from their local spellings
// (dashboard games): converts via the team links, then scans each mapped
// tournament's current-season teams. First league where both fit wins.
export async function findSofaLeague(
  supabase: SupabaseClient,
  userId: string,
  homeNames: string[],
  awayNames: string[]
): Promise<{ code: string } | null> {
  const tournaments = await loadMaps(supabase, userId, "tournament");
  if (tournaments.length === 0) return null;
  const teams = await loadMaps(supabase, userId, "team");
  // Local name (or any known spelling) -> SofaScore spelling, via links.
  const known = new Map<string, string>();
  for (const m of teams) {
    if (m.local_name) known.set(slugify(m.local_name), m.name);
    known.set(m.name_key, m.name);
  }
  const slugs = (names: string[]): string | null => {
    for (const n of names) {
      const hit = known.get(slugify(n));
      if (hit) return hit;
    }
    return null;
  };
  const homeSofa = slugs(homeNames);
  const awaySofa = slugs(awayNames);
  if (!homeSofa || !awaySofa) return null;
  for (const t of tournaments) {
    try {
      const seasons = await tournamentSeasons(supabase, userId, t.sofascore_id).catch(() => []);
      if (seasons.length === 0) continue;
      const rows = await seasonStandings(supabase, userId, t.sofascore_id, seasons[0].id, true).catch(() => []);
      const names = new Set(rows.map((r) => r.team));
      if (names.has(homeSofa) && names.has(awaySofa)) return { code: t.name_key };
    } catch {
      // Next tournament.
    }
  }
  return null;
}

export interface SofaLinkResolution {
  eventId: number;
  homeSofa: string;
  awaySofa: string;
  tournament: string;
  leagueCode: string | null;
  casa: string | null;
  fora: string | null;
  warnings: string[];
}

// Resolves a pasted SofaScore link (any status: upcoming, live or finished)
// to league + local teams for pre-match analysis: the event's tournament
// points straight at the mapped league, and the team names convert via the
// links (fuzzy fallback against the league's own teams).
export async function resolveSofaLink(
  supabase: SupabaseClient,
  userId: string,
  link: string
): Promise<SofaLinkResolution | { error: string }> {
  const eventId = parseSofascoreId(link);
  if (eventId === null) return { error: "Não encontrei o id do jogo neste link." };
  let body: unknown;
  try {
    body = await sofaRaw<unknown>(`/event/${eventId}`);
  } catch {
    return { error: "Não consegui ler o jogo (scraper desligado?)." };
  }
  if (!body) return { error: "O SofaScore não devolveu o jogo." };
  const root = (body ?? {}) as Record<string, unknown>;
  const event = (root.event ?? root) as Record<string, unknown>;
  const homeTeam = (event.homeTeam ?? {}) as Record<string, unknown>;
  const awayTeam = (event.awayTeam ?? {}) as Record<string, unknown>;
  const tournament = (event.tournament ?? {}) as Record<string, unknown>;
  const unique = (tournament.uniqueTournament ?? {}) as Record<string, unknown>;
  const homeSofa = typeof homeTeam.name === "string" ? homeTeam.name : "";
  const awaySofa = typeof awayTeam.name === "string" ? awayTeam.name : "";
  if (!homeSofa || !awaySofa) return { error: "O SofaScore não devolveu as equipas." };
  const uniqueId = typeof unique.id === "number" ? unique.id : null;

  const tournaments = await loadMaps(supabase, userId, "tournament");
  const leagueCode = uniqueId !== null ? (tournaments.find((m) => m.sofascore_id === uniqueId)?.name_key ?? null) : null;

  const teams = await loadMaps(supabase, userId, "team");
  const toLocal = new Map(teams.filter((m) => m.local_name).map((m) => [m.name, m.local_name]));
  let casa = toLocal.get(homeSofa) ?? null;
  let fora = toLocal.get(awaySofa) ?? null;
  const warnings: string[] = [];

  // Fuzzy fallback against the league's own teams (linked or not).
  if ((!casa || !fora) && leagueCode) {
    try {
      const seasons = await tournamentSeasons(supabase, userId, uniqueId ?? 0).catch(() => []);
      if (seasons.length > 0) {
        const names = await seasonTeamNames(supabase, userId, uniqueId ?? 0, seasons[0].id, true).catch(() => [] as string[]);
        const best = (sofa: string): string | null => {
          let top: { name: string; score: number } | null = null;
          for (const n of names) {
            const score = alignScore(n, sofa);
            if (!top || score > top.score) top = { name: n, score };
          }
          return top && top.score >= 3 ? (toLocal.get(top.name) ?? top.name) : null;
        };
        casa = casa ?? best(homeSofa);
        fora = fora ?? best(awaySofa);
      }
    } catch {
      // Falls through to the warnings below.
    }
  }
  if (!leagueCode) warnings.push("Torneio por mapear no Mapa — escolhe a liga à mão.");
  if (!casa || !fora) warnings.push("Uma das equipas não está ligada no Mapa — completa à mão ou liga-a.");
  return {
    eventId,
    homeSofa,
    awaySofa,
    tournament: typeof tournament.name === "string" ? tournament.name : "",
    leagueCode,
    casa,
    fora,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Fallback for seasons with no rounds on SofaScore (MLS 2026 lists none, so
// the round path finds no fixtures and no results): collect the season from
// each linked team's own event list instead. Only games of this tournament
// count (cups and friendlies are filtered by unique id + season id).
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

interface TeamSeasonGame {
  id: number;
  date: string;
  time: string | null;
  team1: string;
  team2: string;
  ft: [number, number] | null;
}

function clubTeamEvent(e: Json, uniqueId: number, seasonId: number): TeamSeasonGame | null {
  const tournament = (e.tournament ?? {}) as Json;
  const unique = (tournament.uniqueTournament ?? {}) as Json;
  if (unique.id !== uniqueId) return null;
  const season = (e.season ?? {}) as Json;
  if (season.id !== seasonId) return null;
  const id = typeof e.id === "number" ? e.id : null;
  const home = ((e.homeTeam ?? {}) as Json).name;
  const away = ((e.awayTeam ?? {}) as Json).name;
  const start = typeof e.startTimestamp === "number" ? e.startTimestamp : null;
  if (id === null || typeof home !== "string" || typeof away !== "string" || start === null) return null;
  const status = ((e.status ?? {}) as Json).type;
  const hs = ((e.homeScore ?? {}) as Json);
  const as = ((e.awayScore ?? {}) as Json);
  const hg = typeof hs.current === "number" ? hs.current : null;
  const ag = typeof as.current === "number" ? as.current : null;
  if (status === "finished" && hg !== null && ag !== null) {
    const { date, time } = lisbonParts(start);
    return { id, date, time, team1: home, team2: away, ft: [hg, ag] };
  }
  if (status === "notstarted") {
    const { date, time } = lisbonParts(start);
    return { id, date, time, team1: home, team2: away, ft: null };
  }
  return null;
}

async function teamEventList(
  supabase: SupabaseClient,
  userId: string,
  teamId: number,
  direction: "last" | "next"
): Promise<Json[]> {
  const key = `teamevents:${teamId}:${direction}:0`;
  const hit = await cacheGet(supabase, userId, key, direction === "last" ? 3 * DAY_MS : HOUR_MS);
  if (hit && typeof hit === "object" && !Array.isArray(hit)) {
    const events = (hit as { events?: unknown }).events;
    if (Array.isArray(events)) return events.filter((e): e is Json => typeof e === "object" && e !== null);
  }
  const body = await teamEvents(teamId, direction, 0);
  await cacheSet(supabase, userId, key, body);
  return body.events;
}

const PT_MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// Team ids via SofaScore's own search (cached 30 days: ids never change).
// The links cannot be trusted by name here (their stored spelling is the
// user's, not the standings'), so search is authoritative; an alignment
// sanity check keeps an obvious mismatch out.
async function searchTeamId(
  supabase: SupabaseClient,
  userId: string,
  name: string
): Promise<number | null> {
  const key = `teamid:${slugify(name)}`;
  const hit = await cacheGet(supabase, userId, key, 30 * DAY_MS);
  if (typeof hit === "number" && hit > 0) return hit;
  const cands = await searchTeams(name, 5).catch(() => []);
  const best = cands.find((c) => !c.national && c.sport === "football") ?? cands[0] ?? null;
  if (!best || alignScore(name, best.name) < 2) return null;
  await cacheSet(supabase, userId, key, best.id);
  return best.id;
}

// Standings names -> SofaScore team ids: the links' own ids where a row
// matches (exact or slug), own-search for the rest. Missing names stay
// missing (their games still surface through the opponents' lists).
export async function resolveLeagueTeamIds(
  supabase: SupabaseClient,
  userId: string,
  teamMaps: SofaMap[],
  standingsNames: string[]
): Promise<{ resolved: Map<string, number>; missing: string[] }> {
  const resolved = new Map<string, number>();
  for (const name of standingsNames) {
    const slug = slugify(name);
    const map = teamMaps.find(
      (m) =>
        m.sofascore_id > 0 &&
        (m.name === name || slugify(m.name) === slug || m.slug === slug || m.name_key === slug)
    );
    if (map) resolved.set(name, map.sofascore_id);
  }
  const missing = standingsNames.filter((n) => !resolved.has(n));
  const found = await Promise.all(
    missing.map(async (n) => ({ n, id: await searchTeamId(supabase, userId, n).catch(() => null) }))
  );
  for (const f of found) if (f.id) resolved.set(f.n, f.id);
  return { resolved, missing: standingsNames.filter((n) => !resolved.has(n)) };
}

export async function seasonEventsFromTeams(
  supabase: SupabaseClient,
  userId: string,
  uniqueId: number,
  seasonId: number,
  teamIdByName: Map<string, number>
): Promise<{ results: PlayedMatch[]; fixtures: SofaFixtureWithId[] }> {
  const seen = new Set<number>();
  const results: PlayedMatch[] = [];
  const fixtures: SofaFixtureWithId[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const lists = await Promise.all(
    [...teamIdByName.values()].map(async (teamId) => {
      const [last, next] = await Promise.all([
        teamEventList(supabase, userId, teamId, "last").catch(() => [] as Json[]),
        teamEventList(supabase, userId, teamId, "next").catch(() => [] as Json[]),
      ]);
      return [...last, ...next];
    })
  );
  for (const e of lists.flat()) {
    const g = clubTeamEvent(e, uniqueId, seasonId);
    if (!g || seen.has(g.id)) continue;
    seen.add(g.id);
    // Finished games feed both the model and the table/calendar (like a
    // round fixture with a result); upcoming ones only the calendar.
    const month = Number(g.date.slice(5, 7));
    const round = PT_MONTHS[month - 1] ?? "";
    if (g.ft) {
      results.push({ date: g.date, team1: g.team1, team2: g.team2, ft: g.ft, ht: null });
      fixtures.push({
        date: g.date,
        team1: g.team1,
        team2: g.team2,
        ft: g.ft,
        round,
        time: g.time ?? undefined,
        sid: g.id,
      });
    } else if (g.date >= today) {
      fixtures.push({
        date: g.date,
        team1: g.team1,
        team2: g.team2,
        ft: null,
        round,
        time: g.time ?? undefined,
        sid: g.id,
      });
    }
  }
  results.sort((a, b) => a.date.localeCompare(b.date));
  fixtures.sort((a, b) => `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`));
  return { results, fixtures };
}

export interface GoalTiming {
  // Goals scored / conceded per 15' block (0-15 … 76'-fim, descontos incluídos).
  scored: [number, number, number, number, number, number];
  conceded: [number, number, number, number, number, number];
  games: number; // games with incident data behind the counts
}

const emptyBlocks = (): [number, number, number, number, number, number] => [0, 0, 0, 0, 0, 0];

function timingBlock(minute: number): number {
  if (minute <= 15) return 0;
  if (minute <= 30) return 1;
  if (minute <= 45) return 2;
  if (minute <= 60) return 3;
  if (minute <= 75) return 4;
  return 5;
}

// When a team scores and concedes, per 15 minutes: the last `limit` league
// games with incident data (each game's incidents read once, cached 30 days).
// Null when the team or its games cannot be found.
export async function teamGoalTiming(
  supabase: SupabaseClient,
  userId: string,
  leagueCode: string,
  localTeam: string,
  limit = 10
): Promise<GoalTiming | null> {
  const tournaments = await loadMaps(supabase, userId, "tournament");
  const uniqueId = tournaments.find((m) => m.name_key === leagueCode)?.sofascore_id ?? null;
  if (!uniqueId) return null;
  const teams = await loadMaps(supabase, userId, "team");
  const link = teams.find((m) => m.local_name === localTeam) ?? teams.find((m) => m.name === localTeam);
  if (!link) return null;
  const sofaName = link.name;
  const seasons = await tournamentSeasons(supabase, userId, uniqueId).catch(() => []);
  const today = new Date().toISOString().slice(0, 10);
  const games: { id: number; date: string; isHome: boolean }[] = [];
  for (let i = 0; i < seasons.length && games.length < limit; i++) {
    const fx = await seasonFixtures(supabase, userId, uniqueId, seasons[i].id, i === 0, today).catch(() => []);
    for (const f of fx) {
      if (!f.ft || f.date >= today) continue;
      if (f.team1 === sofaName) games.push({ id: f.id, date: f.date, isHome: true });
      else if (f.team2 === sofaName) games.push({ id: f.id, date: f.date, isHome: false });
    }
    games.sort((a, b) => b.date.localeCompare(a.date));
    games.splice(limit);
  }
  if (games.length === 0) return null;
  const scored = emptyBlocks();
  const conceded = emptyBlocks();
  let counted = 0;
  const marks = await Promise.all(games.map((g) => eventGoalMinutes(supabase, userId, g.id).catch(() => null)));
  marks.forEach((list, i) => {
    if (!list) return;
    counted++;
    for (const mark of list) {
      const mine = mark.home === games[i].isHome;
      (mine ? scored : conceded)[timingBlock(mark.minute)]++;
    }
  });
  if (counted === 0) return null;
  return { scored, conceded, games: counted };
}
