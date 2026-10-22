"use client";

import { useRef, useState } from "react";
import type {
  AvgRule,
  BotMarket,
  BotMode,
  BotPeriod,
  BotStat,
  GoalCmp,
  GoalRules,
  OddRule,
  PregameAvgStat,
  PregameMetric,
  PregameRow,
  PregameSide,
} from "@/lib/bots";
import {
  BOT_MARKETS,
  BOT_SCORES,
  GOAL_CMP_LABELS,
  GOALS_NEUTRAL,
  goalsNeutral,
  PREGAME_AVG_CMP,
  PREGAME_AVG_STATS,
  PREGAME_FAV_STATES,
  PREGAME_METRICS,
  PREGAME_ODD_CMP,
  PREGAME_ODD_WHICH,
} from "@/lib/bots";
import { saveBotAction } from "@/app/(app)/bots/actions";
import type { BotRow } from "@/components/BotsClient";

type PreRuleDraft = PregameRow;

const TEMPLATES: { label: string; fill: () => Partial<Draft> }[] = [
  {
    label: "⚡ Over 2.5 agressivo",
    fill: () => ({ name: "Over25", minute_from: 60, score: "total2plus", market: "mais1", stats: { pressure_recent: 5 } }),
  },
  {
    label: "🚩 Cantos casa pressão",
    fill: () => ({ name: "CantosCasa", minute_from: 30, score: "draw", market: "home", stats: { corners_home: 4, shots_home: 6 } }),
  },
  {
    label: "🥅 Ambas marcam",
    fill: () => ({ name: "BTTS", minute_from: 55, score: "total1", market: "btts", stats: { shots_total: 12 } }),
  },
  {
    label: "🏆 Vitória casa a segurar",
    fill: () => ({ name: "CasaSegura", minute_from: 70, score: "home_ahead", market: "home" }),
  },
];

function Slider({ value, min, max, step, onChange, accent = "emerald" }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; accent?: "emerald" | "sky" | "fuchsia" }) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`w-full ${accent === "emerald" ? "accent-emerald-500" : accent === "sky" ? "accent-sky-500" : "accent-fuchsia-500"}`}
    />
  );
}

function Ticks({ items }: { items: string[] }) {
  return (
    <div className="flex justify-between text-[10px] tabular-nums text-neutral-600">
      {items.map((t) => (
        <span key={t}>{t}</span>
      ))}
    </div>
  );
}

const MIN_MINUTE = 1;
const MAX_MINUTE = 120;

// Dual-thumb minute slider (pointer-drag), like the mock: one track, two
// thumbs, filled span between them. lo/hi clamp to the period chosen.
function RangeDual({
  from,
  to,
  lo = MIN_MINUTE,
  hi = MAX_MINUTE,
  onFrom,
  onTo,
}: {
  from: number;
  to: number;
  lo?: number;
  hi?: number;
  onFrom: (v: number) => void;
  onTo: (v: number) => void;
}) {
  const track = useRef<HTMLDivElement | null>(null);
  const pct = (v: number): string => `${((v - MIN_MINUTE) / (MAX_MINUTE - MIN_MINUTE)) * 100}%`;
  const drag = (kind: "from" | "to") => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: React.PointerEvent<HTMLDivElement>): void => {
      const box = track.current?.getBoundingClientRect();
      if (!box) return;
      const t = Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width));
      const v = Math.round(MIN_MINUTE + t * (MAX_MINUTE - MIN_MINUTE));
      if (kind === "from") onFrom(Math.min(v, to, hi));
      else onTo(Math.max(v, from, lo));
    };
    return move(e);
  };
  return (
    <div className="px-1 py-2">
      <div className="relative h-4" ref={track}>
        <div className="absolute inset-x-0 top-1.5 h-1 rounded-full bg-white/10" />
        <div
          className="absolute top-1.5 h-1 rounded-full bg-sky-400"
          style={{ left: pct(Math.max(from, lo)), width: `calc(${pct(Math.min(to, hi))} - ${pct(Math.max(from, lo))})` }}
        />
        <div
          role="slider"
          aria-label="Do minuto"
          aria-valuenow={from}
          tabIndex={0}
          onPointerDown={drag("from")}
          onPointerMove={(e) => e.buttons === 1 && drag("from")(e)}
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 border-sky-400 bg-white shadow active:scale-110"
          style={{ left: pct(Math.max(from, lo)) }}
        />
        <div
          role="slider"
          aria-label="Até ao minuto"
          aria-valuenow={to}
          tabIndex={0}
          onPointerDown={drag("to")}
          onPointerMove={(e) => e.buttons === 1 && drag("to")(e)}
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 border-sky-400 bg-white shadow active:scale-110"
          style={{ left: pct(Math.min(to, hi)) }}
        />
      </div>
    </div>
  );
}

