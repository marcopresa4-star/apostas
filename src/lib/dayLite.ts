// Nova página "Jogos por dia" (vista única, híbrida): o jogo-lista no-rende
// desde a sonda leve (época + upcoming + recent + ao vivo, tudo cache partilhado)
// e o modelo pinta liga a liga em fundo — uma liga falhada nunca refaz as
// outras. Sem painel detalhado e sem odds por jogo (leitura caríssima): as
// percentagens vêm só do modelo pré-jogo.
import type { SupabaseClient } from "@supabase/supabase-js";
import { LEAGUES } from "./footballData";
import {
  loadMaps,
  linkLocalName,
  fetchLiveEntries,
  seasonUpcomingExtra,
  seasonRecentLite,
  tournamentLiveFixtures,
  tournamentSeasons,
  type SofaFixture,
} from "./sofaHistory";
import { loadSofaLeague } from "./sofaLeague";
import { cacheGetAny, cacheSet, HOUR_MS } from "./sofaCache";
import { matchTeamIn } from "./liveMatch";
import { leagueRates, predict } from "./footballModel";
import { matchTotalOver, MIN_GAMES } from "./recommendation";

export interface LiteRow {
  eventId: number;
  time: string | null;
  home: string;
  away: string;
}

export interface ModelRow {
  eventId: number;
  home: string;
  away: string;
  cells: { h: number; d: number; a: number; o25: number; btts: number };
  games: number;
  fragile: boolean;
}

export interface LiteLeague {
  code: string;
  label: string;
  rows: LiteRow[];
}

export interface ModelBucket {
  model: ModelRow[];
  age: number; // ms desde a última escrita
  failed: boolean; // último passe falhou a leitura da liga
}

interface BucketPayload {
  rows?: ModelRow[];
  failed?: boolean;
}

// Small bounded helpers -------------------------------------------------

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let k = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (k < items.length) {
      const n = k++;
      out[n] = await fn(items[n]);
    }
  });
  await Promise.all(workers);
  return out;
}

export const dayKeyOf = (base: Date, days: number): string => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// In-flight per model bucket: repeated visits during a pass are no-ops.
const inflight = new Set<string>();

function kickModel(key: string, run: () => Promise<void>): void {
  if (inflight.has(key)) return;
  inflight.add(key);
  void run()
    .catch(() => {})
    .finally(() => inflight.delete(key));
}

// Shared filter helpers -------------------------------------------------

export async function leagueOptions(
  supabase: SupabaseClient,
  userId: string,
  pais: string,
  ligaSel: string
): Promise<{ codes: string[]; labelOf: (code: string) => string }> {
  const maps = await loadMaps(supabase, userId, "tournament").catch(() => []);
  const codesAll = new Set(maps.map((m) => m.name_key));
  const countryOf = (label: string): string => label.split("·")[0]?.trim() ?? label;
  const leagues = LEAGUES.filter((l) => {
    if (!codesAll.has(l.code) || l.code.startsWith("int.")) return false;
    if (ligaSel && l.code !== ligaSel) return false;
    if (pais && countryOf(l.label as string) !== pais) return false;
    return true;
  });
  return { codes: leagues.map((l) => l.code), labelOf: (code: string) => leagues.find((l) => l.code === code)?.label ?? code };
}

export function dayListKey(day: string, pais: string, ligaSel: string): string {
  return `daylist:v1:${day}|${pais}|${ligaSel}`;
}

export function dayModelKey(day: string, code: string): string {
  return `daymodel:v1:${day}|${code}`;
}

// 1) Fixture list for the day, per league — probe reads only (cheap, shared
// caches with every other view). Cached whole for 30 min, so the page always
// opens at list-speed whatever the filters.
export async function dayList(
  supabase: SupabaseClient,
  userId: string,
  day: string,
  pais: string,
  ligaSel: string
): Promise<LiteLeague[]> {
  const key = dayListKey(day, pais, ligaSel);
  const cached = await cacheGetAny(supabase, userId, key).catch(() => null);
  const cachedAt = cached ? Date.now() - cached.fetchedAt : Infinity;
  const payload = cached?.payload as LiteLeague[] | null;
  if (Array.isArray(payload) && cachedAt < HOUR_MS / 2) return payload;

  const { codes, labelOf } = await leagueOptions(supabase, userId, pais, ligaSel);
  const maps = await loadMaps(supabase, userId, "tournament").catch(() => []);
  const teamMaps = await loadMaps(supabase, userId, "team").catch(() => []);
  const toLocal = new Map(teamMaps.filter((m) => m.local_name).map((m) => [m.name, m.local_name]));
  const convert = (name: string): string => toLocal.get(name) ?? linkLocalName(teamMaps, name) ?? name;
  const liveEntries = await fetchLiveEntries().catch(() => []);

  const found: LiteLeague[] = [];
  await pool(codes, 4, async (code) => {
    const map = maps.find((m) => m.name_key === code);
    if (!map) return;
    // Liga com épocas por ler: falha calada desta passagem (recupera no fim
    // do TTL, em fundo, sem refazer as outras).
    const seasons = await tournamentSeasons(supabase, userId, map.sofascore_id).catch(() => null);
    if (!seasons) return;
    const s = seasons[0];
    if (!s) return;
    const upcoming = await seasonUpcomingExtra(supabase, userId, map.sofascore_id, s.id, true, 0).catch(() => null);
    if (upcoming === null) return;
    const recent = await seasonRecentLite(supabase, userId, map.sofascore_id, s.id, true).catch(() => [] as SofaFixture[]);
    const seenIds = new Set<number>();
    const flat: SofaFixture[] = [];
    for (const f of [...upcoming, ...(recent ?? []), ...tournamentLiveFixtures(liveEntries, map.sofascore_id, 0)]) {
      if (f.date === day && !seenIds.has(f.id)) {
        seenIds.add(f.id);
        flat.push(f);
      }
    }
    // Um emparelhamento por liga/dia (aditamento ao lado do jogo adiado duplicava linha).
    const seenPairs = new Set<string>();
    const rows: LiteRow[] = [];
    for (const f of flat) {
      const k = `${f.team1}|${f.team2}`;
      if (seenPairs.has(k)) continue;
      seenPairs.add(k);
      rows.push({ eventId: f.id, time: f.time ?? null, home: convert(f.team1), away: convert(f.team2) });
    }
    if (rows.length > 0) {
      rows.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? "") || a.home.localeCompare(b.home));
      found.push({ code, label: labelOf(code), rows });
    }
  });
  found.sort((a, b) => a.label.localeCompare(b.label));
  await cacheSet(supabase, userId, key, found).catch(() => {});
  return found;
}

