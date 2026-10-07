// Probable/confirmed XIs for an upcoming game, from SofaScore's lineups
// endpoint (usually published ~1h before kickoff; nothing before that).
// Cached 15 minutes: probable XIs can still change. Server-only (scraper).
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sofaRaw } from "./sofaRaw";
import { cacheGet, cacheSet } from "./sofaCache";

type Json = Record<string, unknown>;
const obj = (x: unknown): Json | null =>
  typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Json) : null;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export interface LineupPlayer {
  name: string;
  pos: string;
}

export interface GameLineups {
  home: LineupPlayer[];
  away: LineupPlayer[];
  confirmed: boolean;
}

const FIFTEEN_MIN = 15 * 60_000;

function side(root: Json | null | undefined): LineupPlayer[] {
  const players = root && Array.isArray(root.players) ? (root.players as unknown[]) : [];
  return players.flatMap((p) => {
    const row = obj(p);
    if (!row || row.substitute === true) return [];
    const pl = obj(row.player);
    const name = pl ? str(pl.shortName) || str(pl.name) : "";
    if (!name) return [];
    return [{ name, pos: str(row.position) || (pl ? str(pl.position) : "") }];
  });
}

export async function fetchLineups(
  supabase: SupabaseClient,
  userId: string,
  eventId: number
): Promise<GameLineups | null> {
  const key = `lineups:${eventId}`;
  const hit = await cacheGet(supabase, userId, key, FIFTEEN_MIN).catch(() => null);
  if (hit && typeof hit === "object" && !Array.isArray(hit)) {
    const h = hit as { home?: unknown; away?: unknown; confirmed?: unknown };
    if (Array.isArray(h.home) && Array.isArray(h.away)) {
      return { home: h.home as LineupPlayer[], away: h.away as LineupPlayer[], confirmed: h.confirmed === true };
    }
  }
  let body: unknown;
  try {
    body = await sofaRaw<unknown>(`/event/${eventId}/lineups`);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const root = body as Json;
  const home = side(obj(root.home));
  const away = side(obj(root.away));
  if (home.length === 0 && away.length === 0) {
    await cacheSet(supabase, userId, key, { home: [], away: [], confirmed: false }).catch(() => {});
    return null;
  }
  const confirmed = (obj(root.home)?.confirmed ?? obj(root.away)?.confirmed) === true;
  const out = { home, away, confirmed };
  await cacheSet(supabase, userId, key, out).catch(() => {});
  return out;
}
