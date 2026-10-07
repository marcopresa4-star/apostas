import type { EvoSnap } from "../components/LiveEvolutionChart";
import type { FeedLive, FeedMeta } from "./useEvoSnapshots";

// Shared per-game capture store (browser memory that survives navigation and
// reloads): the global FeedWatcher writes it from any site page, FeedCards
// read it. Snapshots stay local — closed browser still captures nothing.
export interface FeedStored {
  snaps: EvoSnap[];
  live: FeedLive | null;
  meta: FeedMeta | null;
  filled: boolean;
  updatedAt: number;
}

const key = (eventId: number): string => `apostas:feed:${eventId}`;

export function loadFeedStore(eventId: number): FeedStored | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const raw = window.localStorage.getItem(key(eventId));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<FeedStored>;
    if (!Array.isArray(p.snaps)) return null;
    return {
      snaps: (p.snaps as EvoSnap[]).slice(-150),
      live: p.live ?? null,
      meta: p.meta ?? null,
      filled: p.filled === true,
      updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

export function saveFeedStore(eventId: number, data: Omit<FeedStored, "updatedAt">): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(
      key(eventId),
      JSON.stringify({ ...data, snaps: data.snaps.slice(-150), updatedAt: Date.now() })
    );
  } catch {
    // Quota or private mode: capture continues in memory only.
  }
}

export function notifyFeedStore(eventId: number): void {
  try {
    window.dispatchEvent(new CustomEvent("apostas:feed", { detail: { eventId } }));
  } catch {
    // No listeners: nothing to wake.
  }
}
