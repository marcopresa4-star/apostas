"use client";

import { useEffect, useMemo, useState } from "react";
import type { MomentumPoint } from "./SofaScoreWidget";
import { parseStatRows } from "./LiveEvolutionChart";
import type { GameIncident } from "@/app/api/sofascore/incidents/route";
import { l15Reading, modelNext15, pressureSummary, type PressureShot, type PressureSummary } from "@/lib/livePressure";

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
  shots,
  home,
  away,
}: {
  points: MomentumPoint[];
  incidents: GameIncident[];
  shots: PressureShot[];
  home: string;
  away: string;
}) {
  const [showHome, setShowHome] = useState(true);
  const [showAway, setShowAway] = useState(true);
  const [showGoals, setShowGoals] = useState(true);
  const [showCards, setShowCards] = useState(true);
  const [showShots, setShowShots] = useState(true);
  const W = 640;
  const H = 168;
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
  // Shots without a goal marker: each is a dot on its side's strip, the dot
  // grows with the chance's xG (plain small dot where the shotmap has none).
  const shotDots = showShots ? shots.filter((s) => !s.goal) : [];
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
        {shots.some((s) => !s.goal) && (
          <button type="button" onClick={() => setShowShots((v) => !v)} className={toggle(showShots)} title="Remates no minuto em que aconteceram">
            • Remates
          </button>
        )}
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
        {shotDots.map((s, i) => {
          const r = s.xg === null ? 1.8 : Math.min(4.2, 2 + s.xg * 5);
          return (
            <circle
              key={`s${i}`}
              cx={x(s.minute)}
              cy={s.home ? 8 : H - 8}
              r={r}
              fill={s.home ? "#38bdf8" : "#fb923c"}
              opacity="0.9"
            >
              <title>{`${s.minute}' — remate de ${s.home ? home : away}${s.xg !== null ? ` · xG ${s.xg.toFixed(2).replace(".", ",")}` : ""}`}</title>
            </circle>
          );
        })}
        {goals.map((g, i) => (
          <g key={`g${i}`}>
            <title>{`${g.minute}' — ${g.text}`}</title>
            <text x={x(g.minute)} y={g.home ? 20 : H - 20} textAnchor="middle" fontSize="11">
              ⚽
            </text>
          </g>
        ))}
        {cards.map((c, i) => (
          <g key={`c${i}`}>
            <title>{`${c.minute}' — ${c.text}`}</title>
            <text x={x(c.minute)} y={c.home ? 32 : H - 32} textAnchor="middle" fontSize="11">
              {c.kind === "red" ? "🟥" : "🟨"}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// xG / L15 / L15' above the chart: the numbers the CornerPro mock shows, from
// the game's own shotmap (our definitions, see livePressure.ts). One row per
// metric; a metric with no data on either side is not rendered (silence, not
// zeros). xG is SofaScore's, not CornerPro's proprietary split.
function PressureValues({ p, home, away, finished }: { p: PressureSummary; home: string; away: string; finished: boolean }) {
  const fmt = (v: number | null): string => (v === null ? "—" : v.toFixed(2).replace(".", ","));
  const rows = [
    { label: "xG", title: "Golos esperados acumulados (shotmap do SofaScore)", home: p.home.xg, away: p.away.xg },
    { label: "L15", title: "Últimos 15': xG criado (remates quando a competição não tem xG)", home: p.home.l15, away: p.away.l15 },
    {
      label: "L15'",
      title: p.hasXg
        ? p.l15pSource === "model"
          ? "Próximos 15': xG esperado pelo modelo live (pré-jogo, resultado, vermelhos e xG)"
          : "Próximos 15': xG esperado pelo ritmo recente"
        : "Próximos 15': remates esperados pelo ritmo recente (sem xG nesta competição)",
      home: p.home.l15p,
      away: p.away.l15p,
      // Says where the number comes from, so the reader knows whether it is
      // the model or the fallback without opening the tooltip.
      source: p.l15pSource,
    },
  ].filter((r) => r.home !== null || r.away !== null);
  if (rows.length === 0) return null;
  // The open/one-way reading is calibrated in xG-per-15'; without xG the
  // fallback counts shots, so the same thresholds would always read "open".
  const reading = finished || !p.hasXg ? null : l15Reading(p.home.l15p, p.away.l15p, home, away);
  return (
    <div className="mb-2 rounded-lg bg-neutral-900 px-3 py-2">
      <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-3 gap-y-1 text-xs">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{p.hasXg ? "xG · L15" : "L15 · remates"}</span>
        <span className="text-right text-[10px] font-semibold uppercase tracking-wide text-sky-300/80">{home}</span>
        <span className="text-right text-[10px] font-semibold uppercase tracking-wide text-orange-300/80">{away}</span>
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <span className="font-medium text-neutral-500" title={r.title}>
              {r.label}
              {"source" in r && r.source && (
                <span
                  className={`ml-1 inline-block rounded px-1 py-px align-middle text-[9px] font-semibold uppercase tracking-wide ${
                    r.source === "model" ? "bg-sky-500/10 text-sky-300/90" : "bg-neutral-800 text-neutral-400"
                  }`}
                >
                  {r.source === "model" ? "modelo" : "ritmo"}
                </span>
              )}
            </span>
            <span className="text-right font-semibold tabular-nums text-sky-300">{fmt(r.home)}</span>
            <span className="text-right font-semibold tabular-nums text-orange-300">{fmt(r.away)}</span>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-neutral-600">
        {p.hasXg
          ? `L15 = xG dos últimos 15' · remates ${p.home.shots15}–${p.away.shots15}.`
          : `Sem xG nesta competição: L15 conta os remates dos últimos 15' (${p.home.shots15}–${p.away.shots15}).`}{" "}
        {finished
          ? "Jogo terminado: L15' não se aplica."
          : !p.hasXg
            ? "L15' = ritmo recente de remates (sem xG nesta competição)."
            : p.l15pSource === "model"
              ? "L15' = modelo live (pré-jogo, resultado, vermelhos, xG)"
              : "L15' = ritmo recente de xG"}
        {reading ? ` — ${reading}.` : finished ? "" : "."}
      </p>
    </div>
  );
}

// Score / possession / reds alongside the xG panel: the context that explains
// why L15' reads the way it does. L15 stays pure shotmap; score and reds reach
// L15' through modelNext15 (a separate input), not through this display line.
function MatchContext({
  score,
  reds,
  possession,
}: {
  score: { home: number | null; away: number | null };
  reds: { home: number; away: number };
  possession: StatVals;
}) {
  const hasScore = score.home !== null || score.away !== null;
  const hasPossession = possession.home !== null || possession.away !== null;
  const hasReds = reds.home > 0 || reds.away > 0;
  if (!hasScore && !hasPossession && !hasReds) return null;
  const pill = "rounded-full border border-white/[0.07] px-2 py-0.5 tabular-nums text-neutral-300";
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px]">
      {hasScore && (
        <span className={pill} title="Resultado atual">
          Resultado <b className="text-neutral-100">{score.home ?? "—"}–{score.away ?? "—"}</b>
        </span>
      )}
      {hasPossession && (
        <span className={pill} title="Posse de bola casa–fora">
          Posse <b className="text-neutral-100">{fmt(possession.home, true)}–{fmt(possession.away, true)}</b>
        </span>
      )}
      <span className={pill} title="Cartões vermelhos casa–fora">
        🟥 <b className="text-neutral-100">{reds.home}–{reds.away}</b>
      </span>
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
      <div className="divide-y divide-white/[0.05]">
        {second.map(row)}
        {second.length > 0 && first.length > 0 && (
          <p className="bg-white/[0.05] px-3 py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
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
  // Shotmap: xG per shot, the source of xG / L15 above the chart.
  const [shots, setShots] = useState<PressureShot[]>([]);
  const [minute, setMinute] = useState<number | null>(null);
  // Live context for the model: score and reds from the event, pre-match
  // lambdas from the app's model. None of this feeds L15 (pure shotmap).
  const [score, setScore] = useState<{ home: number | null; away: number | null }>({ home: null, away: null });
  const [reds, setReds] = useState<{ home: number; away: number }>({ home: 0, away: 0 });
  const [prematch, setPrematch] = useState<{ home: number; away: number; firstHalfShare: number } | null>(null);
  // Final whistle: L15' is a projection, so it stops making sense here.
  const [finished, setFinished] = useState(false);

  // Pre-match expectation does not change during the game: one read per event.
  // Failure (scraper offline, unmapped data) leaves L15' on the rate fallback.
  useEffect(() => {
    let stop = false;
    setPrematch(null);
    void readJson(`/api/sofascore/prematch?id=${eventId}`).then((body) => {
      if (stop) return;
      const p = body as { home?: unknown; away?: unknown; firstHalfShare?: unknown; fromModel?: unknown } | null;
      // Only a real model prior feeds L15'. The route falls back to typical
      // figures for unmapped leagues and flags them fromModel=false: using
      // those would be inventing a pre-match read, so the rate fallback wins.
      if (
        p?.fromModel === true &&
        typeof p.home === "number" &&
        typeof p.away === "number" &&
        typeof p.firstHalfShare === "number"
      ) {
        setPrematch({ home: p.home, away: p.away, firstHalfShare: p.firstHalfShare });
      }
    });
    return () => {
      stop = true;
    };
  }, [eventId]);

  useEffect(() => {
    let stop = false;
    // New pinned game: never show the previous game's readings while the
    // first poll is in flight.
    setStats({});
    setMomentum([]);
    setIncidents([]);
    setYellows({ home: null, away: null });
    setShots([]);
    setMinute(null);
    setScore({ home: null, away: null });
    setReds({ home: 0, away: 0 });
    setFinished(false);
    const poll = async (): Promise<void> => {
      const [statBody, graphBody, eventBody, incBody, shotBody] = await Promise.all([
        readJson(`/api/sofascore/statistics?id=${eventId}`),
        readJson(`/api/sofascore/graph?id=${eventId}`),
        readJson(`/api/sofascore/event?id=${eventId}&light=1`),
        readJson(`/api/sofascore/incidents?id=${eventId}`),
        readJson(`/api/sofascore/shotmap?id=${eventId}`),
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
          state?: {
            yellows?: { home?: unknown; away?: unknown };
            minute?: unknown;
            homeGoals?: unknown;
            awayGoals?: unknown;
            reds?: { home?: unknown; away?: unknown };
            phase?: unknown;
          };
        } | null
      )?.state;
      const yh = st?.yellows && typeof st.yellows.home === "number" ? st.yellows.home : null;
      const ya = st?.yellows && typeof st.yellows.away === "number" ? st.yellows.away : null;
      setYellows({ home: yh, away: ya });
      setMinute(typeof st?.minute === "number" && Number.isFinite(st.minute) ? st.minute : null);
      setScore({
        home: typeof st?.homeGoals === "number" ? st.homeGoals : null,
        away: typeof st?.awayGoals === "number" ? st.awayGoals : null,
      });
      setReds({
        home: st?.reds && typeof st.reds.home === "number" ? st.reds.home : 0,
        away: st?.reds && typeof st.reds.away === "number" ? st.reds.away : 0,
      });
      setFinished(st?.phase === "finished");
      const inc = (incBody as { incidents?: GameIncident[] } | null)?.incidents;
      if (Array.isArray(inc)) setIncidents(inc);
      const shotList = (shotBody as { shots?: PressureShot[] } | null)?.shots;
      if (Array.isArray(shotList)) setShots(shotList);
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
  const shotStats = stats["Remates"] ?? { home: null, away: null };
  const corners = stats["Cantos"] ?? { home: null, away: null };
  const fouls = stats["Faltas"] ?? { home: null, away: null };
  const possession = stats["Posse de bola"] ?? { home: null, away: null };
  const pressure = useMemo(() => {
    const model =
      prematch && minute !== null && score.home !== null && score.away !== null
        ? modelNext15(shots, minute, {
            lambdaHome: prematch.home,
            lambdaAway: prematch.away,
            firstHalfShare: prematch.firstHalfShare,
            homeGoals: score.home,
            awayGoals: score.away,
            redsHome: reds.home,
            redsAway: reds.away,
          })
        : null;
    return pressureSummary(shots, minute, model, finished);
  }, [shots, minute, prematch, score, reds, finished]);

  return (
    <div className="mt-3 border-t border-white/[0.07] pt-2">
      <MatchContext score={score} reds={reds} possession={possession} />
      {pressure && <PressureValues p={pressure} home={homeName} away={awayName} finished={finished} />}
      <MomentumBars points={momentum} incidents={incidents} shots={shots} home={homeName} away={awayName} />
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
        <span className="rounded-full border border-white/[0.07] px-2 py-0.5 tabular-nums text-neutral-300" title="Remates casa–fora">
          🎯 {pair(shotStats)}
        </span>
        <span className="rounded-full border border-white/[0.07] px-2 py-0.5 tabular-nums text-neutral-300" title="Cantos casa–fora">
          ⛳ {pair(corners)}
        </span>
        <span className="rounded-full border border-white/[0.07] px-2 py-0.5 tabular-nums text-neutral-300" title="Amarelos casa–fora">
          🟨 {pair(yellows)}
        </span>
        <span className="rounded-full border border-white/[0.07] px-2 py-0.5 tabular-nums text-neutral-300" title="Faltas casa–fora">
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
