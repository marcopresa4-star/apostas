// Server read of SofaScore's real bookmaker odds, cached in Supabase like the
// rest of the history. Finished games keep their (closing-ish) prices, so the
// caller picks the TTL: about a minute live, days for settled games.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sofaRaw } from "./sofaRaw";
import { cacheGet, cacheSet } from "./sofaCache";
import { parseOddsMarkets, type ParsedOdds } from "./oddsParse";

export async function eventOdds(
  supabase: SupabaseClient,
  userId: string,
  eventId: number,
  ttlMs: number
): Promise<ParsedOdds | null> {
  const key = `odds:${eventId}`;
  const hit = await cacheGet(supabase, userId, key, ttlMs);
  if (hit && typeof hit === "object" && !Array.isArray(hit)) return hit as ParsedOdds;
  let body: unknown;
  try {
    body = await sofaRaw<unknown>(`/event/${eventId}/odds/1/all`);
  } catch {
    return null;
  }
  if (!body) return null;
  const parsed = parseOddsMarkets(body, eventId);
  // Cache hits AND misses (a game with no prices yet keeps reporting 404):
  // without the miss entry every page load would retry the read.
  await cacheSet(supabase, userId, key, parsed ?? { eventId, live: false, markets: [] });
  return parsed;
}
