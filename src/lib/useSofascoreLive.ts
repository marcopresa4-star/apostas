"use client";

import { useEffect, useState } from "react";
import type { SofascoreLiveData } from "./sofascore";

const POLL_MS = 20000;

export function useSofascoreLive(url: string | null) {
  const [data, setData] = useState<SofascoreLiveData | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (!url) {
        setData(null);
        return;
      }
      try {
        const res = await fetch(`/api/sofascore-live?url=${encodeURIComponent(url)}`);
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setData(json.data ?? null);
      } catch {
        // Ignore — callers fall back to the kickoff-time heuristic.
      }
    }

    poll();
    const id = url ? setInterval(poll, POLL_MS) : undefined;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [url]);

  return data;
}
