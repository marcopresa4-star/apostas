"use server";

import { createClient } from "@/lib/supabase/server";
import { LEAGUES, isInternational } from "@/lib/footballData";
import { loadMaps, seasonFixtures, tournamentSeasons } from "@/lib/sofaHistory";
import { cacheGetAny, cacheSet, HOUR_MS } from "@/lib/sofaCache";
import { marketRates } from "@/lib/leagueProfile";
import type { CompareBuildResult, LeagueCompareIndex, LeagueSnapshot } from "@/lib/leagueCompare";

const INDEX_KEY = "leaguecompare:v2";
// A league's season is read round by round, so building all 42 at once would
// be a single request of several minutes. The action instead does a batch and
// the button calls it again: progress is visible and an interrupted build
// resumes, since every row is cached as soon as it is read.
const BATCH = 4;
const FRESH_MS = 6 * HOUR_MS;
// A "recalcular" run must not redo the rows it just read on the next call.
const RECALC_MS = 5 * 60_000;

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

async function readIndex(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<LeagueCompareIndex | null> {
  const hit = await cacheGetAny(supabase, userId, INDEX_KEY).catch(() => null);
  const index = hit?.payload as LeagueCompareIndex | undefined;
  return index && Array.isArray(index.rows) ? index : null;
}

// One batch of the whole-league table: the leagues whose row is missing or
// older than 6 hours (5 minutes when `force`, i.e. "recalcular").
export async function buildLeagueCompareAction(force = false): Promise<CompareBuildResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");

  const maps = await loadMaps(supabase, user.id, "tournament").catch(() => []);
  const today = new Date().toISOString().slice(0, 10);
  const leagues = LEAGUES.filter((l) => !isInternational(l.code) && maps.some((m) => m.name_key === l.code)).sort(
    (a, b) => (a.label as string).localeCompare(b.label as string)
  );

  const previous = await readIndex(supabase, user.id);
  const known = new Map((previous?.rows ?? []).map((r) => [r.code, r]));
  const maxAge = force ? RECALC_MS : FRESH_MS;
  const now = Date.now();
  const missing = new Map((previous?.missing ?? []).map((m) => [m.code, m]));
  const pending = leagues.filter((l) => {
    // A league that failed in an earlier call is reported, not retried on
    // every press (that would never finish); "recalcular" tries again.
    if (missing.has(l.code) && !force) return false;
    const row = known.get(l.code);
    return !row || now - row.at > maxAge;
  });
  const batch = pending.slice(0, BATCH);

  const fresh = await pool(batch, 3, async (league): Promise<LeagueSnapshot | null> => {
    const map = maps.find((m) => m.name_key === league.code)!;
    try {
      const seasons = await tournamentSeasons(supabase, user.id, map.sofascore_id);
      const season = seasons[0] ?? null;
      if (!season) {
        missing.set(league.code, { code: league.code, label: league.label as string, error: "sem épocas no SofaScore" });
        return null;
      }
      const fixtures = await seasonFixtures(supabase, user.id, map.sofascore_id, season.id, true, today);
      const played = fixtures.flatMap((f) =>
        f.ft ? [{ date: f.date, team1: f.team1, team2: f.team2, ft: f.ft, ht: f.ht }] : []
      );
      missing.delete(league.code);
      return {
        code: league.code,
        label: league.label as string,
        season: season.name || season.year,
        games: played.length,
        at: Date.now(),
        rates: marketRates(played),
      };
    } catch {
      missing.set(league.code, { code: league.code, label: league.label as string, error: "leitura falhou" });
      return null;
    }
  });

  for (const row of fresh) if (row) known.set(row.code, row);
  const rows = leagues.flatMap((l) => {
    const row = known.get(l.code);
    return row ? [row] : [];
  });
  const remaining = Math.max(0, pending.length - batch.length);
  const done = remaining === 0;
  const index: LeagueCompareIndex = {
    at: done ? Date.now() : (previous?.at ?? 0),
    total: leagues.length,
    rows,
    missing: [...missing.values()].filter((m) => leagues.some((l) => l.code === m.code)),
  };
  await cacheSet(supabase, user.id, INDEX_KEY, index).catch(() => undefined);
  return { index, done, remaining, total: leagues.length };
}
