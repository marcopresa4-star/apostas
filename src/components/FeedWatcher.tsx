"use client";

import { useEffect } from "react";
import { markPolled, pollEvoGame, pollLight } from "@/lib/useEvoSnapshots";
import { loadFeedStore, notifyFeedStore, saveFeedStore } from "@/lib/feedStore";

// Global feed capture: lives in the layout, so snapshots accumulate on EVERY
// site page (not just /feed) while a tab is open. Skips games whose store is
// fresh (<90s: a FeedCard is already polling them). Steady-state event polls
// go light (API only, parallel); finished games calm down to 2/hour and
// pre-match ones to 1 per 5 min. Still needs a site tab open somewhere:
// closed browser = nothing runs.
const FRESH_MS = 90_000;
const GAMES_TTL_MS = 3 * 60_000;

function intervalFor(phase: string | null): number {
  if (phase === "live" || phase === "halftime") return 60_000;
  if (phase === "finished") return 30 * 60_000;
  if (phase) return 5 * 60_000;
  return 60_000;
}

export default function FeedWatcher() {
  useEffect(() => {
    let stop = false;
    const lastPoll = new Map<number, number>();
    const lastPhase = new Map<number, string | null>();
    let cachedIds: number[] = [];
    let idsAt = 0;

    const gameIds = async (): Promise<number[]> => {
      if (Date.now() - idsAt < GAMES_TTL_MS) return cachedIds;
      try {
        const res = await fetch("/api/feed/games", { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as { eventIds?: unknown };
          if (Array.isArray(body.eventIds)) {
            cachedIds = body.eventIds.filter((n): n is number => typeof n === "number").slice(0, 5);
            idsAt = Date.now();
          }
        }
      } catch {
        // Next tick retries.
      }
      return cachedIds;
    };

    const tick = async (): Promise<void> => {
      const ids = await gameIds();
      if (stop || ids.length === 0) return;
      for (const id of ids) {
        if (stop) return;
        const stored = loadFeedStore(id);
        if (stored && Date.now() - stored.updatedAt < FRESH_MS) continue;
        const phase = lastPhase.get(id) ?? stored?.live?.phase ?? null;
        if (Date.now() - (lastPoll.get(id) ?? 0) < intervalFor(phase)) continue;
        lastPoll.set(id, Date.now());
        let next = null;
        try {
          next = await pollEvoGame(id, stored?.snaps ?? [], stored?.filled ?? false, pollLight(id));
        } catch {
          continue;
        } finally {
          markPolled(id);
        }
        if (stop || !next) continue;
        lastPhase.set(id, next.phase);
        if (next.snaps.length === 0 && !next.live) continue;
        saveFeedStore(id, { snaps: next.snaps, live: next.live, meta: next.meta, filled: next.filled });
        notifyFeedStore(id);
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 60_000);
    const onVisible = (): void => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
