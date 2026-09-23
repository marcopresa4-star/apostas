// Phase 3b: national teams from SofaScore. Every mapped national team
// contributes its own event list (deduped by event id); the model fits over
// the result exactly like over the files. Neutral venue is guessed from the
// tournament (list responses carry no venue) — host-nation games in hosted
// finals misflag, noted as a limitation and validated via Fiabilidade.
import type { SupabaseClient } from "@supabase/supabase-js";
import { activeTeams, isoDaysAgo } from "./internationalData";
import type { IntlGame } from "./internationalModel";
import { loadMaps, nationalGames } from "./sofaHistory";

export interface SofaIntl {
  games: IntlGame[];
  teams: string[];
  unlinked: string[];
  mapped: number;
}

export async function loadSofaInternational(
  supabase: SupabaseClient,
  userId: string,
  now: Date
): Promise<SofaIntl | null> {
  const maps = (await loadMaps(supabase, userId, "team")).filter((m) => m.name_key.startsWith("int:"));
  if (maps.length === 0) return null;
  const since = isoDaysAgo(now, 15 * 365);

  const toLocal = new Map(maps.filter((m) => m.local_name).map((m) => [m.name, m.local_name]));
  const unlinked = new Set<string>();
  const convert = (name: string): string => {
    const local = toLocal.get(name);
    if (local) return local;
    unlinked.add(name);
    return name;
  };

  const seen = new Map<number, IntlGame>();
  await Promise.all(
    maps.map(async (m) => {
      if (!Number.isInteger(m.sofascore_id) || m.sofascore_id <= 0) return;
      const games = await nationalGames(m.sofascore_id, since, 20, { supabase, userId }).catch(() => []);
      for (const g of games) {
        if (seen.has(g.id)) continue;
        seen.set(g.id, {
          date: g.date,
          home: convert(g.home),
          away: convert(g.away),
          hg: g.hg,
          ag: g.ag,
          neutral: g.neutral,
          tournament: g.tournament,
        });
      }
    })
  );
  const games = [...seen.values()].sort((a, b) => a.date.localeCompare(b.date) || a.home.localeCompare(b.home));
  return {
    games,
    teams: activeTeams(games, now),
    unlinked: [...unlinked].sort((a, b) => a.localeCompare(b)),
    mapped: maps.length,
  };
}
