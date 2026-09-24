// Phase 3b: national teams from SofaScore. Every mapped national team
// contributes its own event list (deduped by event id); the model fits over
// the result exactly like over the files. Neutral venue is guessed from the
// tournament (list responses carry no venue) — host-nation games in hosted
// finals misflag, noted as a limitation and validated via Fiabilidade.
import type { SupabaseClient } from "@supabase/supabase-js";
import { activeTeams, isoDaysAgo } from "./internationalData";
import type { IntlGame } from "./internationalModel";
import { loadMaps, nationalGames } from "./sofaHistory";
import { slugify } from "./slugify";

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
  const allMaps = await loadMaps(supabase, userId, "team");
  const maps = allMaps.filter((m) => m.name_key.startsWith("int:"));
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

  // Not senior men's national sides, so out of the model (and mostly out of
  // the unlinked list): clubs (matched against every club link), Olympic and
  // other lettered sides, and exhibition regions.
  const clubNames = new Set(
    allMaps.filter((m) => !m.name_key.startsWith("int:") && m.sofascore_id > 0).map((m) => slugify(m.name))
  );
  const NON_SENIOR = /olympic|women|feminino|U-?\d{1,2}\b/i;
  const SECOND_TEAM = / [ABU]\d*$/;
  const REGIONS = new Set(["basque-country", "catalunya", "catalonia", "galicia", "corsica", "sicily"]);
  const outOfScope = (name: string): boolean => {
    const slug = slugify(name);
    return clubNames.has(slug) || NON_SENIOR.test(name) || SECOND_TEAM.test(name) || REGIONS.has(slug);
  };

  const seen = new Map<number, IntlGame>();
  await Promise.all(
    maps.map(async (m) => {
      if (!Number.isInteger(m.sofascore_id) || m.sofascore_id <= 0) return;
      const games = await nationalGames(m.sofascore_id, since, 20, { supabase, userId }).catch(() => []);
      for (const g of games) {
        if (seen.has(g.id)) continue;
        if (outOfScope(g.home) || outOfScope(g.away)) continue;
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
