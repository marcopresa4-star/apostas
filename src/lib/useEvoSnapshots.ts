"use client";

import { useEffect, useRef, useState } from "react";
import { parseStatRows, type EvoSnap } from "../components/LiveEvolutionChart";
import { loadFeedStore, notifyFeedStore, saveFeedStore } from "./feedStore";

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
  half: 1 | 2 | null;
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
  // The half in progress now: minutes past 45 inherit it (first-half
  // stoppage belongs left of the break), older ones default to the 2nd.
  half?: 1 | 2 | null;
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
    out.push({ minute, hg, ag, rh, ra, stats: {}, xgH: xg(true), xgA: xg(false), half: minute <= 45 ? 1 : (opts.half ?? 2) });
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

export interface EvoPoll {
  snaps: EvoSnap[];
  live: FeedLive | null;
  meta: FeedMeta | null;
  filled: boolean;
  // The phase seen this round, even pre-match (null only when unreadable).
  phase: string | null;
}

// First poll per session per game is full (navigates the scraper page once);
// steady-state polls go light (API only: fast and parallel, no navigation).
const fullPolled = new Set<number>();
export function pollLight(eventId: number): boolean {
  return fullPolled.has(eventId);
}
export function markPolled(eventId: number): void {
  fullPolled.add(eventId);
}

// One polling round for a game: event state + statistics + shotmap merged
// onto prev. Unreadable -> null (keep prev). Pre-match -> live null with prev
// snaps untouched. Live snapshots are merged first so their real stats win
// over the backfilled shells at the same minute.
export async function pollEvoGame(eventId: number, prev: EvoSnap[], filled: boolean, light = false): Promise<EvoPoll | null> {
  const body = (await readJson(`/api/sofascore/event?id=${eventId}${light ? "&light=1" : ""}`)) as {
    state?: { phase?: unknown; minute?: unknown; homeGoals?: unknown; awayGoals?: unknown; half?: unknown; reds?: { home?: unknown; away?: unknown } };
    goals?: { minute?: unknown; home?: unknown }[];
    meta?: FeedMeta;
  } | null;
  if (!body?.state) return null;
  const st = body.state;
  const phase = String(st.phase ?? "");
  const meta = body.meta && (body.meta.home || body.meta.away) ? body.meta : null;
  if (phase !== "live" && phase !== "halftime" && phase !== "finished") {
    return { snaps: prev, live: null, meta, filled, phase };
  }
  const minute = typeof st.minute === "number" ? st.minute : null;
  const hg = typeof st.homeGoals === "number" ? st.homeGoals : null;
  const ag = typeof st.awayGoals === "number" ? st.awayGoals : null;
  if (minute === null || hg === null || ag === null) return { snaps: prev, live: null, meta, filled, phase };
  const rh = typeof st.reds?.home === "number" ? st.reds.home : 0;
  const ra = typeof st.reds?.away === "number" ? st.reds.away : 0;
  const half = st.half === 1 || st.half === 2 ? st.half : null;
  const live: FeedLive = { minute, hg, ag, rh, ra, phase, half };
  const [statBody, shotBody] = await Promise.all([
    readJson(`/api/sofascore/statistics?id=${eventId}`),
    readJson(`/api/sofascore/shotmap?id=${eventId}`),
  ]);
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
  let snaps = prev;
  if (phase === "live" || phase === "halftime") {
    const snap: EvoSnap = { minute, hg, ag, rh, ra, stats, xgH: xgUpTo(true), xgA: xgUpTo(false), half };
    snaps = [...snaps.filter((s) => s.minute !== minute), snap].sort((a, b) => a.minute - b.minute).slice(-150);
  }
  // Backfill once: minutes before we arrived, from shots + goals. Live
  // snapshots stay first so the joining minute keeps its real stats. Also
  // re-runs when the early minutes are missing (a wiped store claims to be
  // filled but starts far from minute 1: nothing real to lose, the
  // score/xG/model history to rebuild). Self-limiting: after a heal the
  // history starts at minute 1 again.
  if (!filled || (snaps.length > 0 && snaps[0].minute > 3)) {
    filled = true;
    const goals: FeedGoal[] = Array.isArray(body.goals)
      ? body.goals.flatMap((gl) =>
          typeof gl.minute === "number" && typeof gl.home === "boolean" ? [{ minute: gl.minute, home: gl.home }] : []
        )
      : [];
    snaps = mergeSnaps(snaps, backfillSnaps({ upToMinute: minute, goals, shots, rh, ra, half }));
  }
  return { snaps, live, meta, filled, phase };
}

export function useEvoSnapshots(eventId: number | null, active: boolean): {
  snaps: EvoSnap[];
  live: FeedLive | null;
  meta: FeedMeta | null;
} {
  // Empty initial state matches the server render (hydration-safe): the
  // shared store loads in the effect below, right after mount.
  const [snaps, setSnaps] = useState<EvoSnap[]>([]);
  const [live, setLive] = useState<FeedLive | null>(null);
  const [meta, setMeta] = useState<FeedMeta | null>(null);
  const filledRef = useRef(false);
  const snapsRef = useRef<EvoSnap[]>([]);
  snapsRef.current = snaps;
  const liveRef = useRef<FeedLive | null>(null);
  liveRef.current = live;
  const lastPollRef = useRef(0);

  useEffect(() => {
    const s = eventId ? loadFeedStore(eventId) : null;
    setSnaps(s?.snaps ?? []);
    setLive(s?.live ?? null);
    setMeta(s?.meta ?? null);
    filledRef.current = s?.filled ?? false;
  }, [eventId]);

  // Store broadcasts (the global watcher capturing on other pages): adopt
  // whatever was captured while we were away.
  useEffect(() => {
    if (!eventId) return;
    const onStore = (e: Event): void => {
      if ((e as CustomEvent<{ eventId?: unknown }>).detail?.eventId !== eventId) return;
      const s = loadFeedStore(eventId);
      if (!s) return;
      setSnaps(s.snaps);
      setLive(s.live);
      if (s.meta && (s.meta.home || s.meta.away)) setMeta(s.meta);
      if (s.filled) filledRef.current = true;
    };
    window.addEventListener("apostas:feed", onStore);
    return () => window.removeEventListener("apostas:feed", onStore);
  }, [eventId]);

  useEffect(() => {
    if (!eventId || !active) return;
    let stop = false;
    const poll = async (): Promise<void> => {
      // Settled games barely move: calm down to one reading per 10 min.
      if (liveRef.current?.phase === "finished" && Date.now() - lastPollRef.current < 10 * 60_000) return;
      // The store (not the render ref) is the source of truth: on mount the
      // ref is still empty while the store already holds history — polling
      // from the ref would save a near-empty array over it.
      const stored = loadFeedStore(eventId);
      if (stored?.filled) filledRef.current = true;
      const prev = stored && stored.snaps.length > 0 ? stored.snaps : snapsRef.current;
      let next: EvoPoll | null = null;
      try {
        next = await pollEvoGame(eventId, prev, filledRef.current, pollLight(eventId));
      } catch {
        return;
      } finally {
        markPolled(eventId);
      }
      if (stop || !next) return;
      lastPollRef.current = Date.now();
      filledRef.current = next.filled;
      if (next.meta) setMeta(next.meta);
      setLive(next.live);
      setSnaps(next.snaps);
      if (next.snaps.length > 0 || next.live) {
        saveFeedStore(eventId, { snaps: next.snaps, live: next.live, meta: next.meta, filled: next.filled });
        notifyFeedStore(eventId);
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
