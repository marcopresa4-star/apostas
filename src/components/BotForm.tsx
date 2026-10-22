"use client";

import { useRef, useState } from "react";
import type {
  BotMarket,
  BotMode,
  BotPeriod,
  BotStat,
  GoalCmp,
  GoalRules,
  PregameMetric,
  PregameRule,
  PregameSide,
} from "@/lib/bots";
import { BOT_MARKETS, BOT_SCORES, BOT_STATS, GOAL_CMP_LABELS, GOALS_NEUTRAL, goalsNeutral, PREGAME_METRICS } from "@/lib/bots";
import { saveBotAction } from "@/app/(app)/bots/actions";
import type { BotRow } from "@/components/BotsClient";

interface PregameDraft {
  side: PregameSide;
  n: 5 | 10 | 20;
  metric: PregameMetric;
  pct: number;
}

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

function Slider({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full accent-emerald-500"
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
  pre: { on: boolean } & PregameDraft;
  refire: boolean;
}

const fromRow = (b: BotRow): Draft => ({
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
  stats: Object.fromEntries(b.stats.map((s) => [s.k, s.v])),
  pre: {
    on: b.pregame.length > 0,
    side: b.pregame[0]?.side ?? "either",
    n: b.pregame[0]?.n === 5 || b.pregame[0]?.n === 20 ? b.pregame[0].n : 10,
    metric: b.pregame[0]?.metric ?? "sh_over15",
    pct: b.pregame[0]?.pct ?? 60,
  },
  refire: b.refire,
});

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
  pre: { on: false, side: "either", n: 10, metric: "sh_over15", pct: 60 },
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

  const toggleStat = (k: string): void => {
    setD((prev) => {
      const stats = { ...prev.stats };
      if (k in stats) delete stats[k];
      else stats[k] = k.startsWith("poss_") ? 55 : k === "pressure_recent" ? 6 : k === "corners_total" ? 5 : k === "big_total" ? 2 : 3;
      return { ...prev, stats };
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
          pregame: d.pre.on ? [{ side: d.pre.side, n: d.pre.n, metric: d.pre.metric, pct: d.pre.pct }] : [],
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
      pregame: d.pre.on ? [{ side: d.pre.side, n: d.pre.n, metric: d.pre.metric, pct: d.pre.pct }] : [],
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
  const marketLabel = BOT_MARKETS.find((m) => m.key === d.market)?.label ?? d.market;
  const scoreLabel = BOT_SCORES.find((s) => s.key === d.score)?.label ?? d.score;
  // Resumo values (sidebar).
  const resumoCompeticoes =
    d.leagues.length === 0
      ? "Todas as ligas"
      : d.leagues.length === 1
        ? leagues.find((l) => l.code === d.leagues[0])?.label ?? d.leagues[0]
        : `${d.leagues.length} ligas`;
  const nStats = Object.keys(d.stats).length;
  const resumoAoVivo =
    nStats === 0 ? "Só minuto e marcador" : nStats === 1 ? "1 estatística" : `${nStats} estatísticas`;

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

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Condições de disparo</p>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => set("mode", "and")} className={pill(d.mode === "and")}>E (todas)</button>
              <button type="button" onClick={() => set("mode", "or")} className={pill(d.mode === "or")}>OU (uma)</button>
            </div>
          </div>
          <p className="mb-3 text-[11px] text-neutral-500">
            Aplica-se só ao critério pré-jogo e às estatísticas ao vivo abaixo. Minuto, período, marcador e filtros de
            golos (secção 2) continuam sempre obrigatórios.
          </p>

          <div className="space-y-3 rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
            <label className="flex cursor-pointer items-start gap-2">
              <input type="checkbox" checked={d.pre.on} onChange={(e) => set("pre", { ...d.pre, on: e.target.checked })} className="mt-0.5 accent-emerald-500" />
              <span className="text-xs text-neutral-300">
                <span className="font-semibold uppercase tracking-wide">✅ Ativar critério pré-jogo</span>
                <span className="mt-0.5 block text-[11px] font-normal normal-case tracking-normal text-neutral-500">
                  Diferente de tudo o resto — isto decide logo que jogos o bot considera, com base no historial da
                  equipa antes do apito inicial (ex: % dos últimos 10 jogos com mais de 1,5 golos na 2ª parte ≥ 60%).
                  Um jogo que não cumpra isto nunca chega a ser vigiado ao vivo, mesmo que as restantes condições se
                  verifiquem.
                </span>
              </span>
            </label>
            {d.pre.on && (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-neutral-400">Equipa</span>
                  {[
                    { v: "home", l: "Casa" },
                    { v: "away", l: "Fora" },
                    { v: "either", l: "Ambas" },
                  ].map((s) => (
                    <button key={s.v} type="button" onClick={() => set("pre", { ...d.pre, side: s.v as PregameSide })} className={pill(d.pre.side === s.v)}>
                      {s.l}
                    </button>
                  ))}
                  <span className="ml-2 text-xs text-neutral-400">Últimos</span>
                  {([5, 10, 20] as const).map((n) => (
                    <button key={n} type="button" onClick={() => set("pre", { ...d.pre, n })} className={pill(d.pre.n === n)}>
                      {n}j
                    </button>
                  ))}
                </div>
                <div>
                  <p className="mb-1 text-xs text-neutral-400">Mercado</p>
                  <select
                    value={d.pre.metric}
                    onChange={(e) => set("pre", { ...d.pre, metric: e.target.value as PregameMetric })}
                    className={field}
                  >
                    {PREGAME_METRICS.map((m) => (
                      <option key={m.key} value={m.key}>
                        {PRE_LABELS[m.key]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-xs text-neutral-400">% mínima dos jogos que cumprem o mercado</span>
                    <span className="text-base font-bold tabular-nums text-emerald-400">{d.pre.pct}%</span>
                  </div>
                  <Slider value={d.pre.pct} min={10} max={100} step={1} onChange={(v) => set("pre", { ...d.pre, pct: v })} />
                  <Ticks items={["10%", "50%", "100%"]} />
                </div>
                <p className="text-[11px] leading-relaxed text-neutral-500">
                  Verificada uma única vez por jogo (não muda durante a partida). Se a API não tiver dados suficientes
                  dos últimos jogos dessa equipa, esta condição é ignorada só nesse jogo (não bloqueia os outros).
                </p>
              </>
            )}
          </div>

          <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
            <input type="checkbox" checked={d.refire} onChange={(e) => set("refire", e.target.checked)} className="mt-1 accent-emerald-500" />
            <span className="text-xs text-neutral-300">
              <span className="font-semibold">Re-disparo no mesmo jogo</span> — permite disparar mais de uma vez se as
              condições voltarem a acontecer.
            </span>
          </label>

          <div className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
            <p className="mb-1 text-sm font-medium text-neutral-200">📊 Gatilhos estatísticos ao vivo</p>
            <p className="mb-2 text-[11px] text-neutral-500">Marca os que contam; a barra do valor só aparece depois de marcares.</p>
            <div className="space-y-2">
              {BOT_STATS.map((s) => {
                const on = s.k in d.stats;
                return (
                  <div key={s.k} className="flex items-center gap-2">
                    <input type="checkbox" checked={on} onChange={() => toggleStat(s.k)} className="accent-emerald-500" />
                    <span className="min-w-0 flex-1 text-xs text-neutral-300">{s.label}</span>
                    {on && (
                      <span className="flex shrink-0 items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={d.stats[s.k]}
                          onChange={(e) => set("stats", { ...d.stats, [s.k]: Number(e.target.value) })}
                          className="w-16 rounded-lg border border-emerald-700/60 bg-neutral-900 px-2 py-1 text-right text-xs font-medium text-emerald-300 outline-none"
                        />
                        <span className="text-[11px] text-neutral-500">{s.unit}</span>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
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
            <ResumoRow icon="📊" label="Antes do jogo" value={d.pre.on ? `${PRE_LABELS[d.pre.metric]} ≥ ${d.pre.pct}%` : "Sem filtro"} />
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
