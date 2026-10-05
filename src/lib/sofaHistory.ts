// History reads from SofaScore for the model tabs (phase 1 of "SofaScore
// only": infra + mapping, no tab switched yet). Everything goes through the
// local scraper (sofaRaw); finished seasons are cached for 30 days, the
// current one for 1 hour (sofaCache). Team names come back in SofaScore's
// spelling — aligning them with the local names is phase 2.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlayedMatch } from "./footballModel";
import { slugify } from "./slugify";
import { sideTokensIn } from "./sportscoreSlug";
import { tokens } from "./teamNames";
import { sofaRaw, ScraperOffline } from "./sofaRaw";
import { cacheGet, cacheGetMeta, cacheSet, DAY_MS, HOUR_MS, type StaleTracker } from "./sofaCache";
export type { StaleTracker } from "./sofaCache";

type Json = Record<string, unknown>;
const obj = (x: unknown): Json | null =>
  typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Json) : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

// Cache-then-fetch with an offline fallback: a fresh row wins; otherwise the
// fetch runs, and when the scraper is down the expired row is served instead
// of failing (flagged on the tracker, so pages can warn). `fetch` returns
// the parsed payload, or null when there is nothing worth caching (empty
// seasons, unparseable bodies) — null is never cached. Anything that is not
// the scraper being offline still throws, like before.
// Exported for the club adapter (teamEventList), which caches the same way.
export async function cachedRead<T>(
  supabase: SupabaseClient,
  userId: string,
  key: string,
  ttlMs: number,
  fetch: () => Promise<T | null>,
  tracker?: StaleTracker,
  valid?: (v: unknown) => boolean
): Promise<T | null> {
  const hit = await cacheGet(supabase, userId, key, ttlMs);
  if (hit !== null && hit !== undefined && (!valid || valid(hit))) return hit as T;
  try {
    const fresh = await fetch();
    if (fresh !== null && fresh !== undefined) await cacheSet(supabase, userId, key, fresh);
    return fresh;
  } catch (err) {
    if (err instanceof ScraperOffline) {
      const stale = await cacheGetMeta(supabase, userId, key);
      if (stale !== null && stale !== undefined && (!valid || valid(stale))) {
        if (tracker) tracker.stale = true;
        return stale as T;
      }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Mapping table (sofascore_maps)
// ---------------------------------------------------------------------------

export interface SofaMap {
  kind: "tournament" | "team";
  name_key: string;
  sofascore_id: number;
  name: string;
  slug: string;
  local_name: string;
}

export async function loadMaps(supabase: SupabaseClient, userId: string, kind: SofaMap["kind"]): Promise<SofaMap[]> {
  const normalize = (rows: Record<string, unknown>[]): SofaMap[] =>
    rows.map((r) => ({
      kind: kind as SofaMap["kind"],
      name_key: String(r.name_key ?? ""),
      sofascore_id: Number(r.sofascore_id ?? 0),
      name: String(r.name ?? ""),
      slug: String(r.slug ?? ""),
      local_name: String(r.local_name ?? ""),
    }));
  try {
    const { data, error } = await supabase
      .from("sofascore_maps")
      .select("name_key, sofascore_id, name, slug, local_name")
      .eq("user_id", userId)
      .eq("kind", kind);
    if (!error && data) return normalize(data as Record<string, unknown>[]);
    // Migration 0034 not run yet: same rows without the new column.
    const retry = await supabase
      .from("sofascore_maps")
      .select("name_key, sofascore_id, name, slug")
      .eq("user_id", userId)
      .eq("kind", kind);
    if (retry.error || !retry.data) return [];
    return normalize(retry.data as Record<string, unknown>[]);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Search (tournaments + teams), scored so the obvious pick comes first
// ---------------------------------------------------------------------------

export interface SofaCandidate {
  // What the seasons/rounds endpoints want (uniqueTournament) vs display-only.
  uniqueId: number | null;
  id: number;
  kind: string;
  name: string;
  slug: string;
  category: string;
  sport: string;
  national: boolean;
  userCount: number;
}

interface SearchResult {
  type?: unknown;
  entity?: unknown;
}

function candidatesOf(body: unknown, kinds: Set<string>): SofaCandidate[] {
  const results = obj(body)?.results;
  if (!Array.isArray(results)) return [];
  const out: SofaCandidate[] = [];
  for (const item of results) {
    const r = obj(item) as SearchResult | null;
    const e = obj(r?.entity);
    const id = num(e?.id);
    if (!r || !e || id === null) continue;
    const kind = str(r.type);
    if (!kinds.has(kind)) continue;
    // A uniqueTournament carries its own id; a season tournament nests it.
    const unique = obj(e.uniqueTournament);
    out.push({
      uniqueId: kind === "uniqueTournament" ? id : (num(unique?.id) ?? null),
      id,
      kind,
      name: str(e.name),
      slug: str(e.slug),
      category: str(obj(e.category)?.name),
      sport: str(obj(e.sport)?.slug),
      national: e.national === true,
      userCount: num(e.userCount) ?? 0,
    });
  }
  // The main competition first: exact names before partials, then by audience.
  // (A women's/B side with the same words sits below the real thing.)
  return out.sort((a, b) => b.userCount - a.userCount);
}

export async function searchTournaments(query: string): Promise<SofaCandidate[]> {
  const body = await sofaRaw<unknown>("/search/all", { q: query.trim() });
  if (!body) return [];
  return candidatesOf(body, new Set(["uniqueTournament", "tournament"])).slice(0, 8);
}

export async function searchTeams(query: string, limit = 8): Promise<SofaCandidate[]> {
  const body = await sofaRaw<unknown>("/search/all", { q: query.trim() });
  if (!body) return [];
  return candidatesOf(body, new Set(["team"])).slice(0, limit);
}

// Country as written in the LEAGUES labels -> SofaScore category name.
const COUNTRY_CATEGORY: Record<string, string> = {
  Portugal: "Portugal",
  Inglaterra: "England",
  Espanha: "Spain",
  Itália: "Italy",
  Alemanha: "Germany",
  França: "France",
  "Países Baixos": "Netherlands",
  Bélgica: "Belgium",
  Áustria: "Austria",
  Escócia: "Scotland",
  Turquia: "Turkey",
  Grécia: "Greece",
  Roménia: "Romania",
  Polónia: "Poland",
  Dinamarca: "Denmark",
  Suíça: "Switzerland",
  México: "Mexico",
  Japão: "Japan",
  Brasil: "Brazil",
  Argentina: "Argentina",
  EUA: "USA",
  Noruega: "Norway",
  Suécia: "Sweden",
  Finlândia: "Finland",
  Irlanda: "Ireland",
  China: "China",
};

// One-shot guess for a "Country · Competition" label: search the competition,
// keep the country's, take the most followed. Returns the pick plus how many
// same-country alternatives existed (1 = unambiguous).
export async function suggestTournament(
  label: string
): Promise<{ pick: SofaCandidate; alternatives: number } | null> {
  const [country, comp] = label.split("·").map((s) => s.trim());
  const category = COUNTRY_CATEGORY[country ?? ""];
  if (!category || !comp) return null;
  const cands = (await searchTournaments(comp)).filter(
    (c) => c.uniqueId !== null && c.category === category
  );
  if (cands.length === 0) return null;
  // Prefer names that actually contain the query words ("Série B" must win
  // over the far more followed "Brasileirão Betano", the first division).
  const words = comp.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  const scored = cands.map((c) => ({
    c,
    overlap: words.filter((w) => c.name.toLowerCase().includes(w)).length,
  }));
  const withWords = scored.filter((s) => s.overlap > 0);
  const pool = (withWords.length > 0 ? withWords : scored.map((s) => ({ ...s, overlap: 0 }))).sort(
    (a, b) => b.overlap - a.overlap || b.c.userCount - a.c.userCount
  );
  const top = pool[0];
  // An obscure competition nobody follows is probably the wrong one.
  if (top.c.userCount < 1000) return null;
  return { pick: top.c, alternatives: cands.length };
}

// ---------------------------------------------------------------------------
// Seasons, rounds, results
// ---------------------------------------------------------------------------

export interface SofaSeason {
  id: number;
  name: string;
  year: string;
}

export async function tournamentSeasons(
  supabase: SupabaseClient,
  userId: string,
  uniqueId: number,
  tracker?: StaleTracker
): Promise<SofaSeason[]> {
  const key = `seasons:${uniqueId}`;
  // Seasons only grow ~1x/year, so a month-long TTL just delays seeing a brand-new season (still empty at first).
  const data = await cachedRead<SofaSeason[]>(
    supabase,
    userId,
    key,
    30 * DAY_MS,
    async () => {
      const body = await sofaRaw<unknown>(`/unique-tournament/${uniqueId}/seasons`);
      const list = obj(body)?.seasons;
      const out: SofaSeason[] = Array.isArray(list)
        ? list.flatMap((s) => {
            const e = obj(s);
            const id = num(e?.id);
            return e && id !== null ? [{ id, name: str(e.name), year: str(e.year) }] : [];
          })
        : [];
      return out.length > 0 ? out : null;
    },
    tracker,
    Array.isArray
  );
  return data ?? [];
}

export async function tournamentRounds(
  supabase: SupabaseClient,
  userId: string,
  uniqueId: number,
  seasonId: number,
  current: boolean,
  tracker?: StaleTracker
): Promise<{ currentRound: number | null; rounds: number[] }> {
  const key = `rounds:${uniqueId}:${seasonId}`;
  // Round numbers are fixed; currentRound advances ~1x/week, so 6h stays fresh while refetching 6x less.
  const data = await cachedRead<{ currentRound: number | null; rounds: number[] }>(
    supabase,
    userId,
    key,
    current ? 6 * HOUR_MS : 30 * DAY_MS,
    async () => {
      const body = await sofaRaw<unknown>(`/unique-tournament/${uniqueId}/season/${seasonId}/rounds`);
      const rounds = obj(body)?.rounds;
      const list: number[] = Array.isArray(rounds)
        ? rounds.flatMap((r) => {
            const n = num(obj(r)?.round);
            return n !== null ? [n] : [];
          })
        : [];
      if (list.length === 0) return null;
      return { currentRound: num(obj(obj(body)?.currentRound)?.round), rounds: list };
    },
    tracker,
    (v): boolean => !!v && typeof v === "object" && !Array.isArray(v)
  );
  return data ?? { currentRound: null, rounds: [] };
}

// Kickoff in Europe/Lisbon wall time (the files use local dates too): a 17:45
// UTC game in October is 18:45 in Portugal. Midnight edges can still shift a
// day, same as noted for results.
export function lisbonParts(start: number): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(start * 1000));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

// Every event of one round — played AND scheduled — as calendar rows with
// local-unaware (SofaScore-spelled) names; the adapter converts them. Round
// 404 (past the end) -> [].
export interface SofaFixture {
  id: number; // SofaScore event id (for per-match reads like statistics)
  date: string; // YYYY-MM-DD (Lisbon wall time)
  time: string | null; // kickoff HH:MM (Lisbon wall time)
  team1: string;
  team2: string;
  ft: [number, number] | null;
  ht: [number, number] | null;
  round: number;
}

function toFixture(e: Json, round: number): SofaFixture | null {
  const id = num(e.id);
  const home = str(obj(e.homeTeam)?.name);
  const away = str(obj(e.awayTeam)?.name);
  const start = num(e.startTimestamp);
  if (id === null || !home || !away || start === null) return null;
  const finished = str(obj(e.status)?.type) === "finished";
  const hs = obj(e.homeScore);
  const as = obj(e.awayScore);
  const hg = num(hs?.current) ?? num(hs?.display);
  const ag = num(as?.current) ?? num(as?.display);
  const h1 = num(hs?.period1);
  const a1 = num(as?.period1);
  const { date, time } = lisbonParts(start);
  return {
    id,
    date,
    time,
    team1: home,
    team2: away,
    ft: finished && hg !== null && ag !== null ? [hg, ag] : null,
    ht: h1 !== null && a1 !== null ? [h1, a1] : null,
    round,
  };
}

export async function roundFixtures(
  supabase: SupabaseClient,
  userId: string,
  uniqueId: number,
  seasonId: number,
  round: number,
  current: boolean,
  tracker?: StaleTracker
): Promise<SofaFixture[]> {
  const key = `roundfx:${uniqueId}:${seasonId}:${round}`;
  const data = await cachedRead<SofaFixture[]>(
    supabase,
    userId,
    key,
    current ? HOUR_MS : 30 * DAY_MS,
    async () => {
      const body = await sofaRaw<unknown>(`/unique-tournament/${uniqueId}/season/${seasonId}/events/round/${round}`);
      const events = obj(body)?.events;
      const out: SofaFixture[] = Array.isArray(events)
        ? events.flatMap((item) => {
            const f = obj(item) ? toFixture(obj(item)!, round) : null;
            return f ? [f] : [];
          })
        : [];
      out.sort((a, b) => `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`));
      // An empty round (404 past the end, or nothing scheduled yet) is cached
      // too: refetching it every load would never find anything new until the
      // TTL lapses anyway.
      return out;
    },
    tracker,
    Array.isArray
  );
  return data ?? [];
}

// Shots on target [home, away] of one event, from its statistics endpoint
// (period ALL, "Match overview"). Cached 30 days: results never change.
// Null when the game carries no stats (low coverage, old seasons).
export async function eventShots(
  supabase: SupabaseClient,
  userId: string,
  eventId: number,
  tracker?: StaleTracker
): Promise<[number, number] | null> {
  const key = `stat:${eventId}`;
  // {sot} wrapper so "looked, nothing there" (null) caches like before.
  const data = await cachedRead<{ sot: [number, number] | null }>(
    supabase,
    userId,
    key,
    30 * DAY_MS,
    async () => {
      const body = await sofaRaw<unknown>(`/event/${eventId}/statistics`);
      let out: [number, number] | null = null;
      const periods = obj(body)?.statistics;
      if (Array.isArray(periods)) {
        const all = periods.map(obj).find((p) => p?.period === "ALL") ?? periods.map(obj)[0];
        const groups = Array.isArray(all?.groups) ? (all!.groups as unknown[]) : [];
        const overview = groups.map(obj).find((g) => g?.groupName === "Match overview") ?? groups.map(obj)[0];
        const items = Array.isArray(overview?.statisticsItems) ? (overview!.statisticsItems as unknown[]) : [];
        for (const item of items) {
          const row = obj(item);
          if (row?.name === "Shots on target" && typeof row.home === "number" && typeof row.away === "number") {
            out = [row.home, row.away];
            break;
          }
        }
      }
      return { sot: out };
    },
    tracker,
    (v): boolean => !!v && typeof v === "object" && !Array.isArray(v)
  );
  if (!data) return null;
  const sot = data.sot;
  return sot !== null && sot.length === 2 && sot.every((n) => typeof n === "number") ? sot : null;
}

// Finished games of one round, oldest first. 404 (round past the end) -> [].
// With shots: each finished game also carries shots on target (one cached
// statistics read per event) for the shot-based half of team strength.
export async function roundResults(
  supabase: SupabaseClient,
  userId: string,
  uniqueId: number,
  seasonId: number,
  round: number,
  current: boolean,
  shots = false,
  tracker?: StaleTracker
): Promise<PlayedMatch[]> {
  const key = `round:${uniqueId}:${seasonId}:${round}${shots ? ":sot" : ""}`;
  const hit = await cacheGet(supabase, userId, key, current ? HOUR_MS : 30 * DAY_MS);
  if (Array.isArray(hit)) return hit as PlayedMatch[];
  // One call per round serves both: the fixtures cache holds everything,
  // results filter the finished games out of it.
  const fixtures = await roundFixtures(supabase, userId, uniqueId, seasonId, round, current, tracker);
  const finished = fixtures.filter((f) => f.ft);
  const sotById = new Map<number, [number, number]>();
  if (shots) {
    const shots = await Promise.all(
      finished.map(async (f) => ({ id: f.id, sot: await eventShots(supabase, userId, f.id, tracker).catch(() => null) }))
    );
    for (const s of shots) if (s.sot) sotById.set(s.id, s.sot);
  }
  const out: PlayedMatch[] = finished.map((f) => ({
    date: f.date,
    team1: f.team1,
    team2: f.team2,
    ft: f.ft!,
    ht: f.ht,
    ...(sotById.get(f.id) ? { sot: sotById.get(f.id)! } : {}),
  }));
  out.sort((a, b) => a.date.localeCompare(b.date));
  await cacheSet(supabase, userId, key, out);
  return out;
}

// Every finished game of a season across its rounds (round 404s stop nothing:
// some seasons number rounds sparsely). Deduped like the fixtures: cup rounds
// can repeat a tie, and the model must not count it twice. `current` selects
// the TTL; `shots` attaches shots on target for the model seasons.
export async function seasonResults(
  supabase: SupabaseClient,
  userId: string,
  uniqueId: number,
  seasonId: number,
  current: boolean,
  shots = false,
  tracker?: StaleTracker
): Promise<PlayedMatch[]> {
  const { rounds } = await tournamentRounds(supabase, userId, uniqueId, seasonId, current, tracker);
  const lists = await Promise.all(rounds.map((r) => roundResults(supabase, userId, uniqueId, seasonId, r, current, shots, tracker)));
  const seen = new Set<string>();
  return lists
    .flat()
    .filter((m) => {
      const key = `${m.date}|${m.team1}|${m.team2}|${m.ft[0]}-${m.ft[1]}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Whole calendar of a season (played + scheduled), for tables and rounds.
// Deduped: cup rounds can list the same tie twice (both legs under one
// round, or overlapping qualification/league-phase numbering). Postponed
// games can also appear twice in one round (the stale original date plus the
// rescheduled one): with `today`, the stale past entry without a result is
// dropped whenever the tie also has a result or a future date — otherwise it
// would sit forever as "played but missing".
export async function seasonFixtures(
  supabase: SupabaseClient,
  userId: string,
  uniqueId: number,
  seasonId: number,
  current: boolean,
  today = "",
  tracker?: StaleTracker
): Promise<SofaFixture[]> {
  const { rounds } = await tournamentRounds(supabase, userId, uniqueId, seasonId, current, tracker);
  const lists = await Promise.all(rounds.map((r) => roundFixtures(supabase, userId, uniqueId, seasonId, r, current, tracker)));
  const byTie = new Map<string, SofaFixture[]>();
  for (const f of lists.flat()) {
    const key = `${f.round}|${[f.team1, f.team2].sort().join("~")}`;
    const arr = byTie.get(key) ?? [];
    arr.push(f);
    byTie.set(key, arr);
  }
  const deduped: SofaFixture[] = [];
  for (const arr of byTie.values()) {
    if (arr.length === 1) {
      deduped.push(arr[0]);
      continue;
    }
    const live = arr.filter((f) => f.ft || (today !== "" && f.date >= today));
    // Every entry stale (all past, none played): a data hole, not a
    // duplicate — keep them rather than hide games.
    deduped.push(...(live.length > 0 ? live : arr));
  }
  const seen = new Set<string>();
  return deduped
    .filter((f) => {
      const key = `${f.date}|${f.team1}|${f.team2}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`));
}

// ---------------------------------------------------------------------------
// Standings rows (phase-2 pilot input)
// ---------------------------------------------------------------------------

export interface SofaStandingRow {
  position: number;
  team: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

export async function seasonStandings(
  supabase: SupabaseClient,
  userId: string,
  uniqueId: number,
  seasonId: number,
  current: boolean,
  tracker?: StaleTracker
): Promise<SofaStandingRow[]> {
  const tables = await seasonStandingsTables(supabase, userId, uniqueId, seasonId, current, tracker);
  return tables.flatMap((t) => t.rows);
}

export interface SofaStandingTable {
  // "Premier League", or one of several ("MLS 2026, Eastern Conference").
  name: string;
  rows: SofaStandingRow[];
}

// Every standings table of a season, kept apart (leagues with conferences
// get one table each). Rows stay in official order.
export async function seasonStandingsTables(
  supabase: SupabaseClient,
  userId: string,
  uniqueId: number,
  seasonId: number,
  current: boolean,
  tracker?: StaleTracker
): Promise<SofaStandingTable[]> {
  const key = `standingstables:${uniqueId}:${seasonId}`;
  // Standings move at most 1x/day (after games), so 12h is the freshness floor that halves daily refetchs.
  const data = await cachedRead<SofaStandingTable[]>(
    supabase,
    userId,
    key,
    current ? 12 * HOUR_MS : 30 * DAY_MS,
    async () => {
      const body = await sofaRaw<unknown>(`/unique-tournament/${uniqueId}/season/${seasonId}/standings/total`);
      const tables = obj(body)?.standings;
      const out: SofaStandingTable[] = Array.isArray(tables)
        ? tables.flatMap((t): SofaStandingTable[] => {
            const table = obj(t);
            if (!table) return [];
            const items = Array.isArray(table.rows) ? (table.rows as unknown[]) : [];
            const rows = items.flatMap((item) => {
              const r = obj(item);
              if (!r) return [];
              return [
                {
                  position: num(r.position) ?? 0,
                  team: str(obj(r.team)?.name),
                  played: num(r.matches) ?? 0,
                  wins: num(r.wins) ?? 0,
                  draws: num(r.draws) ?? 0,
                  losses: num(r.losses) ?? 0,
                  goalsFor: num(r.scoresFor) ?? 0,
                  goalsAgainst: num(r.scoresAgainst) ?? 0,
                  points: num(r.points) ?? 0,
                },
              ];
            });
            if (rows.length === 0) return [];
            return [{ name: str(table.name) || str(table.description) || "", rows }];
          })
        : [];
      return out.length > 0 ? out : null;
    },
    tracker,
    Array.isArray
  );
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Team events (last/next, paged) — phase 2 team mapping input
// ---------------------------------------------------------------------------
export async function teamEvents(
  teamId: number,
  direction: "last" | "next",
  page: number
): Promise<{ events: Json[]; hasNextPage: boolean }> {
  const body = await sofaRaw<unknown>(`/team/${teamId}/events/${direction}/${page}`);
  const events = obj(body)?.events;
  return {
    events: Array.isArray(events) ? events.flatMap((e) => (obj(e) ? [obj(e)!] : [])) : [],
    hasNextPage: obj(body)?.hasNextPage === true,
  };
}

export interface SofaLastGame {
  date: string; // YYYY-MM-DD (Lisbon wall time)
  tournament: string; // SofaScore tournament name ("UEFA Europa League, ...")
}

// Local spelling (as shown in the analysis) -> SofaScore team id, via the team
// links. Unlinked teams keep the SofaScore spelling, so that matches too.
export async function sofaTeamIdFor(
  supabase: SupabaseClient,
  userId: string,
  local: string
): Promise<number | null> {
  const teams = await loadMaps(supabase, userId, "team");
  const hit = teams.find((m) => m.local_name === local) ?? teams.find((m) => m.name === local);
  return hit && hit.sofascore_id > 0 ? hit.sofascore_id : null;
}

// The team's most recent finished game before `before` (YYYY-MM-DD), across
// all competitions: league, cups, Europe, friendlies. One read of page 0 of
// the team's event list (~30 games, cached 1 hour) — enough for any upcoming
// date, since every "last" event is already in the past.
export async function teamLastGame(
  supabase: SupabaseClient,
  userId: string,
  teamId: number,
  before: string,
  tracker?: StaleTracker
): Promise<SofaLastGame | null> {
  const key = `teamlast:${teamId}:0`;
  // Page 0 only shifts when a new game is played (~weekly); 6h keeps the stale window inside the quiet night hours.
  const cached = await cachedRead<{ events?: unknown }>(
    supabase,
    userId,
    key,
    6 * HOUR_MS,
    async () => {
      const live = await teamEvents(teamId, "last", 0);
      const events = live.events.flatMap((e) => {
        const s = slimEvent(e);
        return s ? [s] : [];
      });
      return { events };
    },
    tracker,
    (v): boolean => !!v && typeof v === "object" && !Array.isArray(v)
  );
  let events: SlimEvent[] | null = null;
  const raw = cached?.events;
  if (Array.isArray(raw)) {
    if (raw.length === 0 || isSlimEvent(raw[0])) {
      events = raw as SlimEvent[];
    } else {
      // Legacy whole-body rows: parse on the fly, refresh slim on TTL.
      events = [];
      for (const item of raw) {
        const o = obj(item);
        if (!o || isSlimEvent(o)) continue;
        const s = slimEvent(o);
        if (s) events.push(s);
      }
    }
  }
  if (!events) return null;
  let best: SofaLastGame | null = null;
  for (const s of events) {
    if (s.status !== "finished") continue;
    const date = lisbonParts(s.start).date;
    if (date >= before) continue;
    if (!best || date > best.date) {
      best = { date, tournament: s.tournament };
    }
  }
  return best;
}

export interface SofaGoalMark {
  minute: number; // 1-130 (stoppage comes as 45+/90+: 47, 93...)
  home: boolean; // scored by the home side (own goals already flipped)
}

// Goal minutes of one finished event, for the goal-timing table. Cached 30
// days: results never change. Null when the game carries no usable incidents
// (old seasons, low coverage) — the caller then leaves the game out.
export async function eventGoalMinutes(
  supabase: SupabaseClient,
  userId: string,
  eventId: number,
  tracker?: StaleTracker
): Promise<SofaGoalMark[] | null> {
  const key = `goalmin:${eventId}`;
  // {marks} wrapper: null means "looked, nothing usable" (skipped by the
  // caller), [] means "parsed, no goals" (counted as empty) — same as before.
  const data = await cachedRead<{ marks: SofaGoalMark[] | null }>(
    supabase,
    userId,
    key,
    30 * DAY_MS,
    async () => {
      let body: unknown;
      try {
        body = await sofaRaw<unknown>(`/event/${eventId}/incidents`);
      } catch (err) {
        if (err instanceof ScraperOffline) throw err;
        return null;
      }
      const raw = obj(body)?.incidents;
      if (!Array.isArray(raw)) return { marks: null };
      const events = raw.flatMap((e) => (obj(e) ? [obj(e)!] : []));
      const out: SofaGoalMark[] = [];
      for (const e of events) {
        const type = str(e.incidentType).toLowerCase();
        if (!type.includes("goal") && !type.includes("penalt")) continue;
        const minute = num(e.time);
        if (minute === null || minute < 1 || minute > 130) continue;
        const own = str(e.incidentClass).toLowerCase().includes("own");
        out.push({ minute, home: own ? e.isHome !== true : e.isHome === true });
      }
      return { marks: out };
    },
    tracker,
    (v): boolean =>
      !!v && typeof v === "object" && !Array.isArray(v) && (Array.isArray((v as { marks?: unknown }).marks) || (v as { marks?: unknown }).marks === null)
  );
  if (!data) return null;
  const marks = data.marks;
  if (marks === null) return null;
  return marks.every((g) => typeof g === "object" && g !== null) ? (marks as SofaGoalMark[]) : null;
}

// ---------------------------------------------------------------------------
// National teams (phase 3b): every game of a team back to `since`
// ---------------------------------------------------------------------------

export interface SofaIntlGame {
  id: number;
  date: string; // YYYY-MM-DD (Lisbon wall time)
  home: string; // SofaScore spellings; converted by the adapter
  away: string;
  hg: number;
  ag: number;
  neutral: boolean;
  tournament: string;
}

// One team-list event stripped to what the readers use (ids, names, dates,
// scores, tournaments). Raw event bodies are 5-10x bigger and would blow the
// Supabase egress quota; the cache holds these instead.
export interface SlimEvent {
  id: number;
  home: string;
  away: string;
  start: number; // startTimestamp (s)
  status: string; // status.type
  tournament: string; // tournament.name
  uniqueId: number | null;
  seasonId: number | null;
  hg: number | null; // homeScore.current ?? display
  ag: number | null;
}

export function slimEvent(e: Json): SlimEvent | null {
  const id = num(e.id);
  const home = str(obj(e.homeTeam)?.name);
  const away = str(obj(e.awayTeam)?.name);
  const start = num(e.startTimestamp);
  if (id === null || !home || !away || start === null) return null;
  const hs = obj(e.homeScore);
  const as = obj(e.awayScore);
  return {
    id,
    home,
    away,
    start,
    status: str(obj(e.status)?.type),
    tournament: str(obj(e.tournament)?.name),
    uniqueId: num(obj(obj(e.tournament)?.uniqueTournament)?.id),
    seasonId: num(obj(e.season)?.id),
    hg: num(hs?.current) ?? num(hs?.display),
    ag: num(as?.current) ?? num(as?.display),
  };
}

// Cached rows from before this diet hold whole raw bodies (homeTeam objects,
// not home strings); this tells them apart.
export function isSlimEvent(e: unknown): e is SlimEvent {
  const s = obj(e);
  return !!s && typeof s.id === "number" && typeof s.home === "string" && typeof s.away === "string";
}

// Fully hosted final tournaments are neutral-venue (minus the odd host-nation
// game, flagged as a limitation): the list responses carry no venue. Anything
// else (qualifiers, Nations League groups, friendlies) is home/away.
const HOSTED_FINALS = [
  /world cup(?!\s*qualif)/i,
  /european championship/i,
  /(^|[^a-z])euro([^a-z]|$)/i,
  /copa am[eé]rica/i,
  /africa cup/i,
  /asian cup/i,
  /gold cup/i,
  /confederations cup/i,
];

function guessNeutral(tournament: string): boolean {
  return HOSTED_FINALS.some((re) => re.test(tournament));
}

function toIntl(s: SlimEvent): SofaIntlGame | null {
  if (s.status !== "finished") return null;
  const home = s.home;
  const away = s.away;
  if (!home || !away) return null;
  // Senior men's sides only: youth/women tournaments, youth/women opponents
  // and club friendlies that leak into a national side's list would poison
  // the senior model (U23 torneo games, testimonials vs clubs).
  const tournament = s.tournament;
  if (/U\d{2}\b|women|feminino/i.test(tournament)) return null;
  if (/club friendly/i.test(tournament)) return null;
  if (sideTokensIn(slugify(home)).length > 0 || sideTokensIn(slugify(away)).length > 0) return null;
  const hg = s.hg;
  const ag = s.ag;
  if (hg === null || ag === null) return null;
  return {
    id: s.id,
    date: lisbonParts(s.start).date,
    home,
    away,
    hg,
    ag,
    neutral: guessNeutral(tournament),
    tournament,
  };
}

// Every finished game of a national team back to `since` (YYYY-MM-DD),
// oldest first. Paginates the team's event list; stops at the date or after
// MAX_PAGES (about 15 years at 30 games a page). Page 0 (the newest, where
// new games land) caches for 1 hour, older pages for 3 days (they never
// change; the newest refreshes on TTL).
export async function nationalGames(
  teamId: number,
  since: string,
  maxPages = 20,
  cache?: { supabase: SupabaseClient; userId: string },
  tracker?: StaleTracker
): Promise<SofaIntlGame[]> {
  const out: SofaIntlGame[] = [];
  for (let page = 0; page < maxPages; page++) {
    const key = `intteam:${teamId}:${page}`;
    let events: SlimEvent[] | null = null;
    let hasNextPage = false;
    if (cache) {
      // Page 0 moves only when a new game lands (national sides play ~monthly): 12h refreshes are plenty; older pages are history.
      const hit = await cacheGet(cache.supabase, cache.userId, key, page === 0 ? 12 * HOUR_MS : 30 * DAY_MS);
      if (hit && typeof hit === "object" && !Array.isArray(hit)) {
        const h = hit as { events?: unknown; hasNextPage?: unknown };
        if (Array.isArray(h.events)) {
          if (h.events.length === 0 || isSlimEvent(h.events[0])) {
            events = h.events as SlimEvent[];
            hasNextPage = h.hasNextPage === true;
          } else {
            // Legacy whole-body rows: parse on the fly, refresh slim on TTL.
            events = [];
            for (const item of h.events) {
              const o = obj(item);
              if (!o || isSlimEvent(o)) continue;
              const s = slimEvent(o);
              if (s) events.push(s);
            }
            hasNextPage = h.hasNextPage === true;
          }
        }
      }
    }
    if (!events) {
      try {
        const body = await teamEvents(teamId, "last", page);
        events = body.events.flatMap((e) => {
          const s = slimEvent(e);
          return s ? [s] : [];
        });
        hasNextPage = body.hasNextPage;
        if (cache) await cacheSet(cache.supabase, cache.userId, key, { events, hasNextPage });
      } catch (err) {
        // Scraper down: serve the expired page instead of failing — and stop
        // paging when even that is missing (partial data beats none).
        if (!(err instanceof ScraperOffline) || !cache) throw err;
        const stale = await cacheGetMeta(cache.supabase, cache.userId, key);
        const h = obj(stale) as { events?: unknown; hasNextPage?: unknown } | null;
        if (!h || !Array.isArray(h.events)) break;
        if (tracker) tracker.stale = true;
        events = (h.events.length === 0 || isSlimEvent(h.events[0]) ? h.events : []) as SlimEvent[];
        hasNextPage = h.hasNextPage === true;
      }
    }
    if (events.length === 0) break;
    let older = false;
    for (const s of events) {
      const g = toIntl(s);
      if (!g) continue;
      if (g.date < since) {
        older = true;
        continue;
      }
      out.push(g);
    }
    if (!hasNextPage || older) break;
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

// ---------------------------------------------------------------------------
// Team-name alignment (phase 2): local spellings vs SofaScore spellings
// ---------------------------------------------------------------------------

export interface AlignedTeam {
  local: string;
  sofa: string | null;
  confident: boolean;
}

const CLUB_DECORATION = new Set([
  "fc", "cf", "sc", "ac", "afc", "cd", "ud", "sl", "sv", "fk", "ss", "ssc", "us", "as", "rc",
  "rcd", "cs", "sk", "if", "bk", "fsv", "vfb", "vfl", "tsg", "club", "real", "atl",
]);

// SofaScore shortens some names in standings ("Charlotte" for Charlotte FC):
// after the exact link, match by slug with club-decoration words (FC, SC…)
// stripped. Only full-slug equality counts, never substrings, so close names
// ("Inter" vs "Internazionale") stay unlinked instead of merging.
export function strippedSlug(name: string): string {
  return slugify(name)
    .split("-")
    .filter((t) => t.length > 0 && !CLUB_DECORATION.has(t))
    .join("-");
}

// SofaScore spelling -> local spelling via the team links, or null when
// unlinked: exact first, then the decoration-stripped slug (first map wins).
export function linkLocalName(teamMaps: SofaMap[], sofaName: string): string | null {
  const direct = teamMaps.find((m) => m.name === sofaName);
  if (direct && direct.local_name) return direct.local_name;
  const stripped = strippedSlug(sofaName);
  if (!stripped) return null;
  const hit = teamMaps.find((m) => m.local_name && strippedSlug(m.name) === stripped);
  return hit && hit.local_name ? hit.local_name : null;
}

// Letters NFD cannot split (ł, ø, æ, ß...): without this "Wisła Płock" and
// "Sønderjyske" never match anything. Local-only to matching (never in stored
// keys, which were built with plain slugify).
const FOLD: Record<string, string> = {
  ł: "l", ø: "o", æ: "ae", å: "a", ä: "a", ö: "o", ü: "u", ß: "ss",
  đ: "d", ð: "d", þ: "th", ç: "c", ñ: "n", ş: "s", ğ: "g", ı: "i",
  ř: "r", ž: "z", š: "s", č: "c", ć: "c", ń: "n", ś: "s", ź: "z", ż: "z",
};

function fold(name: string): string {
  return name
    .toLowerCase()
    .split("")
    .map((c) => FOLD[c] ?? c)
    .join("");
}

function coreWords(name: string): string[] {
  return tokens(fold(name))
    .filter((t) => t.length > 1 && !CLUB_DECORATION.has(t))
    .map((t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));
}

// Tiny typo/plural drift between sources ("Levadeiakos" vs "Levadiakos").
function near(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (Math.min(a.length, b.length) < 6) return false;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length] <= 1;
}

export function alignScore(local: string, sofa: string): number {
  const a = coreWords(local);
  const b = coreWords(sofa);
  if (a.length === 0 || b.length === 0) return 0;
  if (slugify(fold(local)) === slugify(fold(sofa))) return 10;
  const shared = a.filter((t) => b.includes(t) || b.some((u) => near(t, u))).length;
  // All words of the shorter name present in the other: strong ("Benfica" in
  // "SL Benfica"; "Man City" vs "Manchester City" shares only "city" -> weak).
  const [small, big] = a.length <= b.length ? [a, b] : [b, a];
  const contained = small.every((t) => big.includes(t));
  let score = shared + (contained ? 2 : 0);
  // Abbreviated spellings ("Peterboro" vs "Peterborough United", "Rayo
  // Vallecano de Madrid" vs "Rayo Vallecano", "Volos NFC" vs "Volos", "Inter"
  // vs "Internazionale"): one slug inside the other. Needs length so a tiny
  // word cannot claim a big club — and the runner-up gap still has to hold.
  const sing = (s: string) => (s.length > 3 && s.endsWith("s") && !s.endsWith("ss") ? s.slice(0, -1) : s);
  const sa = sing(slugify(local));
  const sb = sing(slugify(sofa));
  const [short, long] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
  if (short.length >= 5 && long.includes(short)) score += 3;
  return score;
}

// Each local team gets the SofaScore name it fits best; confident when the
// fit is clearly better than the runner-up (or an exact match). Each sofa
// name goes to at most one local team. A reserve/youth/women's side ("Benfica
// B") never stands in for the first team: side markers in the SofaScore name
// must also be in the local one.
export function alignTeamNames(localNames: string[], sofaNames: string[]): AlignedTeam[] {
  const taken = new Set<string>();
  return localNames.map((local) => {
    const localSide = sideTokensIn(slugify(local));
    const ranked = sofaNames
      .filter((s) => !taken.has(s))
      .filter((s) => {
        const side = sideTokensIn(slugify(s));
        return side.length === 0 || side.every((t) => localSide.includes(t));
      })
      .map((sofa) => ({ sofa, score: alignScore(local, sofa) }))
      .sort((x, y) => y.score - x.score);
    const [best, second] = ranked;
    const confident =
      best !== undefined && best.score >= 3 && (second === undefined || best.score >= second.score + 2);
    if (confident) taken.add(best.sofa);
    return { local, sofa: confident ? best.sofa : null, confident };
  });
}

// Synonyms the word fit cannot see ("Czechia" shares nothing with "Czech
// Republic"). Slugs on both sides.
const NATIONAL_SYNONYMS: Record<string, string> = {
  "czech-republic": "czechia",
  "cape-verde": "cabo-verde",
  "timor-leste": "east-timor",
  "turkey": "turkiye",
  "united-states": "usa",
  "ivory-coast": "cote-d-ivoire",
  taiwan: "chinese-taipei",
};

// Whether a search top hit may stand in for a national side: exact, known
// synonym, the hit adding nothing ("Ireland" for "Republic of Ireland"), or
// the local name adding only decoration ("Benfica" for "SL Benfica").
// Rejects youth/women sides, stranger subsets ("Congo" for "DR Congo") and
// lookalikes with nothing in common ("Niger" for "Nigeria").
export function nationalFit(local: string, top: SofaCandidate): boolean {  const localSlug = slugify(fold(local));
  const topSlug = slugify(fold(top.name));
  if (localSlug === topSlug) return true;
  if (NATIONAL_SYNONYMS[localSlug] === topSlug) return true;
  const localSide = sideTokensIn(localSlug);
  const topSide = sideTokensIn(topSlug);
  if (topSide.length > 0 && !topSide.every((t) => localSide.includes(t))) return false;
  const a = coreWords(local);
  const b = coreWords(top.name);
  const shared = a.filter((t) => b.includes(t));
  if (shared.length === 0) return false;
  const [small, big] = a.length <= b.length ? [a, b] : [b, a];
  if (!small.every((t) => big.includes(t))) return true; // overlap, neither contains: e.g. Cabo Verde
  const smallIsTop = b.length <= a.length;
  if (smallIsTop) return true; // hit adds nothing
  // Local name contained in the hit: only decoration may stick out ("SL" in
  // "SL Benfica"; "Republic" in "Congo Republic") — never distinguishing
  // words ("DR" in "DR Congo" stays rejected).
  const extra = big.filter((t) => !small.includes(t));
  return extra.every((t) => CLUB_DECORATION.has(t) || t === "republic");
}
export function teamQueryVariants(local: string): string[] {
  const core = coreWords(local);
  const out = [local];
  if (core.length >= 2) {
    const joined = core.join(" ");
    if (joined.toLowerCase() !== local.toLowerCase()) out.push(joined);
    const ends = [core[0], core[core.length - 1]].join(" ");
    if (!out.some((o) => o.toLowerCase() === ends.toLowerCase())) out.push(ends);
  }
  // Distinctive first word as last resort ("Sarmiento Junin" -> "Sarmiento",
  // "Volos NFC" -> "Volos", whose top football hit is the club). Very short
  // words stay out ("San" would match anything). Measured on the raw word:
  // singularizing first would shrink "Volos" to "volo" and skip it.
  const rawFirst = tokens(local)[0] ?? "";
  if ((core[0]?.length ?? 0) >= 5 || rawFirst.length >= 5) {
    const first = rawFirst[0].toUpperCase() + rawFirst.slice(1);
    if (!out.some((o) => o.toLowerCase() === first.toLowerCase())) out.push(first);
  }
  return out;
}

// Query variants for a national side: the club variants above, plus the
// synonym spelling ("Turkey" -> "Turkiye"), plus every distinctive word
// ("Sarmiento Junin" is found via "Sarmiento", "US Virgin Islands" via
// "Virgin"). The fit check on the hit keeps broad words safe.
export function intlQueryVariants(local: string): string[] {
  const out = teamQueryVariants(local);
  const syn = NATIONAL_SYNONYMS[slugify(fold(local))];
  if (syn) {
    const query = syn.replace(/-/g, " ");
    if (!out.some((o) => o.toLowerCase() === query)) out.push(query);
  }
  for (const w of coreWords(local)) {
    if (w.length >= 6) {
      const query = w[0].toUpperCase() + w.slice(1);
      if (!out.some((o) => o.toLowerCase() === query.toLowerCase())) out.push(query);
    }
  }
  return out;
}

// All team names of a season: every table of the standings (one call).
// Cups split into groups, so all of them are read, not just the first.
// Empty when the season has no table — the caller falls back to round events.
export async function seasonTeamNames(
  supabase: SupabaseClient,
  userId: string,
  uniqueId: number,
  seasonId: number,
  current: boolean,
  tracker?: StaleTracker
): Promise<string[]> {
  const rows = await seasonStandings(supabase, userId, uniqueId, seasonId, current, tracker);
  return [...new Set(rows.map((r) => r.team).filter(Boolean))];
}
