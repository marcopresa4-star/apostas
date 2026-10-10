"use client";

import { useState } from "react";
import type { BotMarket, BotMode, BotPeriod, BotStat, PregameMetric, PregameRule, PregameSide } from "@/lib/bots";
import { BOT_MARKETS, BOT_SCORES, BOT_STATS, PREGAME_METRICS } from "@/lib/bots";
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

const PRE_LABELS: Record<PregameMetric, string> = {
  total_over15: "Over 1.5 — jogo",
  total_over25: "Over 2.5 — jogo",
  btts: "Ambas marcam",
  sh_over05: "Over 0.5 — 2ª parte",
  sh_over15: "Over 1.5 — 2ª parte",
};

interface Draft {
  name: string;  silent: boolean;
  leagues: string[];
  mode: BotMode;
  minute_from: number;
  minute_to: number;
  period: BotPeriod;
  score: string;
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
  const set = <K extends keyof Draft>(k: K, v: Draft[K]): void => {
    setD((prev) => ({ ...prev, [k]: v }));
    setError(null);
  };

  const toggleStat = (k: string): void => {
    setD((prev) => {
      const stats = { ...prev.stats };
      if (k in stats) delete stats[k];
      else stats[k] = k.startsWith("poss_") ? 55 : k === "pressure_recent" ? 6 : k === "corners_total" ? 5 : 3;
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

  const field = "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-emerald-500";
  const pill = (on: boolean) =>
    `inline-flex cursor-pointer items-center rounded-full border px-3 py-1.5 text-xs font-medium transition ${on ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300" : "border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"}`;
  const marketLabel = BOT_MARKETS.find((m) => m.key === d.market)?.label ?? d.market;

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-black/70 p-4" onClick={onClose}>
      <div
        className="mx-auto my-8 max-w-2xl space-y-5 rounded-2xl border border-neutral-800 bg-neutral-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-100">🤖 {initial ? "Editar bot" : "Criar novo bot"}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-xl text-neutral-400 hover:bg-neutral-800" aria-label="Fechar">
            ✕
          </button>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Começar de um template (opcional)</p>
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

        <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
          <input type="checkbox" checked={d.silent} onChange={(e) => set("silent", e.target.checked)} className="mt-1 accent-emerald-500" />
          <span className="text-xs text-neutral-300">
            <span className="font-semibold">Modo silencioso</span> — regista o alerta e mostra na lista, mas não envia
            notificação. Útil para testar um bot novo sem spam.
          </span>
        </label>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Competições ({d.leagues.length === 0 ? `todas (${leagues.length})` : d.leagues.length})
          </p>
          <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950 p-3">
            {leagues.map((l) => (
              <label key={l.code} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-neutral-800 px-2 py-1 text-xs text-neutral-300">
                <input
                  type="checkbox"
                  checked={d.leagues.includes(l.code)}
                  onChange={() => set("leagues", d.leagues.includes(l.code) ? d.leagues.filter((x) => x !== l.code) : [...d.leagues, l.code])}
                  className="accent-emerald-500"
                />
                {l.label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-neutral-500">Nada marcado = todas as ligas mapeadas.</p>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Condições de disparo</p>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => set("mode", "and")} className={pill(d.mode === "and")}>E (todas)</button>
              <button type="button" onClick={() => set("mode", "or")} className={pill(d.mode === "or")}>OU (uma)</button>
            </div>
          </div>
          <p className="mb-3 text-[11px] text-neutral-500">
            Aplica-se só às estatísticas abaixo. Minuto, marcador e período continuam sempre obrigatórios.
          </p>

          <div className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-950 p-4">
            <p className="text-sm font-medium text-neutral-200">⏱ Minuto do jogo</p>
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs text-neutral-400">A partir do minuto</span>
                <span className="text-base font-bold tabular-nums text-emerald-400">{d.minute_from}&apos;</span>
              </div>
              <Slider value={d.minute_from} min={1} max={120} step={1} onChange={(v) => set("minute_from", Math.min(v, d.minute_to))} />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs text-neutral-400">Até ao minuto</span>
                <span className="text-base font-bold tabular-nums text-emerald-400">{d.minute_to}&apos;</span>
              </div>
              <Slider value={d.minute_to} min={1} max={120} step={1} onChange={(v) => set("minute_to", Math.max(v, d.minute_from))} />
            </div>
            <Ticks items={["1'", "45'", "90'", "120'"]} />
            <div>
              <p className="mb-1.5 text-xs text-neutral-400">Período do jogo</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { v: "any", l: "Qualquer" },
                  { v: "first", l: "1ª Parte" },
                  { v: "second", l: "2ª Parte" },
                  { v: "half", l: "Intervalo" },
                ].map((p) => (
                  <button key={p.v} type="button" onClick={() => set("period", p.v as Draft["period"])} className={pill(d.period === p.v)}>
                    {p.l}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3 space-y-2 rounded-xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-neutral-200">🎲 Odd mínima ao vivo</p>
              <span className="text-base font-bold tabular-nums text-amber-300">{d.min_odd.toFixed(2)}</span>
            </div>
            <p className="text-xs text-neutral-400">Só alerta se a odd estiver acima de</p>
            <Slider value={d.min_odd} min={1} max={6} step={0.05} onChange={(v) => set("min_odd", Math.round(v * 100) / 100)} />
            <Ticks items={["1.00", "2.00", "3.00", "4.00", "6.00"]} />
            <p className="text-[11px] leading-relaxed text-neutral-500">
              Compara com a odd ao vivo do mercado escolhido abaixo. Se a API não tiver odds disponíveis para esse
              mercado nesse instante, esta condição é ignorada só nesse disparo (não bloqueia as restantes).
            </p>
            <p className="text-[11px] text-neutral-500">Útil para filtrar mercados com odds muito baixas ao vivo que não têm valor real.</p>
            {d.min_odd <= 1 && (
              <p className="text-[11px] text-neutral-500">Em 1,00 a condição fica neutra: qualquer odd conta.</p>
            )}
          </div>

          <div className="mt-3 space-y-3 rounded-xl border border-neutral-800 bg-neutral-950 p-4">
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

          <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
            <input type="checkbox" checked={d.refire} onChange={(e) => set("refire", e.target.checked)} className="mt-1 accent-emerald-500" />
            <span className="text-xs text-neutral-300">
              <span className="font-semibold">Re-disparo no mesmo jogo</span> — permite disparar mais de uma vez se as
              condições voltarem a acontecer.
            </span>
          </label>

          <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 p-4">
            <p className="mb-2 text-sm font-medium text-neutral-200">⚽ Condição de marcador</p>
            <div className="flex flex-wrap gap-1.5">
              {BOT_SCORES.map((s) => (
                <button key={s.key} type="button" onClick={() => set("score", s.key)} className={pill(d.score === s.key)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 p-4">
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

          <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 p-4">
            <p className="mb-2 text-sm font-medium text-neutral-200">🎯 Mercado a alertar</p>
            <select value={d.market} onChange={(e) => set("market", e.target.value as BotMarket)} className={field}>
              {BOT_MARKETS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 p-4">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Preview do alerta</p>
            <p className="font-mono text-sm font-bold text-emerald-400">🤖 ALERTA {d.name || "MeuBot"}</p>
            <p className="font-mono text-sm text-neutral-200">
              {marketLabel.toUpperCase()} · Porto 1–0 Benfica · 44'
            </p>
            <p className="font-mono text-[11px] text-neutral-500">
              Min {d.minute_from}'–{d.minute_to}'{d.min_odd > 1 ? ` · odd mín. ${d.min_odd.toFixed(2)}` : ""}
            </p>
          </div>

          <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-neutral-200">🧪 Backtest (últimos terminados)</p>
              <button
                type="button"
                onClick={runBacktest}
                disabled={testing}
                className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:border-neutral-500 disabled:opacity-50"
              >
                {testing ? "A testar…" : "Testar"}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-neutral-500">
              Testa o filtro pré-jogo + marcador (ao intervalo ou no fim, como proxy do minuto) nos últimos terminados.
              Minuto exato e estatísticas ao vivo não existem para jogos passados.
            </p>
            {test && (
              <p className="mt-2 text-sm font-medium text-neutral-100">
                {test.passed} em {test.tested} jogos ({test.tested > 0 ? Math.round((test.passed / test.tested) * 100) : 0}%)
                teriam passado o filtro.
              </p>
            )}
          </div>
        </div>

        {error && <p className="rounded-lg bg-red-950 px-4 py-2.5 text-sm text-red-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:border-neutral-500">
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {saving ? "A guardar…" : initial ? "Guardar" : "✓ Criar bot"}
          </button>
        </div>
      </div>
    </div>
  );
}
