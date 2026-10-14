"use client";

import { useEffect, useState } from "react";
import { MomentumChart, type MomentumPoint } from "./SofaScoreWidget";
import { parseStatRows } from "./LiveEvolutionChart";

// Expandable live-stats panel for a pinned game (Ao vivo board): attack
// momentum on top, grouped stat bars below (photo-style). Only rows with
// readings on at least one side render — the rest is silence, not zeros.
interface StatVals {
  home: number | null;
  away: number | null;
}

const GROUPS: { title: string; rows: { key: string; label: string; pct?: boolean }[] }[] = [
  { title: "Domínio", rows: [{ key: "Posse de bola", label: "Posse de bola", pct: true }] },
  {
    title: "Remates",
    rows: [
      { key: "Remates", label: "Remates" },
      { key: "Remates à baliza", label: "À baliza" },
      { key: "Grandes chances", label: "Grandes chances" },
    ],
  },
  {
    title: "Bolas paradas",
    rows: [
      { key: "Cantos", label: "Cantos" },
      { key: "Cruzamentos", label: "Cruzamentos" },
      { key: "Foras de jogo", label: "Foras de jogo" },
    ],
  },
  {
    title: "Disciplina",
    rows: [
      { key: "Faltas", label: "Faltas" },
      { key: "__yellows", label: "Amarelos" },
    ],
  },
];

const fmt = (v: number | null, pct?: boolean): string => {
  if (v === null || !Number.isFinite(v)) return "—";
  if (pct) return `${Math.round(v)}%`;
  return Number.isInteger(v) ? String(v) : v.toFixed(1).replace(".", ",");
};

function BarRow({ home, away, label, pct }: { home: number | null; away: number | null; label: string; pct?: boolean }) {
  const tot = (home ?? 0) + (away ?? 0);
  const hp = tot > 0 ? ((home ?? 0) / tot) * 100 : 50;
  return (
    <div className="py-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="w-10 shrink-0 text-left font-semibold tabular-nums text-sky-300">{fmt(home, pct)}</span>
        <span className="min-w-0 flex-1 truncate text-center text-neutral-400">{label}</span>
        <span className="w-10 shrink-0 text-right font-semibold tabular-nums text-orange-300">{fmt(away, pct)}</span>
      </div>
      <div className="mt-0.5 flex h-1 gap-0.5 overflow-hidden rounded-full bg-neutral-800">
        <div className="rounded-full bg-sky-500/80" style={{ width: `${home === null && away === null ? 0 : hp}%` }} />
        <div className="flex-1 rounded-full bg-orange-500/80" style={{ width: `${home === null && away === null ? 0 : 100 - hp}%` }} />
      </div>
    </div>
  );
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

export default function PinnedLiveStats({
  eventId,
  homeName,
  awayName,
}: {
  eventId: number;
  homeName: string;
  awayName: string;
}) {
  const [stats, setStats] = useState<Record<string, StatVals>>({});
  const [momentum, setMomentum] = useState<MomentumPoint[]>([]);
  const [minute, setMinute] = useState<number | null>(null);
  const [yellows, setYellows] = useState<StatVals>({ home: null, away: null });

  useEffect(() => {
    let stop = false;
    const poll = async (): Promise<void> => {
      const [statBody, graphBody, eventBody] = await Promise.all([
        readJson(`/api/sofascore/statistics?id=${eventId}`),
        readJson(`/api/sofascore/graph?id=${eventId}`),
        readJson(`/api/sofascore/event?id=${eventId}&light=1`),
      ]);
      if (stop) return;
      const rows = (statBody as { stats?: { name?: unknown; home?: unknown; away?: unknown }[] } | null)?.stats;
      if (Array.isArray(rows)) setStats(parseStatRows(rows));
      const pts = (graphBody as { points?: { minute?: unknown; value?: unknown }[] } | null)?.points;
      if (Array.isArray(pts)) {
        setMomentum(
          pts.flatMap((p) =>
            typeof p.minute === "number" && typeof p.value === "number" ? [{ minute: p.minute, value: p.value }] : []
          )
        );
      }
      const st = (
        eventBody as {
          state?: { minute?: unknown; phase?: unknown; yellows?: { home?: unknown; away?: unknown } };
        } | null
      )?.state;
      if (st && typeof st.minute === "number") setMinute(st.minute);
      const yh = st?.yellows && typeof st.yellows.home === "number" ? st.yellows.home : null;
      const ya = st?.yellows && typeof st.yellows.away === "number" ? st.yellows.away : null;
      setYellows({ home: yh, away: ya });
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
  }, [eventId]);

  const val = (key: string): StatVals =>
    key === "__yellows" ? yellows : (stats[key] ?? { home: null, away: null });

  return (
    <div className="mt-3 border-t border-neutral-800 pt-2">
      {momentum.length > 0 && <MomentumChart points={momentum} home={homeName} away={awayName} minute={minute} />}
      {GROUPS.map((g) => {
        const rows = g.rows
          .map((r) => ({ ...r, v: val(r.key) }))
          .filter((r) => r.v.home !== null || r.v.away !== null);
        if (rows.length === 0) return null;
        return (
          <div key={g.title} className="mt-2 rounded-lg bg-neutral-900 px-3 py-2">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{g.title}</p>
            {rows.map((r) => (
              <BarRow key={r.key} home={r.v.home} away={r.v.away} label={r.label} pct={r.pct} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
