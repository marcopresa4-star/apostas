// Anytime-scorer prices from each probable starter's own scoring rate: the
// season's goals (or xG, more predictive when present) per 90, shrunk with a
// prior, over an assumed 85 minutes as a starter. Plain Poisson, one line per
// player. Penalties are not assigned (no taker data); bench players and
// goalkeepers stay out. Needs lineups (probable XIs pre-match, confirmed
// after), so games without coverage return null.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sofaRaw, ScraperOffline } from "./sofaRaw";
import { cacheGet, cacheSet, DAY_MS } from "./sofaCache";

type Json = Record<string, unknown>;
const obj = (x: unknown): Json | null =>
  typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Json) : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export interface ScorerPick {
  name: string;
  home: boolean;
  p: number;
  fair: number;
  goals: number;
  minutes: number;
}

interface SeasonLine {
  tournamentId: number | null;
  seasonId: number | null;
  goals: number;
  xg: number | null;
  minutes: number;
}

// A player's scoring record by tournament+season, cached a week (seasons move
// slowly; the current one refreshes on TTL).
async function playerSeasons(
  supabase: SupabaseClient,
  userId: string,
  playerId: number
): Promise<SeasonLine[]> {
  const key = `playerscorer:${playerId}`;
  const hit = await cacheGet(supabase, userId, key, 7 * DAY_MS);
  if (Array.isArray(hit)) return hit as SeasonLine[];
  const body = await sofaRaw<unknown>(`/player/${playerId}/statistics`);
  const seasons = obj(body)?.seasons;
  const out: SeasonLine[] = Array.isArray(seasons)
    ? seasons.flatMap((s) => {
        const e = obj(s);
        if (!e) return [];
        const st = obj(e.statistics) ?? {};
        const minutes = num(st.minutesPlayed) ?? 0;
        if (minutes <= 0) return [];
        const xg = st.expectedGoals;
        return [
          {
            tournamentId: num(obj(e.uniqueTournament)?.id),
            seasonId: num(obj(e.season)?.id),
            goals: num(st.goals) ?? 0,
            xg: typeof xg === "number" && Number.isFinite(xg) ? xg : null,
            minutes,
          },
        ];
      })
    : [];
  await cacheSet(supabase, userId, key, out);
  return out;
}

export async function scorersFor(
  supabase: SupabaseClient,
  userId: string,
  eventId: number
): Promise<{ home: ScorerPick[]; away: ScorerPick[] } | null> {
  // Offline stays offline (the route answers 503); anything else is just a
  // game without coverage.
  const quiet = async <T>(p: Promise<T | null>): Promise<T | null> =>
    p.catch((err) => {
      if (err instanceof ScraperOffline) throw err;
      return null;
    });
  const [lineups, eventBody] = await Promise.all([
    quiet(sofaRaw<unknown>(`/event/${eventId}/lineups`)),
    quiet(sofaRaw<unknown>(`/event/${eventId}`)),
  ]);
  if (!lineups || typeof lineups !== "object") return null;
  const event = obj(obj(eventBody)?.event ?? eventBody) ?? {};
  const uniqueId = num(obj(obj(event.tournament)?.uniqueTournament)?.id);
  const seasonId = num(obj(event.season)?.id);
  const sides: { key: "home" | "away"; home: boolean }[] = [
    { key: "home", home: true },
    { key: "away", home: false },
  ];
  const out: { home: ScorerPick[]; away: ScorerPick[] } = { home: [], away: [] };
  for (const { key, home } of sides) {
    const root = obj((lineups as Json)[key]);
    const players = root && Array.isArray(root.players) ? (root.players as unknown[]) : [];
    const xi = players.flatMap((p) => {
      const row = obj(p);
      if (!row || row.substitute === true) return [];
      const pl = obj(row.player);
      const id = pl ? num(pl.id) : null;
      const name = pl ? str(pl.shortName) || str(pl.name) : "";
      const pos = str(row.position) || (pl ? str(pl.position) : "");
      if (id === null || !name || pos === "G") return [];
      return [{ id, name }];
    });
    const picks = await Promise.all(
      xi.map(async ({ id, name }): Promise<ScorerPick | null> => {
        const seasons = await quiet(playerSeasons(supabase, userId, id)).then((s) => s ?? []);
        const line =
          seasons.find((s) => s.tournamentId === uniqueId && s.seasonId === seasonId) ??
          seasons.find((s) => s.tournamentId === uniqueId) ??
          null;
        if (!line) return null;
        // xG first (predicts better), goals when the feed carries no xG.
        const signal = line.xg ?? line.goals;
        const rate90 = (signal + 0.5) / (line.minutes / 90 + 3);
        const p = 1 - Math.exp(-rate90 * (85 / 90));
        if (!(p > 0) || !(p < 1)) return null;
        return { name, home, p, fair: 1 / p, goals: line.goals, minutes: line.minutes };
      })
    );
    out[key] = picks
      .filter((p): p is ScorerPick => p !== null)
      .sort((a, b) => b.p - a.p);
  }
  if (out.home.length === 0 && out.away.length === 0) return null;
  return out;
}
