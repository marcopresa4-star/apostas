"use client";

import { useEffect, useRef, useState } from "react";
import { parseStatRows, type EvoSnap } from "../components/LiveEvolutionChart";

// Snapshots for one followed game: the same minute-by-minute history the
// live calculator chart draws from, but standalone (the feed page has no
// calculator). Polls the event, statistics and shotmap; backfills minutes
// 1..M on first contact from minute-stamped shots and goals.
export interface FeedShot {
  minute: number;
  home: boolean;
  xg: number | null;
}

export interface FeedGoal {
  minute: number;
  home: boolean;
}

export interface FeedLive {
  minute: number;
  hg: number;
  ag: number;
  rh: number;
  ra: number;
  phase: string;
}

export interface FeedMeta {
  home: string;
  away: string;
  tournament: string;
  kickoff: string | null;
}

// Merge keeping existing minutes (live snapshots with real stats win over
// backfilled ones), capped, sorted.
export function mergeSnaps(prev: EvoSnap[], incoming: EvoSnap[]): EvoSnap[] {
  const byMin = new Map(prev.map((s) => [s.minute, s]));
  for (const s of incoming) if (!byMin.has(s.minute)) byMin.set(s.minute, s);
  return [...byMin.values()].sort((a, b) => a.minute - b.minute).slice(-150);
}

// Rebuild minutes 1..M from minute-stamped shots and goals (stats have no
// history: gaps, never zeros).
export function backfillSnaps(opts: {
  upToMinute: number;
  goals: FeedGoal[];
  shots: FeedShot[];
  rh: number;
  ra: number;
}): EvoSnap[] {
  const { goals, shots, rh, ra } = opts;
  const out: EvoSnap[] = [];
  for (let minute = 1; minute <= Math.max(0, Math.min(130, opts.upToMinute)); minute++) {
    const hg = goals.filter((gl) => gl.home && gl.minute <= minute).length;
    const ag = goals.filter((gl) => !gl.home && gl.minute <= minute).length;
    const xg = (isHome: boolean): number | null => {
      const list = shots.filter((s) => s.home === isHome && s.xg !== null && s.minute <= minute);
      return list.length > 0 ? list.reduce((n, s) => n + (s.xg ?? 0), 0) : null;
    };
    out.push({ minute, hg, ag, rh, ra, stats: {}, xgH: xg(true), xgA: xg(false) });
  }
  return out;
}

async function readJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

export function useEvoSnapshots(eventId: number | null, active: boolean): {
  snaps: EvoSnap[];
  live: FeedLive | null;
  meta: FeedMeta | null;
} {
  const [snaps, setSnaps] = useState<EvoSnap[]>([]);
  const [live, setLive] = useState<FeedLive | null>(null);
  const [meta, setMeta] = useState<FeedMeta | null>(null);
  const filledRef = useRef(false);

  useEffect(() => {
    setSnaps([]);
    setLive(null);
    setMeta(null);
    filledRef.current = false;
  }, [eventId]);

  useEffect(() => {
    if (!eventId || !active) return;
    let stop = false;
    const poll = async (): Promise<void> => {
      const body = (await readJson(`/api/sofascore/event?id=${eventId}`)) as {
        state?: { phase?: unknown; minute?: unknown; homeGoals?: unknown; awayGoals?: unknown; reds?: { home?: unknown; away?: unknown } };
        goals?: { minute?: unknown; home?: unknown }[];
        meta?: FeedMeta;
      } | null;
      if (stop || !body?.state) return;
      const st = body.state;
      const phase = String(st.phase ?? "");
      if (body.meta && (body.meta.home || body.meta.away)) setMeta(body.meta);
      const minute = typeof st.minute === "number" ? st.minute : null;
      const hg = typeof st.homeGoals === "number" ? st.homeGoals : null;
      const ag = typeof st.awayGoals === "number" ? st.awayGoals : null;
      if (phase !== "live" && phase !== "halftime" && phase !== "finished") {
        setLive(null);
        return;
      }
      if (minute === null || hg === null || ag === null) return;
      const rh = typeof st.reds?.home === "number" ? st.reds.home : 0;
      const ra = typeof st.reds?.away === "number" ? st.reds.away : 0;
      setLive({ minute, hg, ag, rh, ra, phase });
      const [statBody, shotBody] = await Promise.all([
        readJson(`/api/sofascore/statistics?id=${eventId}`),
        readJson(`/api/sofascore/shotmap?id=${eventId}`),
      ]);
      if (stop) return;
      const rows = (statBody as { stats?: { name?: unknown; home?: unknown; away?: unknown }[] } | null)?.stats;
      const stats = parseStatRows(Array.isArray(rows) ? rows : []);
      const rawShots = (shotBody as { shots?: { minute?: unknown; home?: unknown; xg?: unknown }[] } | null)?.shots;
      const shots: FeedShot[] = Array.isArray(rawShots)
        ? rawShots.flatMap((s) =>
            typeof s.minute === "number" && typeof s.home === "boolean"
              ? [{ minute: s.minute, home: s.home, xg: typeof s.xg === "number" ? s.xg : null }]
              : []
          )
        : [];
      const xgUpTo = (isHome: boolean): number | null => {
        const list = shots.filter((s) => s.home === isHome && s.xg !== null && s.minute <= minute);
        return list.length > 0 ? list.reduce((n, s) => n + (s.xg ?? 0), 0) : null;
      };
      if (phase === "live" || phase === "halftime") {
        const snap: EvoSnap = { minute, hg, ag, rh, ra, stats, xgH: xgUpTo(true), xgA: xgUpTo(false) };
        setSnaps((prev) =>
          [...prev.filter((s) => s.minute !== minute), snap].sort((a, b) => a.minute - b.minute).slice(-150)
        );
      }
      // Backfill once: minutes before we arrived, from shots + goals.
      if (!filledRef.current) {
        filledRef.current = true;
        const goals: FeedGoal[] = Array.isArray(body.goals)
          ? body.goals.flatMap((gl) =>
              typeof gl.minute === "number" && typeof gl.home === "boolean" ? [{ minute: gl.minute, home: gl.home }] : []
            )
          : [];
        setSnaps((prev) => mergeSnaps(backfillSnaps({ upToMinute: minute, goals, shots, rh, ra }), prev));
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 60_000);
    const onVisible = (): void => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, active]);

  return { snaps, live, meta };
}
