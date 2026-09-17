"use client";

import { useEffect, useState } from "react";
import type { SportscoreLiveData } from "./sportscore";

const POLL_MS = 20000;

export function useSportscoreLive(homeTeam: string | null, awayTeam: string | null) {
  const [data, setData] = useState<SportscoreLiveData | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (!homeTeam || !awayTeam) {
        setData(null);
        return;
      }
      try {
        const params = new URLSearchParams({ home: homeTeam, away: awayTeam });
        const res = await fetch(`/api/sportscore-live?${params.toString()}`);
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setData(json.data ?? null);
      } catch {
        // Ignore — callers fall back to the kickoff-time heuristic.
      }
    }

    poll();
    const id = homeTeam && awayTeam ? setInterval(poll, POLL_MS) : undefined;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [homeTeam, awayTeam]);

  return data;
}
