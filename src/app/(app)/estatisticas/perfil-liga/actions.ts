"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { LEAGUES, isInternational } from "@/lib/footballData";
import { loadMaps, seasonFixtures, tournamentSeasons } from "@/lib/sofaHistory";
import { cacheGetAny, cacheSet, HOUR_MS } from "@/lib/sofaCache";
import { marketRates } from "@/lib/leagueProfile";
import type { LeagueCompareIndex, LeagueSnapshot } from "@/lib/leagueCompare";

const INDEX_KEY = "leaguecompare:v1";
const ROW_KEY = (code: string, seasonId: number): string => `leagueprofile:v1:${code}:${seasonId}`;
// A league's season is read round by round: the first build of all 42 takes
// minutes. Rows are cached one by one, so a second press resumes instead of
// starting over.
const FRESH_MS = 6 * HOUR_MS;

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

// One row per mapped club league: the same market frequencies as the league
// page, from this season's finished games. `force` ignores the 6-hour cache.
export async function buildLeagueCompareAction(force = false): Promise<LeagueCompareIndex> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");

  const maps = await loadMaps(supabase, user.id, "tournament").catch(() => []);
  const today = new Date().toISOString().slice(0, 10);
  const leagues = LEAGUES.filter((l) => !isInternational(l.code) && maps.some((m) => m.name_key === l.code));

  const missing: LeagueCompareIndex["missing"] = [];
  const rows = await pool(leagues, 3, async (league): Promise<LeagueSnapshot | null> => {
    const map = maps.find((m) => m.name_key === league.code)!;
    try {
      const seasons = await tournamentSeasons(supabase, user.id, map.sofascore_id);
      const season = seasons[0] ?? null;
      if (!season) {
        missing.push({ code: league.code, label: league.label as string, error: "sem épocas no SofaScore" });
        return null;
      }
      const key = ROW_KEY(league.code, season.id);
      if (!force) {
        const hit = await cacheGetAny(supabase, user.id, key).catch(() => null);
        const row = hit?.payload as LeagueSnapshot | undefined;
        if (row && Date.now() - hit!.fetchedAt < FRESH_MS) return row;
      }
      const fixtures = await seasonFixtures(
        supabase,
        user.id,
        map.sofascore_id,
        season.id,
        true,
        today
      );
      const played = fixtures.flatMap((f) =>
        f.ft ? [{ date: f.date, team1: f.team1, team2: f.team2, ft: f.ft, ht: f.ht }] : []
      );
      const row: LeagueSnapshot = {
        code: league.code,
        label: league.label as string,
        season: season.name || season.year,
        games: played.length,
        rates: marketRates(played),
      };
      await cacheSet(supabase, user.id, key, row).catch(() => undefined);
      return row;
    } catch {
      missing.push({ code: league.code, label: league.label as string, error: "leitura falhou" });
      return null;
    }
  });

  const index: LeagueCompareIndex = {
    at: Date.now(),
    rows: rows.filter((r): r is LeagueSnapshot => r !== null).sort((a, b) => a.label.localeCompare(b.label)),
    missing,
  };
  await cacheSet(supabase, user.id, INDEX_KEY, index).catch(() => undefined);
  revalidatePath("/estatisticas/perfil-liga");
  return index;
}

export async function readLeagueCompareAction(): Promise<LeagueCompareIndex | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const hit = await cacheGetAny(supabase, user.id, INDEX_KEY).catch(() => null);
  const index = hit?.payload as LeagueCompareIndex | undefined;
  return index && Array.isArray(index.rows) ? index : null;
}