// 2) Model per league — history load (the only heavy read) + predictions.
// Writes its own bucket; a failed pass marks it failed without discarding the
// list, and the next visit retries only this league.
export async function computeDayLeagueModel(
  supabase: SupabaseClient,
  userId: string,
  day: string,
  code: string
): Promise<void> {
  const now = new Date();
  const list = await dayList(supabase, userId, day, "", "");
  const lg = list.find((l) => l.code === code);
  const key = dayModelKey(day, code);
  if (!lg) {
    // Sem jogos na lista (ou lista fresca ainda sem esta liga): guarda vazio.
    await cacheSet(supabase, userId, key, { rows: [], failed: false }).catch(() => {});
    return;
  }
  let data: { matches: unknown[]; teams: string[] } | null = null;
  try {
    const loaded = await loadSofaLeague(supabase, userId, code, { history: true, fixtures: false });
    data = (loaded?.data as { matches: unknown[]; teams: string[] } | null) ?? null;
  } catch {
    data = null;
  }
  if (!data) {
    await cacheSet(supabase, userId, key, { rows: [], failed: true }).catch(() => {});
    return;
  }
  const matches = data.matches as Parameters<typeof predict>[0];
  const fhs = leagueRates(matches, now).firstHalfShare;
  const model: ModelRow[] = [];
  for (const row of lg.rows) {
    const homeIn = data.teams.includes(row.home) || matchTeamIn(row.home, data.teams) !== null;
    const awayIn = data.teams.includes(row.away) || matchTeamIn(row.away, data.teams) !== null;
    if (!homeIn || !awayIn) continue; // grafia desatualizada: fica "–" na tabela
    const prediction = predict(matches, row.home, row.away, now);
    const games = Math.min(prediction.gamesHome, prediction.gamesAway);
    model.push({
      eventId: row.eventId,
      home: row.home,
      away: row.away,
      cells: {
        h: prediction.fullTime.home,
        d: prediction.fullTime.draw,
        a: prediction.fullTime.away,
        o25: prediction.over["2.5"] ?? matchTotalOver(prediction.lambdaHome, prediction.lambdaAway, 2.5),
        btts: prediction.bothScore,
      },
      games,
      fragile: games < MIN_GAMES,
    });
  }
  await cacheSet(supabase, userId, key, { rows: model, failed: false }).catch(() => {});
}

// Read one league's bucket (never blocks): missing = pending; old = serving
// the last pass while a fresh one re-runs.
export async function readModelBucket(
  supabase: SupabaseClient,
  userId: string,
  day: string,
  code: string
): Promise<{ bucket: ModelBucket | null; pending: boolean; refreshing: boolean }> {
  const meta = await cacheGetAny(supabase, userId, dayModelKey(day, code)).catch(() => null);
  if (!meta) return { bucket: null, pending: true, refreshing: false };
  const p = meta.payload as BucketPayload;
  const bucket: ModelBucket = {
    model: Array.isArray(p?.rows) ? (p.rows as ModelRow[]) : [],
    age: Date.now() - meta.fetchedAt,
    failed: p?.failed === true,
  };
  if (bucket.age > 6 * HOUR_MS) {
    return { bucket, pending: false, refreshing: true };
  }
  return { bucket, pending: false, refreshing: false };
}

// 3) Prewarm of the next days: same two steps, in background, without
// waiting — so day +1/+2 open ready. Fresh caches make repeat visits no-ops.
export async function prewarmUpcomingDaysLite(
  supabase: SupabaseClient,
  userId: string,
  daysAhead = 2,
  base: Date = new Date()
): Promise<void> {
  for (let i = 1; i <= daysAhead; i++) {
    const day = dayKeyOf(base, i);
    void (async () => {
      const list = await dayList(supabase, userId, day, "", "").catch(() => []);
      for (const lg of list) {
        const { pending, refreshing } = await readModelBucket(supabase, userId, day, lg.code).catch(() => ({ pending: false, refreshing: false }));
        if (pending || refreshing) kickModel(dayModelKey(day, lg.code), () => computeDayLeagueModel(supabase, userId, day, lg.code));
      }
    })();
  }
}

// Convenience: ensure every league in today's list has a bucket (or one set
// in motion). Returns nothing — the caller reads statuses itself.
export function ensureDayModels(
  supabase: SupabaseClient,
  userId: string,
  day: string,
  list: LiteLeague[]
): void {
  void (async () => {
    for (const lg of list) {
      const st = await readModelBucket(supabase, userId, day, lg.code).catch(() => null);
      if (st === null || st.pending || st.refreshing || st.bucket?.failed === true) {
        kickModel(dayModelKey(day, lg.code), () => computeDayLeagueModel(supabase, userId, day, lg.code));
      }
    }
  })();
}
