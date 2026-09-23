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
  seasonTeamNames,
  tournamentSeasons,
  eventGoalMinutes,
  alignScore,
  type SofaSeason,
} from "./sofaHistory";
import { sofaRaw } from "./sofaRaw";
import { parseSofascoreId } from "./sofascore";
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

  // The season being played: first with any fixtures at all (a future season
  // may already exist but hold no games). Skipped when only results matter.
  let currentIdx = 0;
  const fixturesBySeason = new Map<number, Awaited<ReturnType<typeof seasonFixtures>>>();
  if (wantFixtures) {
    const today = todayISO(new Date());
    for (let i = 0; i < seasons.length; i++) {
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
  const teamMaps = await loadMaps(supabase, userId, "team");  const toLocal = new Map<string, string>();
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

  const convertMatch = (m: PlayedMatch): PlayedMatch => ({ ...m, team1: convert(m.team1), team2: convert(m.team2) });

  // The model reads the last three seasons with games.
  const wanted = seasons.slice(currentIdx, currentIdx + 3);
  const matchLists = await Promise.all(
    wanted.map((s, i) => seasonResults(supabase, userId, uniqueId, s.id, i === 0, true).catch(() => [] as PlayedMatch[]))
  );
  const matches = matchLists
    .flat()
    .map(convertMatch)
    .sort((a, b) => a.date.localeCompare(b.date));

  const fixtures: Fixture[] = wantFixtures
    ? currentFx.map((f) => ({
        date: f.date,
        team1: convert(f.team1),
        team2: convert(f.team2),
        ft: f.ft ? ([f.ft[0], f.ft[1]] as [number, number]) : null,
        round: `Matchday ${f.round}`,
        time: f.time ?? undefined,
      }))
    : [];

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
  return { data, unlinked: [...unlinked].sort((a, b) => a.localeCompare(b)), seasonNames: seasons.map((s) => s.name) };
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
