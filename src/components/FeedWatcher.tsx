"use client";

import { useEffect } from "react";
import { pollEvoGame } from "@/lib/useEvoSnapshots";
import { loadFeedStore, notifyFeedStore, saveFeedStore } from "@/lib/feedStore";

// Global feed capture: lives in the layout, so snapshots accumulate on EVERY
// site page (not just /feed) while a tab is open. Skips games whose store is
// fresh (<90s: a FeedCard is already polling them). Still needs a site tab
// open somewhere: closed browser = nothing runs.
const FRESH_MS = 90_000;

export default function FeedWatcher() {
  useEffect(() => {
    let stop = false;
    const tick = async (): Promise<void> => {
      let ids: number[] = [];
      try {
        const res = await fetch("/api/feed/games", { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as { eventIds?: unknown };
          if (Array.isArray(body.eventIds)) {
            ids = body.eventIds.filter((n): n is number => typeof n === "number").slice(0, 5);
          }
        }
      } catch {
        return;
      }
      if (stop || ids.length === 0) return;
      for (const id of ids) {
        if (stop) return;
        const stored = loadFeedStore(id);
        if (stored && Date.now() - stored.updatedAt < FRESH_MS) continue;
        let next = null;
        try {
          next = await pollEvoGame(id, stored?.snaps ?? [], stored?.filled ?? false);
        } catch {
          continue;
        }
        if (stop || !next) continue;
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
