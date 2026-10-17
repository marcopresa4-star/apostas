// Pre-match expectation for one event, shared by the route and the live
// page: resolves the event's league, predicts with the model and returns each
// side's expected goals. Unmapped leagues (or unknown teams) get typical
// figures, flagged as such.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMaps } from "./sofaHistory";
import { loadSofaLeague } from "./sofaLeague";
import { leagueRates, predict } from "./footballModel";
import { sofaRaw } from "./sofaRaw";

export interface PrematchExpectation {
  home: number;
  away: number;
  firstHalfShare: number;
  avgGoals: number | null;
  fromModel: boolean;
  league: string | null;
}

const TYPICAL: PrematchExpectation = {
  home: 1.4,
  away: 1.1,
  firstHalfShare: 0.44,
  avgGoals: null,
  fromModel: false,
  league: null,
};

export async function prematchFor(
  supabase: SupabaseClient,
  userId: string,
  eventId: number,
  opts: { body?: unknown; league?: Awaited<ReturnType<typeof loadSofaLeague>>; low?: boolean } = {}
): Promise<PrematchExpectation> {
  // One event read serves resolve + snapshot + prematch (the bots route shares
  // the body); and a league already loaded by the caller is reused — the
  // loader's full walk is the most expensive read chain there was.
  let body: unknown = opts.body;
  if (body === undefined || body === null) {
    try {
      body = await sofaRaw<unknown>(`/event/${eventId}`, {}, { low: opts.low });
    } catch {
      throw new Error("scraper-offline");
    }
  }
  const root = (body ?? {}) as Record<string, unknown>;
  const event = (root.event ?? root) as Record<string, unknown>;
  const homeSofa = ((event.homeTeam ?? {}) as Record<string, unknown>).name;
  const awaySofa = ((event.awayTeam ?? {}) as Record<string, unknown>).name;
  const unique = (((event.tournament ?? {}) as Record<string, unknown>).uniqueTournament ?? {}) as Record<
    string,
    unknown
  >;
  if (typeof homeSofa !== "string" || typeof awaySofa !== "string") {
    throw new Error("unparseable");
  }
  const tournaments = await loadMaps(supabase, userId, "tournament");
  const code =
    typeof unique.id === "number" ? (tournaments.find((m) => m.sofascore_id === unique.id)?.name_key ?? null) : null;
  if (!code) return TYPICAL;
  // Results-only load: the model needs matches (and the team list falls out
  // of them). history/fixtures/shots add no information here — the old
  // default full load re-read the whole fixture walk per live game.
  const loaded = opts.league ?? (await loadSofaLeague(supabase, userId, code, { history: false, shots: false, fixtures: false }).catch(() => null));
  if (!loaded) return TYPICAL;
  const teams = await loadMaps(supabase, userId, "team");
  const toLocal = new Map(teams.filter((m) => m.local_name).map((m) => [m.name, m.local_name]));
  const casa = toLocal.get(homeSofa) ?? homeSofa;
  const fora = toLocal.get(awaySofa) ?? awaySofa;
  if (!loaded.data.teams.includes(casa) || !loaded.data.teams.includes(fora)) return TYPICAL;
  const now = new Date();
  const prediction = predict(loaded.data.matches, casa, fora, now);
  const rates = leagueRates(loaded.data.matches, now);
  return {
    home: prediction.lambdaHome,
    away: prediction.lambdaAway,
    firstHalfShare: rates.firstHalfShare,
    avgGoals: Math.round(rates.perTeam * 2 * 100) / 100,
    fromModel: true,
    league: code,
  };
}
