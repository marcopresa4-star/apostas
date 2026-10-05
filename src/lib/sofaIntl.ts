// Phase 3b: national teams from SofaScore. Every mapped national team
// contributes its own event list (deduped by event id); the model fits over
// the result exactly like over the files. Neutral venue is guessed from the
// tournament (list responses carry no venue) — host-nation games in hosted
// finals misflag, noted as a limitation and validated via Fiabilidade.
import type { SupabaseClient } from "@supabase/supabase-js";
import { activeTeams, isoDaysAgo } from "./internationalData";
import type { IntlGame } from "./internationalModel";
import { lisbonParts, loadMaps, nationalGames } from "./sofaHistory";
import type { StaleTracker } from "./sofaCache";
import { teamEventList } from "./sofaLeague";
import { slugify } from "./slugify";

export interface SofaIntl {
  games: IntlGame[];
  teams: string[];
  unlinked: string[];
  mapped: number;
  // Any read served expired cache (scraper down): pages warn instead of
  // pretending the data is fresh.
  stale: boolean;
}

// The local scraper answers reads one at a time: firing every linked team
// at once queues dozens of chains behind each other (and behind the live
// widget and the watch poller), so teams go in small batches.
const TEAM_CONCURRENCY = 6;

async function eachBatch<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
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
  const tracker: StaleTracker = { stale: false };
  await eachBatch(maps, TEAM_CONCURRENCY, async (m) => {
    if (!Number.isInteger(m.sofascore_id) || m.sofascore_id <= 0) return;
    const games = await nationalGames(m.sofascore_id, since, 20, { supabase, userId }, tracker).catch(() => []);
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
  });
  const games = [...seen.values()].sort((a, b) => a.date.localeCompare(b.date) || a.home.localeCompare(b.home));
  return {
    games,
    teams: activeTeams(games, now),
    unlinked: [...unlinked].sort((a, b) => a.localeCompare(b)),
    mapped: maps.length,
    stale: tracker.stale,
  };
}

export interface UpcomingIntlGame {
  id: number;
  date: string;
  time: string | null;
  home: string;
  away: string;
  tournament: string;
}

// Upcoming games of the linked national teams (next event lists, deduped):
// Nations League only, or everything, for the Jornada page. National sides
// have no rounds on SofaScore, so the games group by competition instead.
// `onlyIds` restricts the sweep to a few teams (the Comparar page only needs
// the two sides' own lists to find their pairing, not every linked team).
export async function loadUpcomingIntl(
  supabase: SupabaseClient,
  userId: string,
  today: string,
  nationsLeagueOnly: boolean,
  onlyIds?: number[]
): Promise<UpcomingIntlGame[]> {
  const maps = (await loadMaps(supabase, userId, "team")).filter((m) => m.name_key.startsWith("int:"));
  if (maps.length === 0) return [];
  const toLocal = new Map(maps.filter((m) => m.local_name).map((m) => [m.name, m.local_name]));
  const wanted =
    onlyIds && onlyIds.length > 0 ? maps.filter((m) => onlyIds.includes(m.sofascore_id)) : maps;
  if (wanted.length === 0) return [];
  const seen = new Set<number>();
  const out: UpcomingIntlGame[] = [];
  await eachBatch(wanted, TEAM_CONCURRENCY, async (m) => {
    if (!Number.isInteger(m.sofascore_id) || m.sofascore_id <= 0) return;
    const events = await teamEventList(supabase, userId, m.sofascore_id, "next").catch(() => []);
    for (const s of events) {
      if (seen.has(s.id)) continue;
      if (s.status !== "notstarted") continue;
      const tournament = s.tournament;
      if (!tournament) continue;
      if (nationsLeagueOnly && (!/nations league/i.test(tournament) || /concacaf/i.test(tournament))) continue;
      const { date, time } = lisbonParts(s.start);
      if (date < today) continue;
      seen.add(s.id);
      out.push({ id: s.id, date, time, home: toLocal.get(s.home) ?? s.home, away: toLocal.get(s.away) ?? s.away, tournament });
    }
  });
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
}
