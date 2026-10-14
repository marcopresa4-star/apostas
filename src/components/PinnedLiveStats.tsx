"use client";

import { useEffect, useMemo, useState } from "react";
import type { MomentumPoint } from "./SofaScoreWidget";
import { parseStatRows } from "./LiveEvolutionChart";
import type { GameIncident } from "@/app/api/sofascore/incidents/route";

// Expandable live-stats panel for a pinned game (Ao vivo board): momentum
// bars with goal/card markers and series toggles, key-stat chips, the
// incident list ("lances") and grouped stat bars. Only rows with readings
// render — the rest is silence, not zeros.
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

// Attack momentum as bars (home up, away down) with goal/card markers and
// per-layer toggles in the legend.
function MomentumBars({
  points,
  incidents,
  home,
  away,
}: {
  points: MomentumPoint[];
  incidents: GameIncident[];
  home: string;
  away: string;
}) {
  const [showHome, setShowHome] = useState(true);
  const [showAway, setShowAway] = useState(true);
  const [showGoals, setShowGoals] = useState(true);
  const [showCards, setShowCards] = useState(true);
  const W = 640;
  const H = 150;
  const PADX = 10;
  const mid = H / 2;
  const shown = useMemo(() => points.filter((p) => (p.value >= 0 ? showHome : showAway) || p.value === 0), [points, showHome, showAway]);
  const maxMinute = Math.max(90, ...points.map((p) => p.minute));
  const maxAbs = Math.max(10, ...points.map((p) => Math.abs(p.value)));
  const x = (m: number): number => PADX + (Math.min(m, maxMinute) / maxMinute) * (W - PADX * 2);
  const y = (v: number): number => mid - (v / maxAbs) * (mid - 14);
  const bw = Math.max(1.5, ((W - PADX * 2) / Math.max(1, maxMinute)) * 0.62);
  const goals = showGoals ? incidents.filter((i) => i.kind === "goal") : [];
  const cards = showCards ? incidents.filter((i) => i.kind === "yellow" || i.kind === "red") : [];
  const toggle = (on: boolean) =>
    `rounded-full border px-2 py-0.5 text-[11px] transition ${on ? "border-neutral-600 text-neutral-200" : "text-neutral-600 line-through"}`;
  if (points.length === 0) return null;
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="font-medium text-neutral-400">Momentum</span>
        <button type="button" onClick={() => setShowHome((v) => !v)} className={toggle(showHome)} title="Série da casa">
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-sky-500" />
          {home}
        </button>
        <button type="button" onClick={() => setShowAway((v) => !v)} className={toggle(showAway)} title="Série de fora">
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-orange-500" />
          {away}
        </button>
        <button type="button" onClick={() => setShowGoals((v) => !v)} className={toggle(showGoals)} title="Marcadores de golo">
          ⚽ Golos
        </button>
        <button type="button" onClick={() => setShowCards((v) => !v)} className={toggle(showCards)} title="Marcadores de cartão">
          🟨 Cartões
        </button>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Momentum de ${home} contra ${away}`}>
        <line x1={PADX} x2={W - PADX} y1={mid} y2={mid} stroke="#3f3f46" strokeWidth="1" />
        {[15, 30, 45, 60, 75, 90]
          .filter((t) => t <= maxMinute)
          .map((t) => (
            <text key={t} x={x(t)} y={H - 4} textAnchor="middle" fontSize="9" fill="#71717a">
              {t === 45 ? "45'+1" : t}
            </text>
          ))}
        {shown.map((p, i) => {
          const up = p.value >= 0;
          const top = up ? y(p.value) : mid;
          const h = Math.max(1, Math.abs(y(p.value) - mid));
          return <rect key={i} x={x(p.minute) - bw / 2} y={top} width={bw} height={h} rx="1" fill={up ? "#38bdf8" : "#fb923c"} opacity="0.85" />;
        })}
        {goals.map((g, i) => (
          <g key={`g${i}`}>
            <title>{`${g.minute}' — ${g.text}`}</title>
            <text x={x(g.minute)} y={g.home ? 14 : H - 18} textAnchor="middle" fontSize="11">
              ⚽
            </text>
          </g>
        ))}
        {cards.map((c, i) => (
          <g key={`c${i}`}>
            <title>{`${c.minute}' — ${c.text}`}</title>
            <text x={x(c.minute)} y={c.home ? 28 : H - 32} textAnchor="middle" fontSize="11">
              {c.kind === "red" ? "🟥" : "🟨"}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function Lances({ incidents }: { incidents: GameIncident[] }) {
  const rows = incidents.filter((i) => i.kind === "goal" || i.kind === "yellow" || i.kind === "red").slice().reverse();
  if (rows.length === 0) return null;
  const second = rows.filter((r) => r.minute > 45);
  const first = rows.filter((r) => r.minute <= 45);
  const row = (r: GameIncident, i: number) => (
    <div key={`${r.minute}-${i}`} className={`flex items-center gap-2 px-3 py-1.5 text-xs ${r.kind === "goal" ? "bg-emerald-500/10" : ""}`}>
      <span className="w-10 shrink-0 tabular-nums text-neutral-500">{r.minute}&apos;</span>
      <span aria-hidden>{r.kind === "goal" ? "⚽" : r.kind === "red" ? "🟥" : "🟨"}</span>
      <span className="min-w-0 flex-1 truncate text-neutral-200">{r.text}</span>
    </div>
  );
  return (
    <div className="mt-2 overflow-hidden rounded-lg bg-neutral-900">
      <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Lances do jogo</p>
      <div className="divide-y divide-neutral-800/60">
        {second.map(row)}
        {second.length > 0 && first.length > 0 && (
          <p className="bg-neutral-800/50 px-3 py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            Intervalo
          </p>
        )}
        {first.map(row)}
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
  const [incidents, setIncidents] = useState<GameIncident[]>([]);
  const [yellows, setYellows] = useState<StatVals>({ home: null, away: null });

  useEffect(() => {
    let stop = false;
    const poll = async (): Promise<void> => {
      const [statBody, graphBody, eventBody, incBody] = await Promise.all([
        readJson(`/api/sofascore/statistics?id=${eventId}`),
        readJson(`/api/sofascore/graph?id=${eventId}`),
        readJson(`/api/sofascore/event?id=${eventId}&light=1`),
        readJson(`/api/sofascore/incidents?id=${eventId}`),
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
          state?: { yellows?: { home?: unknown; away?: unknown } };
        } | null
      )?.state;
      const yh = st?.yellows && typeof st.yellows.home === "number" ? st.yellows.home : null;
      const ya = st?.yellows && typeof st.yellows.away === "number" ? st.yellows.away : null;
      setYellows({ home: yh, away: ya });
      const inc = (incBody as { incidents?: GameIncident[] } | null)?.incidents;
      if (Array.isArray(inc)) setIncidents(inc);
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
  const pair = (s: StatVals): string => `${s.home ?? 0}–${s.away ?? 0}`;
  const shots = stats["Remates"] ?? { home: null, away: null };
  const corners = stats["Cantos"] ?? { home: null, away: null };
  const fouls = stats["Faltas"] ?? { home: null, away: null };

  return (
    <div className="mt-3 border-t border-neutral-800 pt-2">
      <MomentumBars points={momentum} incidents={incidents} home={homeName} away={awayName} />
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
        <span className="rounded-full border border-neutral-800 px-2 py-0.5 tabular-nums text-neutral-300" title="Remates casa–fora">
          ⚽ {pair(shots)}
        </span>
        <span className="rounded-full border border-neutral-800 px-2 py-0.5 tabular-nums text-neutral-300" title="Cantos casa–fora">
          ⛳ {pair(corners)}
        </span>
        <span className="rounded-full border border-neutral-800 px-2 py-0.5 tabular-nums text-neutral-300" title="Amarelos casa–fora">
          🟨 {pair(yellows)}
        </span>
        <span className="rounded-full border border-neutral-800 px-2 py-0.5 tabular-nums text-neutral-300" title="Faltas casa–fora">
          ⛔ {pair(fouls)}
        </span>
      </div>
      <Lances incidents={incidents} />
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
