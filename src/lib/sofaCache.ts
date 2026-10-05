// Supabase-backed cache for SofaScore history reads (phase 1 of "SofaScore
// only"). Past seasons barely change: long TTL. The current season moves:
// short TTL. Rows are per user (PK is user_id+key) like the other mapping
// tables. Best-effort throughout: a missing table (migration not run) just
// reads as a miss and skips writes.
import type { SupabaseClient } from "@supabase/supabase-js";

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

interface CacheRow {
  payload: unknown;
  fetched_at: string;
}

export async function cacheGet(
  supabase: SupabaseClient,
  userId: string,
  key: string,
  ttlMs: number,
  now = Date.now()
): Promise<unknown | null> {
  try {
    const { data, error } = await supabase
      .from("sofascore_cache")
      .select("payload, fetched_at")
      .eq("user_id", userId)
      .eq("key", key)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as CacheRow;
    if (now - Date.parse(row.fetched_at) > ttlMs) return null;
    return row.payload;
  } catch {
    return null;
  }
}

// The cached payload whatever its age (null when never read): the offline
// fallback serves this instead of failing when the scraper is down.
export async function cacheGetMeta(
  supabase: SupabaseClient,
  userId: string,
  key: string
): Promise<unknown | null> {
  try {
    const { data, error } = await supabase
      .from("sofascore_cache")
      .select("payload")
      .eq("user_id", userId)
      .eq("key", key)
      .maybeSingle();
    if (error || !data) return null;
    return (data as { payload: unknown }).payload ?? null;
  } catch {
    return null;
  }
}

// Flagged when any read in the chain served expired cache: pages turn it
// into a "dados em cache" banner. One per top-level load, passed down.
export interface StaleTracker {
  stale: boolean;
}

export async function cacheSet(
  supabase: SupabaseClient,
  userId: string,
  key: string,
  payload: unknown
): Promise<void> {
  try {
    await supabase
      .from("sofascore_cache")
      .upsert({ user_id: userId, key, payload, fetched_at: new Date().toISOString() }, { onConflict: "user_id,key" });
  } catch {
    // The read itself already succeeded; the next one just costs another fetch.
  }
}

export async function cacheDrop(supabase: SupabaseClient, userId: string, key: string): Promise<void> {
  try {
    await supabase.from("sofascore_cache").delete().eq("user_id", userId).eq("key", key);
  } catch {
    // Best-effort (see above).
  }
}