// Section header of the numbered redesign: chip + title + subtitle.
function Section({ n, title, sub, children }: { n: number; title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-sky-500/40 bg-sky-500/15 text-xs font-bold text-sky-300">
          {n}
        </span>
        <div>
          <p className="text-sm font-semibold text-neutral-100">{title}</p>
          <p className="text-[11px] text-neutral-500">{sub}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

const CMP_FULL: { v: GoalCmp; l: string }[] = [
  { v: "any", l: GOAL_CMP_LABELS.any },
  { v: "lt", l: GOAL_CMP_LABELS.lt },
  { v: "gte", l: GOAL_CMP_LABELS.gte },
];

// Sidebar summary row (the mock's «Resumo»): icon + quiet label + bold value.
function ResumoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="flex min-w-0 items-center gap-2 text-xs text-neutral-400">
        <span aria-hidden>{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 text-right text-xs font-semibold text-neutral-100">{value}</span>
    </div>
  );
}
const CMP_HALF: { v: GoalCmp; l: string }[] = [
  { v: "any", l: GOAL_CMP_LABELS.any },
  { v: "exact", l: GOAL_CMP_LABELS.exact },
  { v: "lt", l: GOAL_CMP_LABELS.lt },
  { v: "gte", l: GOAL_CMP_LABELS.gte },
];

const PRE_LABELS: Record<PregameMetric, string> = {
  total_over15: "Over 1.5 — jogo",
  total_over25: "Over 2.5 — jogo",
  btts: "Ambas marcam",
  sh_over05: "Over 0.5 — 2ª parte",
  sh_over15: "Over 1.5 — 2ª parte",
  fh_over05: "Over 0.5 — 1ª parte",
  fh_over15: "Over 1.5 — 1ª parte",
};

// One-line description for the sidebar's «Antes do jogo» row.
const preRuleLabel = (r: PreRuleDraft): string => {
  if (r.kind === "avg") {
    const label = PREGAME_AVG_STATS.find((m) => m.key === r.metric)?.label ?? r.metric;
    return `${label.replace("Média de ", "")} ${r.cmp === "gte" ? "≥" : "≤"} ${r.v}`;
  }
  if (r.kind === "odd") return "Odd pré-jogo";
  return `${PRE_LABELS[r.metric]} ≥ ${r.pct ?? 60}%`;
};

const PRE_SIDES: { v: PregameSide; l: string }[] = [
  { v: "home", l: "Casa" },
  { v: "away", l: "Fora" },
  { v: "either", l: "Ambas" },
];

// PT-PT decimals with a comma for the new cards' numeric readouts.
const fmtPre = (v: number): string => String(v).replace(".", ",");

// «Ao vivo» (secção 4): row defs per the mock. `sides` rows fold the old
// casa/fora pairs into one row with Casa/Fora pills; `windows` rows pick the
// pressure window. Hidden legacy keys keep firing without showing here.
interface LiveRowDef {
  id: string;
  label: string;
  homeKey?: string;
  awayKey?: string;
  def: number;
  unit?: string;
  sides?: boolean;
  windows?: true;
}

const LIVE_ROWS: LiveRowDef[] = [
  { id: "shots_total", label: "Remates totais", homeKey: "shots_total", awayKey: "shots_total", def: 4 },
  { id: "sot", label: "Remates à baliza", homeKey: "sot_total", awayKey: "sot_total", def: 3 },
  { id: "shots_off", label: "Remates para fora", homeKey: "shots_off_total", awayKey: "shots_off_total", def: 3 },
  { id: "shots_blocked", label: "Remates bloqueados", homeKey: "shots_blocked_total", awayKey: "shots_blocked_total", def: 2 },
  { id: "corners_total", label: "Cantos (total)", homeKey: "corners_total", awayKey: "corners_total", def: 3 },
  { id: "corners_team", label: "Cantos de uma equipa", homeKey: "corners_home", awayKey: "corners_away", def: 2, sides: true },
  { id: "poss_team", label: "Posse de uma equipa", homeKey: "poss_home", awayKey: "poss_away", def: 55, unit: "%", sides: true },
  { id: "goals_team", label: "Golos de uma equipa", homeKey: "goals_home", awayKey: "goals_away", def: 2, sides: true },
  { id: "offsides", label: "Foras de jogo", homeKey: "offsides_total", awayKey: "offsides_total", def: 2 },
  { id: "pressure_all", label: "Pressão no jogo todo", homeKey: "pressure_total", awayKey: "pressure_total", def: 10 },
  { id: "pressure_recent", label: "Pressão recente", def: 6, windows: true },
  { id: "yellows", label: "Amarelos (total)", homeKey: "yellows_total", awayKey: "yellows_total", def: 3 },
  { id: "reds", label: "Vermelhos (total)", homeKey: "reds_total", awayKey: "reds_total", def: 1 },
  { id: "fouls", label: "Faltas (total)", homeKey: "fouls_total", awayKey: "fouls_total", def: 15 },
  { id: "saves", label: "Defesas dos GR", homeKey: "saves_total", awayKey: "saves_total", def: 3 },
];

const LIVE_GROUPS: { name: string; rows: LiveRowDef[] }[] = [
  {
    name: "Remates",
    rows: LIVE_ROWS.filter((r) => ["shots_total", "sot", "shots_off", "shots_blocked"].includes(r.id)),
  },
  {
    name: "Cantos, posse e golos",
    rows: LIVE_ROWS.filter((r) => ["corners_total", "corners_team", "poss_team", "goals_team", "offsides"].includes(r.id)),
  },
  {
    name: "Pressão (remates + cantos)",
    rows: LIVE_ROWS.filter((r) => ["pressure_all", "pressure_recent"].includes(r.id)),
  },
  {
    name: "Disciplina e guarda-redes",
    rows: LIVE_ROWS.filter((r) => ["yellows", "reds", "fouls", "saves"].includes(r.id)),
  },
];

interface Draft {
  name: string;  silent: boolean;
  leagues: string[];
  mode: BotMode;
  minute_from: number;
  minute_to: number;
  period: BotPeriod;
  score: string;
  goals: GoalRules;
  market: BotMarket;
  min_odd: number;
  stats: Record<string, number>;
  // Which Casa/Fora side the team rows point at; pressure window per row.
  statSides: Record<string, "home" | "away">;
  statWindows: Record<string, number>;
  preRules: PreRuleDraft[];
  refire: boolean;
}

const fromRow = (b: BotRow): Draft => {
  const stats: Record<string, number> = Object.fromEntries(b.stats.map((s) => [s.k, s.v]));
  return {
    name: b.name,
    silent: b.silent,
    leagues: b.leagues,
    mode: b.mode,
    minute_from: b.minute_from,
    minute_to: b.minute_to,
    period: b.period,
    score: b.score,
    goals: goalsNeutral(b.goals),
    market: b.market,
    min_odd: b.min_odd !== null ? Math.min(6, b.min_odd) : 1,
    stats,
    statSides: {
      corners_team: "corners_away" in stats ? "away" : "home",
      poss_team: "poss_away" in stats ? "away" : "home",
      goals_team: "goals_away" in stats ? "away" : "home",
    },
    statWindows: { pressure_recent: "pressure_recent15" in stats ? 15 : "pressure_recent5" in stats ? 5 : 10 },
    preRules: b.pregame.map((r) =>
      r.kind === "avg" || r.kind === "odd"
        ? r
        : { side: r.side, n: r.n === 5 || r.n === 20 ? r.n : 10, metric: r.metric, pct: r.pct ?? 60 }
    ),
    refire: b.refire,
  } satisfies Draft;
};

const blank: Draft = {
  name: "",
  silent: false,
  leagues: [],
  mode: "and",
  minute_from: 30,
  minute_to: 90,
  period: "any",
  score: "any",
  // mock defaults pre-seeded, so switching a filter off «Qualquer» shows 3/3/1/0
  goals: { ...GOALS_NEUTRAL, totalV: 3, diffV: 3, fhV: 1 },
  market: "mais1",
  min_odd: 1,
  stats: {},
  statSides: {},
  statWindows: { pressure_recent: 10 },
  preRules: [],
  refire: false,
};

export default function BotForm({
  leagues,
  initial,
  onClose,
}: {
  leagues: { code: string; label: string }[];
  initial: BotRow | null;
  onClose: () => void;
}) {
  const [d, setD] = useState<Draft>(initial ? fromRow(initial) : blank);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<{ tested: number; passed: number } | null>(null);
  const [testing, setTesting] = useState(false);
  const [leaguesOpen, setLeaguesOpen] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]): void => {
    setD((prev) => ({ ...prev, [k]: v }));
    setError(null);
  };

  // «Antes do jogo»: edit one criteria card, remove it, or append a new tile.
  const setRule = (i: number, patch: Partial<PregameRow>): void => {
    setD((prev) => ({ ...prev, preRules: prev.preRules.map((r, j) => (j === i ? ({ ...r, ...patch } as PregameRow) : r)) }));
  };
  const removeRule = (i: number): void => {
    setD((prev) => ({ ...prev, preRules: prev.preRules.filter((_, j) => j !== i) }));
  };
  const addRule = (kind: "hist" | "avg" | "odd"): void => {
    setD((prev) => ({
      ...prev,
      preRules:
        kind === "avg"
          ? [...prev.preRules, { kind: "avg", side: "either", metric: "corners_total", n: 10, cmp: "gte", v: 10 } satisfies AvgRule]
          : kind === "odd"
            ? [...prev.preRules, { kind: "odd", which: "fav", cmp: "lte", v: 1.6, favState: "any" } satisfies OddRule]
            : [...prev.preRules, { side: "either", n: 10, metric: "total_over15", pct: 60 }],
    }));
  };

  // «Ao vivo» (secção 4): key a row points at, on/off, side and window edits.
  const liveKey = (row: LiveRowDef, sides: Record<string, "home" | "away">, windows: Record<string, number>): string => {
    if (row.windows) return `pressure_recent${windows[row.id] ?? 10}`;
    return (sides[row.id] ?? "home") === "away" ? (row.awayKey ?? "") : (row.homeKey ?? "");
  };

  const toggleRow = (row: LiveRowDef): void => {
    setD((prev) => {
      const key = liveKey(row, prev.statSides, prev.statWindows);
      const stats = { ...prev.stats };
      if (key in stats) delete stats[key];
      else stats[key] = row.def;
      return { ...prev, stats };
    });
  };

  const setRowSide = (row: LiveRowDef, side: "home" | "away"): void => {
    setD((prev) => {
      const prevKey = liveKey(row, prev.statSides, prev.statWindows);
      const sides = { ...prev.statSides, [row.id]: side };
      const stats = { ...prev.stats };
      const newKey = liveKey(row, sides, prev.statWindows);
      if (prevKey !== newKey && prevKey in stats && row.homeKey !== row.awayKey) {
        stats[newKey] = stats[prevKey];
        delete stats[prevKey];
      }
      return { ...prev, statSides: sides, stats };
    });
  };

  const setRowWindow = (row: LiveRowDef, w: number): void => {
    setD((prev) => {
      const prevKey = liveKey(row, prev.statSides, prev.statWindows);
      const windows = { ...prev.statWindows, [row.id]: w };
      const stats = { ...prev.stats };
      const newKey = liveKey(row, prev.statSides, windows);
      if (prevKey !== newKey && prevKey in stats) {
        stats[newKey] = stats[prevKey];
        delete stats[prevKey];
      }
      return { ...prev, statWindows: windows, stats };
    });
  };

  const runBacktest = async (): Promise<void> => {
    setTesting(true);
    setTest(null);
    try {
      const res = await fetch("/api/bots/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leagues: d.leagues.length > 0 ? d.leagues : leagues.map((l) => l.code),
          period: d.period,
          minute_to: d.minute_to,
          score: d.score,
          pregame: d.preRules.flatMap((r) => (r.kind === "avg" || r.kind === "odd" ? [] : [{ side: r.side, n: r.n ?? 10, metric: r.metric, pct: r.pct ?? 60 }])),
        }),
      });
      const body = (await res.json()) as { tested?: number; passed?: number };
      if (typeof body.tested === "number" && typeof body.passed === "number") setTest({ tested: body.tested, passed: body.passed });
    } catch {
      // keeps the form usable
    } finally {
      setTesting(false);
    }
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    const stats: BotStat[] = Object.entries(d.stats).map(([k, v]) => ({ k, v: Number(v) || 0 }));
    const input = {
      name: d.name,
      silent: d.silent,
      leagues: d.leagues,
      mode: d.mode,
      minute_from: d.minute_from,
      minute_to: d.minute_to,
      period: d.period,
      score: d.score,
      market: d.market,
      min_prob: null,
      min_odd: d.min_odd > 1 ? Math.round(d.min_odd * 100) / 100 : null,
      stats,
      pregame: d.preRules,
      goals: d.goals,
      refire: d.refire,
      enabled: initial?.enabled ?? true,
    };
    const r = await saveBotAction(initial?.id ?? null, input as unknown as Record<string, unknown>);
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onClose();
  };

  const field = "w-full rounded-lg border border-white/[0.09] bg-white/[0.03] px-3 py-2 text-neutral-100 outline-none focus:border-emerald-500";
  const pill = (on: boolean) =>
    `inline-flex cursor-pointer items-center rounded-full border px-3 py-1.5 text-xs font-medium transition ${on ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300" : "border-white/[0.07] text-neutral-400 hover:border-white/[0.15] hover:text-neutral-200"}`;
  // Section 1 ("Onde e quando") uses the mock's sky accent.
  const pillSky = (on: boolean) =>
    `inline-flex cursor-pointer items-center rounded-full border px-3 py-1.5 text-xs font-medium transition ${on ? "border-sky-500/50 bg-sky-500/15 text-sky-300" : "border-white/[0.07] text-neutral-400 hover:border-white/[0.15] hover:text-neutral-200"}`;
  // «Odd pré-jogo» cards use the mock's pink accent.
  const pillPink = (on: boolean) =>
    `inline-flex cursor-pointer items-center rounded-full border px-3 py-1.5 text-xs font-medium transition ${on ? "border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-300" : "border-white/[0.07] text-neutral-400 hover:border-white/[0.15] hover:text-neutral-200"}`;
  // «Ao vivo» (secção 4) uses the mock's violet accent.
  const pillViolet = (on: boolean) =>
    `inline-flex cursor-pointer items-center rounded-full border px-3 py-1.5 text-xs font-medium transition ${on ? "border-violet-500/60 bg-violet-500/15 text-violet-300" : "border-white/[0.07] text-neutral-400 hover:border-white/[0.15] hover:text-neutral-200"}`;
  const marketLabel = BOT_MARKETS.find((m) => m.key === d.market)?.label ?? d.market;
  const scoreLabel = BOT_SCORES.find((s) => s.key === d.score)?.label ?? d.score;
  // Resumo values (sidebar).
  const resumoCompeticoes =
    d.leagues.length === 0
      ? "Todas as ligas"
      : d.leagues.length === 1
        ? leagues.find((l) => l.code === d.leagues[0])?.label ?? d.leagues[0]
        : `${d.leagues.length} ligas`;
  // Visible «Ao vivo» rows that are on (hidden legacy keys don't count).
  const nStats = LIVE_ROWS.filter((r) => liveKey(r, d.statSides, d.statWindows) in d.stats).length + Object.keys(d.stats).filter((k) => !LIVE_ROWS.some((r) => [r.homeKey, r.awayKey].includes(k))).length;
  const resumoAoVivo =
    nStats === 0 ? "Só minuto e marcador" : nStats === 1 ? "1 gatilho" : `${nStats} gatilhos`;

  // «Antes do jogo» summary: single criterion described, several counted.
  const preResumo =
    d.preRules.length === 0
      ? "Sem filtro"
      : d.preRules.length === 1
        ? preRuleLabel(d.preRules[0])
        : `${d.preRules.length} critérios`;

  // Period bounds the slider so the window can't point to a half the bot
  // can't see: 1.ª parte → até 44', 2.ª parte → a partir de 45', intervalo → 45'.
  const setPeriod = (v: Draft["period"]): void =>
    setD((prev) => {
      let { minute_from: f, minute_to: t } = prev;
      if (v === "first") {
        f = Math.min(f, 44);
        t = Math.min(t, 44);
      } else if (v === "second") {
        f = Math.max(f, 45);
        t = Math.max(t, 45);
      } else if (v === "half") {
        f = 45;
        t = 45;
      }
      return { ...prev, period: v, minute_from: f, minute_to: t };
    });
  const sliderLo = d.period === "second" || d.period === "half" ? 45 : MIN_MINUTE;
  const sliderHi = d.period === "first" || d.period === "half" ? 45 : MAX_MINUTE;

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-black/70 p-4" onClick={onClose}>
      <div
        className="mx-auto my-6 max-w-6xl space-y-4 glass p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-neutral-100">🤖 {initial ? "Editar bot" : "Criar novo bot"}</h2>
            <p className="text-xs text-neutral-500">
              Define o mercado, quando vigiar e o que tem de acontecer. O servidor verifica todos os minutos.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-xl text-neutral-400 hover:bg-white/[0.06]" aria-label="Fechar">
            ✕
          </button>
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
        {/* ——— Secção 1 · Bot e mercado ——— */}
        <Section n={1} title="Bot e mercado" sub="O nome, o que queres que o bot te diga para apostar e a odd mínima">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Começar de um modelo <span className="normal-case tracking-normal text-neutral-500">opcional</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map((t) => (
                <button key={t.label} type="button" onClick={() => setD((prev) => ({ ...blank, ...t.fill(), stats: { ...(t.fill().stats ?? {}) } }))} className={pill(false)}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Nome do bot</p>
            <input value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="ex: BotOverHT, CantosAlert" maxLength={40} className={field} />
            <p className="mt-1 text-[11px] text-neutral-500">Aparece nos alertas: “ALERTA {d.name || "BotOverHT"} — …”</p>
          </div>

        <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
          <input type="checkbox" checked={d.silent} onChange={(e) => set("silent", e.target.checked)} className="mt-1 accent-emerald-500" />
          <span className="text-xs text-neutral-300">
            <span className="font-semibold">Modo silencioso</span> — regista o alerta e mostra na lista, mas não envia
            notificação. Útil para testar um bot novo sem spam.
          </span>
        </label>

          <div className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
            <p className="mb-2 text-sm font-medium text-neutral-200">🎯 Mercado a alertar</p>
            <select value={d.market} onChange={(e) => set("market", e.target.value as BotMarket)} className={field}>
              {BOT_MARKETS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3 space-y-2 rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-neutral-200">🎲 Odd mínima ao vivo</p>
              <span className="text-base font-bold tabular-nums text-amber-300">{d.min_odd.toFixed(2)}</span>
            </div>
            <p className="text-xs text-neutral-400">Só alerta se a odd estiver acima de</p>
            <Slider value={d.min_odd} min={1} max={6} step={0.05} onChange={(v) => set("min_odd", Math.round(v * 100) / 100)} />
            <Ticks items={["1.00", "2.00", "3.00", "4.00", "6.00"]} />
            <p className="text-[11px] leading-relaxed text-neutral-500">
              Compara com a odd ao vivo do mercado escolhido acima. Se a API não tiver odds disponíveis para esse
              mercado nesse instante, esta condição é ignorada só nesse disparo (não bloqueia as restantes).
            </p>
            <p className="text-[11px] text-neutral-500">Útil para filtrar mercados com odds muito baixas ao vivo que não têm valor real.</p>
            {d.min_odd <= 1 && (
              <p className="text-[11px] text-neutral-500">Em 1,00 a condição fica neutra: qualquer odd conta.</p>
            )}
          </div>

        </Section>

        {/* ——— Secção 2 · Onde e quando ——— */}
        <Section n={2} title="Onde e quando" sub="Competições, minutos, período e marcador em que o bot vigia os jogos">
          {/* Competições: dropdown estilo mock */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setLeaguesOpen((o) => !o)}
              className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-white/[0.09] bg-white/[0.03] px-3 py-2 text-left text-sm text-neutral-100 outline-none hover:border-white/[0.18]"
            >
              <span>
                🏆{" "}
                {d.leagues.length === 0 ? (
                  <span className="text-neutral-300">Todas as ligas ({leagues.length})</span>
                ) : (
                  <>
                    <span className="text-sky-300">{d.leagues.length}</span>
                    <span className="text-neutral-300"> liga{d.leagues.length > 1 ? "s" : ""} escolhida{d.leagues.length > 1 ? "s" : ""}</span>
                    <span className="text-neutral-500"> · {d.leagues.map((c) => leagues.find((l) => l.code === c)?.label ?? c).slice(0, 2).join(", ")}{d.leagues.length > 2 ? "…" : ""}</span>
                  </>
                )}
              </span>
              <span className={`text-neutral-500 transition ${leaguesOpen ? "rotate-180" : ""}`}>▾</span>
            </button>
            {leaguesOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setLeaguesOpen(false)} />
                <div className="absolute z-30 mt-1 max-h-56 w-full space-y-0.5 overflow-y-auto rounded-xl border border-white/10 bg-neutral-900 p-1.5 shadow-2xl">
                  {leagues.map((l) => {
                    const on = d.leagues.includes(l.code);
                    return (
                      <button
                        key={l.code}
                        type="button"
                        onClick={() => set("leagues", on ? d.leagues.filter((x) => x !== l.code) : [...d.leagues, l.code])}
                        className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${on ? "bg-sky-500/15 text-sky-200" : "text-neutral-300 hover:bg-white/[0.05]"}`}
                      >
                        <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] ${on ? "border-sky-400 bg-sky-500/30 text-sky-200" : "border-white/[0.15]"}`}>{on ? "✓" : ""}</span>
                        {l.label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <p className="mt-1 text-[11px] text-neutral-500">Nada escolhido = todas as ligas mapeadas vigiam.</p>
          </div>

          {/* Período + minuto dual-slider */}
          <div>
            <p className="mb-1.5 text-xs text-neutral-400">Período</p>
            <div className="flex flex-wrap gap-1.5">
              {[
                { v: "any", l: "Qualquer" },
                { v: "first", l: "1ª Parte" },
                { v: "half", l: "Intervalo" },
                { v: "second", l: "2ª Parte" },
              ].map((p) => (
                <button key={p.v} type="button" onClick={() => setPeriod(p.v as Draft["period"])} className={pillSky(d.period === p.v)}>
                  {p.l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 grid grid-cols-3 items-center gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-neutral-500">Do minuto</p>
                <p className="text-lg font-bold tabular-nums leading-tight text-sky-300">{d.minute_from}&apos;</p>
              </div>
              <div className="justify-self-center rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 text-[11px] font-medium tabular-nums text-sky-300">
                {Math.max(0, d.minute_to - d.minute_from)} min
              </div>
              <div className="justify-self-end text-right">
                <p className="text-[10px] uppercase tracking-wide text-neutral-500">Ao minuto</p>
                <p className="text-lg font-bold tabular-nums leading-tight text-sky-300">{d.minute_to}&apos;</p>
              </div>
            </div>
            <RangeDual
              from={d.minute_from}
              to={d.minute_to}
              lo={sliderLo}
              hi={sliderHi}
              onFrom={(v) => set("minute_from", Math.min(v, d.minute_to))}
              onTo={(v) => set("minute_to", Math.max(v, d.minute_from))}
            />
            <Ticks items={["1'", "45'", "90'", "120'"]} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[
                { l: "20'–40'", f: 20, t: 40 },
                { l: "60'–80'", f: 60, t: 80 },
                { l: "Reta final 75–90", f: 75, t: 90 },
                { l: "Jogo todo 1–120", f: 1, t: 120 },
              ].map((pr) => (
                <button
                  key={pr.l}
                  type="button"
                  onClick={() => setD((prev) => {
                    // presets respect the period bounds too
                    let f = pr.f;
                    let t = pr.t;
                    if (prev.period === "first") { f = Math.min(f, 44); t = Math.min(t, 44); }
                    if (prev.period === "second") { f = Math.max(f, 45); t = Math.max(t, 45); }
                    if (prev.period === "half") { f = 45; t = 45; }
                    return { ...prev, minute_from: f, minute_to: t };
                  })}
                  className={`${pillSky(d.minute_from === pr.f && d.minute_to === pr.t)} tabular-nums`}
                >
                  {pr.l}
                </button>
              ))}
            </div>
          </div>

          {/* Marcador: as 8 condições */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-neutral-300">Marcador</p>
            <div className="flex flex-wrap gap-1.5">
              {BOT_SCORES.map((s) => (
                <button key={s.key} type="button" onClick={() => set("score", s.key)} className={pillSky(d.score === s.key)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Filtros de golos ao disparar */}
          <div className="space-y-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
            {(
              [
                { label: "Golos no jogo", ck: "total" as const, vk: "totalV" as const, opts: CMP_FULL },
                { label: "Diferença no marcador", ck: "diff" as const, vk: "diffV" as const, opts: CMP_FULL },
                { label: "Golos na 1.ª parte", ck: "fh" as const, vk: "fhV" as const, opts: CMP_HALF },
                { label: "Golos na 2.ª parte", ck: "sh" as const, vk: "shV" as const, opts: CMP_HALF },
              ]
            ).map((row) => {
              const cmp = d.goals[row.ck];
              return (
                <div key={row.ck} className="flex flex-wrap items-center gap-2">
                  <span className="w-44 shrink-0 text-xs text-neutral-400">{row.label}</span>
                  <select
                    value={cmp}
                    onChange={(e) => {
                      const v = e.target.value as GoalCmp;
                      setD((prev) => {
                        // leaving «Qualquer»: seed the mock default so the number isn't 0
                        const bump = row.ck === "total" || row.ck === "diff" ? 3 : 1;
                        const keep = v !== "any" && prev.goals[row.vk] === 0 && row.ck !== "sh" ? bump : prev.goals[row.vk];
                        return { ...prev, goals: { ...prev.goals, [row.ck]: v, [row.vk]: keep } };
                      });
                    }}
                    className="cursor-pointer rounded-lg border border-white/[0.09] bg-white/[0.03] px-2 py-1.5 text-xs text-neutral-100 outline-none focus:border-sky-500"
                  >
                    {row.opts.map((o) => (
                      <option key={o.v} value={o.v}>
                        {o.l}
                      </option>
                    ))}
                  </select>
                  {cmp !== "any" ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={20}
                        value={d.goals[row.vk]}
                        onChange={(e) => set("goals", { ...d.goals, [row.vk]: Math.min(20, Math.max(0, Number(e.target.value))) })}
                        className="w-14 rounded-lg border border-sky-600/50 bg-neutral-900 px-2 py-1.5 text-right text-xs font-medium tabular-nums text-sky-300 outline-none"
                      />
                      <span className="text-[11px] text-neutral-500">golos</span>
                    </div>
                  ) : (
                    <span className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-right text-xs tabular-nums text-neutral-600">—</span>
                  )}
                </div>
              );
            })}
            <p className="text-[11px] leading-relaxed text-neutral-500">
              Verificados no minuto do disparo. «Qualquer» fica neutro. Os filtros por parte ficam por confirmar antes
              do intervalo (o placar da 1.ª parte ainda não existe) — nesse caso o bot continua a vigiar e aplica-os
              quando houver. Exemplo: menos de 3 golos + diferença de menos de 3 + exatamente 1 golo na 1.ª parte e 0 na
              2.ª = só jogos em 1×0 ou 0×1 ao intervalo.
            </p>
          </div>
        </Section>

        {/* ——— Secção 3 · Antes do jogo (multi-critérios) ——— */}
        <Section n={3} title="Antes do jogo" sub="Filtra os jogos pelo que as equipas fizeram antes. Todos os critérios têm de se cumprir.">
          <div className="mb-3 flex justify-end">
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                d.preRules.length > 0 ? "bg-emerald-600/25 text-emerald-300" : "bg-white/[0.04] text-neutral-500"
              }`}
            >
              {d.preRules.length === 0 ? "Sem critérios" : `${d.preRules.length} ${d.preRules.length === 1 ? "ativo" : "ativos"}`}
            </span>
          </div>

          {d.preRules.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/[0.09] px-4 py-3 text-center text-xs text-neutral-500">
              Sem critérios PRE — o bot vigia todos os jogos das competições escolhidas.
            </div>
          ) : (
            <div className="space-y-2.5">
              {d.preRules.map((rule, i) => {
                const avg = rule.kind === "avg";
                const odd = rule.kind === "odd";
                const chip = odd ? "bg-fuchsia-500/20 text-fuchsia-300" : avg ? "bg-sky-500/20 text-sky-300" : "bg-emerald-600/25 text-emerald-300";
                const accentBar = odd ? "border-l-fuchsia-500" : avg ? "border-l-sky-500" : "border-l-emerald-500";
                const pillFor = odd ? pillPink : avg ? pillSky : pill;
                const sliderAccent = odd ? "fuchsia" : avg ? "sky" : "emerald";
                return (
                  <div key={i} className={`space-y-2 rounded-xl border border-white/[0.07] border-l-2 bg-white/[0.02] p-3 ${accentBar}`}>
                    {/* cabeçalho do cartão: chip + comando + remover */}
                    <div className="flex items-center gap-2">
                      <span className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${chip}`}>
                        {odd ? "Odd pre" : avg ? "Média" : "Historial"}
                      </span>
                    {odd ? (
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-200">Odd de vitória antes do jogo (1X2)</span>
                      ) : (
                        <select
                          value={rule.metric}
                          onChange={(e) =>
                            avg
                              ? setRule(i, { metric: e.target.value as PregameAvgStat })
                              : setRule(i, { metric: e.target.value as PregameMetric })
                          }
                          className="min-w-0 flex-1 rounded-lg border border-white/[0.09] bg-white/[0.03] px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
                        >
                          {avg
                            ? PREGAME_AVG_STATS.map((m) => (
                                <option key={m.key} value={m.key}>
                                  {m.label}
                                </option>
                              ))
                            : PREGAME_METRICS.map((m) => (
                                <option key={m.key} value={m.key}>
                                  {PRE_LABELS[m.key]}
                                </option>
                              ))}
                        </select>
                      )}
                      <button
                        type="button"
                        onClick={() => removeRule(i)}
                        title="Remover critério"
                        className="shrink-0 rounded-lg px-2 py-1.5 text-neutral-500 transition hover:bg-white/[0.06] hover:text-red-300"
                      >
                        ✕
                      </button>
                    </div>

                    {odd ? (
                      <>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {PREGAME_ODD_WHICH.map((w) => (
                            <button key={w.key} type="button" onClick={() => setRule(i, { which: w.key })} className={pillFor(rule.which === w.key)}>
                              {w.label}
                            </button>
                          ))}
                          {PREGAME_ODD_CMP.map((c) => (
                            <button key={c.key} type="button" onClick={() => setRule(i, { cmp: c.key })} className={pillFor(rule.cmp === c.key)}>
                              {c.label}
                            </button>
                          ))}
                        </div>
                        <div>
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="text-xs text-neutral-400">Odd pré-jogo desse lado</span>
                            <span className="text-base font-bold tabular-nums text-fuchsia-400">{fmtPre(rule.v)}</span>
                          </div>
                          <Slider value={rule.v} min={1} max={6} step={0.05} accent="fuchsia" onChange={(v) => setRule(i, { v: Math.round(v * 100) / 100 })} />
                          <Ticks items={["1,0", "3,0", "6,0"]} />
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs text-neutral-400">O favorito está:</span>
                          {PREGAME_FAV_STATES.map((s) => (
                            <button key={s.key} type="button" onClick={() => setRule(i, { favState: s.key })} className={pillFor(rule.favState === s.key)}>
                              {s.label}
                            </button>
                          ))}
                        </div>
                        <p className="text-[11px] leading-relaxed text-neutral-500">
                          Odds de antes do jogo (1X2). Sem odds pré-jogo, esse jogo fica de fora. Favorito = o lado com a
                          odd mais baixa.
                        </p>
                      </>
                    ) : avg ? (
                      <>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {PRE_SIDES.map((s) => (
                            <button key={s.v} type="button" onClick={() => setRule(i, { side: s.v })} className={pillFor(rule.side === s.v)}>
                              {s.l}
                            </button>
                          ))}
                          {PREGAME_AVG_CMP.map((c) => (
                            <button key={c.key} type="button" onClick={() => setRule(i, { cmp: c.key })} className={pillFor(rule.cmp === c.key)}>
                              {c.label}
                            </button>
                          ))}
                          <span className="ml-auto text-[11px] whitespace-nowrap text-neutral-500">últimos 10 jogos</span>
                        </div>
                        <div>
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="text-xs text-neutral-400">
                              {rule.metric.startsWith("goals") ? "Golos por jogo, na média" : "Cantos por jogo, na média"}
                            </span>
                            <span className={`text-base font-bold tabular-nums ${avg ? "text-sky-400" : "text-emerald-400"}`}>{fmtPre(rule.v)}</span>
                          </div>
                          <Slider
                            value={rule.v}
                            min={0}
                            max={rule.metric.startsWith("goals") ? 8 : 40}
                            step={0.5}
                            accent="sky"
                            onChange={(v) => setRule(i, { v: Math.round(v * 2) / 2 })}
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {PRE_SIDES.map((s) => (
                            <button key={s.v} type="button" onClick={() => setRule(i, { side: s.v })} className={pillFor(rule.side === s.v)}>
                              {s.l}
                            </button>
                          ))}
                          {([5, 10, 20] as const).map((n) => (
                            <button key={n} type="button" onClick={() => setRule(i, { n })} className={pillFor((rule.n ?? 10) === n)}>
                              {n}j
                            </button>
                          ))}
                        </div>
                        <div>
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="text-xs text-neutral-400">% dos jogos que bateram</span>
                            <span className="text-base font-bold tabular-nums text-emerald-400">{rule.pct ?? 60}%</span>
                          </div>
                          <Slider value={rule.pct ?? 60} min={10} max={100} step={1} onChange={(v) => setRule(i, { pct: v })} />
                          <Ticks items={["10%", "50%", "100%"]} />
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* tiles para acrescentar critérios (Árbitro ficou de fora por decisão) */}
          <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
            {[
              { k: "hist" as const, title: "Historial de mercado", sub: "% dos últimos jogos que bateram o mercado" },
              { k: "avg" as const, title: "Média estatística", sub: "cantos, golos por parte, na média" },
              { k: "odd" as const, title: "Odd pré-jogo", sub: "favoritos: odd de vitória até X" },
            ].map((t) => (
              <button
                key={t.k}
                type="button"
                onClick={() => addRule(t.k)}
                className="rounded-xl border border-dashed border-white/[0.12] px-3 py-2.5 text-left transition hover:border-white/[0.25] hover:bg-white/[0.02]"
              >
                <p className="text-sm font-semibold text-emerald-300">+ {t.title}</p>
                <p className="text-[11px] text-neutral-500">{t.sub}</p>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
            Verificado uma vez por jogo, antes do bot o vigiar. Um jogo sem dados suficientes dessa equipa fica de fora.
          </p>
        </Section>

        {/* ——— Secção 4 · Ao vivo ——— */}
        <Section n={4} title="Ao vivo" sub="O que tem de estar a acontecer no jogo para o bot apitar.">
          <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-neutral-100">Como juntar as condições</p>
              <p className="text-[11px] text-neutral-500">(todas têm de ser cumpridas)</p>
            </div>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => set("mode", "and")} className={pillViolet(d.mode === "and")}>E (todas)</button>
              <button type="button" onClick={() => set("mode", "or")} className={pillViolet(d.mode === "or")}>OU (uma)</button>
            </div>
          </div>

          {LIVE_GROUPS.map((grp) => (
            <div key={grp.name} className="mt-3">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-neutral-500">{grp.name}</p>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {grp.rows.map((row) => {
                  const key = liveKey(row, d.statSides, d.statWindows);
                  const on = key in d.stats;
                  return (
                    <div
                      key={row.id}
                      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition ${
                        on ? "border-violet-500/40 bg-violet-500/[0.06]" : "border-white/[0.07] bg-white/[0.03]"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleRow(row)}
                        aria-pressed={on}
                        className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? "bg-violet-600" : "bg-white/[0.09]"}`}
                      >
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
                      </button>
                      <span className="min-w-0 flex-1 text-[13px] leading-tight text-neutral-200">{row.label}</span>
                      {row.sides && (
                        <span className="flex shrink-0 gap-1">
                          {(["home", "away"] as const).map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setRowSide(row, s)}
                              className={`rounded-md px-2 py-0.5 text-[10px] font-semibold transition ${
                                (d.statSides[row.id] ?? "home") === s
                                  ? "bg-violet-500/25 text-violet-300"
                                  : "text-neutral-500 hover:text-neutral-300"
                              }`}
                            >
                              {s === "home" ? "Casa" : "Fora"}
                            </button>
                          ))}
                        </span>
                      )}
                      {row.windows && (
                        <select
                          value={d.statWindows[row.id] ?? 10}
                          onChange={(e) => setRowWindow(row, Number(e.target.value))}
                          className="shrink-0 rounded-lg border border-white/[0.09] bg-white/[0.03] px-1.5 py-1 text-[10px] text-neutral-300 outline-none focus:border-violet-500"
                        >
                          {[5, 10, 15].map((m) => (
                            <option key={m} value={m}>
                              {m}'
                            </option>
                          ))}
                        </select>
                      )}
                      {on ? (
                        <span className="flex shrink-0 items-center gap-1 text-xs">
                          <span className="text-violet-400">≥</span>
                          <input
                            type="number"
                            min={0}
                            max={200}
                            value={d.stats[key]}
                            onChange={(e) => set("stats", { ...d.stats, [key]: Number(e.target.value) })}
                            className="w-11 rounded-md border border-violet-700/60 bg-neutral-900 px-1 py-0.5 text-right text-[11px] font-medium text-violet-300 outline-none"
                          />
                          {row.unit && <span className="text-[10px] text-neutral-500">{row.unit}</span>}
                        </span>
                      ) : (
                        <span className="shrink-0 text-[11px] tabular-nums text-neutral-500">≥ {row.def}{row.unit}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
            Verificadas no minuto do disparo. Pressão = remates + cantos; a recente conta só os últimos minutos. Uma
            estatística sem dados nesse instante falha (o bot não apita às cegas). Minuto, período, marcador e filtros de
            golos (secção 2) e critérios pré-jogo (secção 3) continuam sempre obrigatórios.
          </p>

          <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
            <input type="checkbox" checked={d.refire} onChange={(e) => set("refire", e.target.checked)} className="mt-1 accent-violet-500" />
            <span className="text-xs text-neutral-300">
              <span className="font-semibold">Re-disparo no mesmo jogo</span> — permite disparar mais de uma vez se as
              condições voltarem a acontecer.
            </span>
          </label>
        </Section>
        </div>

        {/* ——— Barra lateral: preview, resumo, backtest e guardar ——— */}
        <aside className="space-y-4 lg:sticky lg:top-6">
          <div className="space-y-1.5 rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Preview do alerta</p>
            <p className="font-mono text-sm font-bold text-emerald-400">🤖 ALERTA {d.name || "MeuBot"}</p>
            <p className="font-mono text-sm text-neutral-200">
              {marketLabel.toUpperCase()} · Porto 1–0 Benfica · 44'
            </p>
            <p className="font-mono text-[11px] text-neutral-500">
              Min {d.minute_from}'–{d.minute_to}'{d.min_odd > 1 ? ` · odd mín. ${d.min_odd.toFixed(2)}` : ""}
            </p>
          </div>

          <div className="space-y-0.5 rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Resumo</p>
            <ResumoRow icon="🎯" label="Mercado" value={marketLabel} />
            <ResumoRow icon="📈" label="Odd mínima" value={d.min_odd > 1 ? d.min_odd.toFixed(2) : "Sem filtro"} />
            <ResumoRow icon="🏆" label="Competições" value={resumoCompeticoes} />
            <ResumoRow icon="⏱" label="Minutos" value={`${d.minute_from}'–${d.minute_to}'`} />
            <ResumoRow icon="⚽" label="Marcador" value={scoreLabel} />
            <ResumoRow icon="📊" label="Antes do jogo" value={preResumo} />
            <ResumoRow icon="⚡" label="Ao vivo" value={resumoAoVivo} />
            <ResumoRow icon="🔔" label="Aviso" value={d.silent ? "Só na lista" : "Notificação"} />
          </div>

          <div className="space-y-2 rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-neutral-200">🧪 Backtest</p>
              <button
                type="button"
                onClick={runBacktest}
                disabled={testing}
                className="rounded-lg border border-white/[0.09] px-3 py-1.5 text-xs text-neutral-300 hover:border-white/[0.18] disabled:opacity-50"
              >
                {testing ? "A testar…" : "Testar"}
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-neutral-500">
              Testa o filtro pré-jogo + marcador (ao intervalo ou no fim, como proxy do minuto) nos últimos terminados
              das ligas escolhidas. Minuto exato, estatísticas ao vivo e filtros de golos não existem para jogos
              passados.
            </p>
            {test && (
              <p className="text-sm font-medium text-neutral-100">
                {test.passed} em {test.tested} jogos ({test.tested > 0 ? Math.round((test.passed / test.tested) * 100) : 0}%)
                teriam passado o filtro.
              </p>
            )}
          </div>

          {error && <p className="rounded-lg bg-red-950 px-4 py-2.5 text-sm text-red-300">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-white/[0.09] px-4 py-2 text-sm text-neutral-300 hover:border-white/[0.18]">
              Cancelar
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {saving ? "A guardar…" : initial ? "Guardar" : "✓ Criar bot"}
            </button>
          </div>
        </aside>
        </div>
      </div>
    </div>
  );
}
