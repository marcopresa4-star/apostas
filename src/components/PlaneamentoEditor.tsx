"use client";

import { useState } from "react";
import {
  isHalvesOnly,
  METRIC_LABEL,
  type LiveAgg,
  type LiveCriterion,
  type LiveMetric,
  type LiveTableDef,
} from "@/lib/planeamento";
import { saveLiveTableAction } from "@/app/(app)/planeamento/actions";

const STEPS = [0, 15, 30, 45, 60, 75, 90];
const rid = (): string => Math.random().toString(36).slice(2, 10);

const blankCriterion = (): LiveCriterion => ({
  id: rid(),
  metric: "cantos",
  from: 0,
  to: 45,
  agg: "avg",
  target: 2,
  minPct: 70,
});

const blankTable = (): LiveTableDef => ({
  id: "",
  name: "",
  leaguesMode: "all",
  leagues: [],
  sample: "last10",
  venueSplit: false,
  criteria: [blankCriterion()],
});

const chip = (on: boolean) =>
  `rounded-full px-3 py-1.5 text-xs font-medium transition ${
    on ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40" : "bg-neutral-800 text-neutral-400 hover:text-neutral-200"
  }`;

const field =
  "rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500";

const num = (v: string, fb: number): number => {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : fb;
};

function CriterionRow({
  c,
  onChange,
  onRemove,
}: {
  c: LiveCriterion;
  onChange: (c: LiveCriterion) => void;
  onRemove: () => void;
}) {
  const setPreset = (from: number, to: number): void => onChange({ ...c, from, to });
  const isPreset = (from: number, to: number): boolean => c.from === from && c.to === to;
  return (
    <div className="rounded-xl border border-amber-500/30 bg-neutral-950 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {(["cantos", "golos", "amarelos"] as LiveMetric[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChange({ ...c, metric: m, ...(m === "cantos" ? { from: 0, to: 45 } : {}) })}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                c.metric === m ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40" : "bg-neutral-800 text-neutral-400"
              }`}
            >
              {m === "cantos" ? "🚩" : m === "golos" ? "⚽" : "🟨"} {METRIC_LABEL[m]}
            </button>
          ))}
        </div>
        <button type="button" onClick={onRemove} title="Remover critério" className="text-neutral-600 hover:text-red-300">
          ✕
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-neutral-500">Dos</span>
        <button type="button" onClick={() => setPreset(0, 90)} className={chip(isPreset(0, 90))}>
          Jogo
        </button>
        <button type="button" onClick={() => setPreset(0, 45)} className={chip(isPreset(0, 45))}>
          1ª parte
        </button>
        <button type="button" onClick={() => setPreset(45, 90)} className={chip(isPreset(45, 90))}>
          2ª parte
        </button>
        <select
          value={c.from}
          disabled={isHalvesOnly(c.metric)}
          onChange={(e) => {
            const from = Number(e.target.value);
            onChange({ ...c, from, to: Math.max(c.to, from + 15) });
          }}
          className={`${field} py-1 text-xs disabled:opacity-40`}
        >
          {STEPS.filter((s) => s < 90).map((s) => (
            <option key={s} value={s}>
              {s}′
            </option>
          ))}
        </select>
        <span className="text-neutral-500">aos</span>
        <select
          value={c.to}
          disabled={isHalvesOnly(c.metric)}
          onChange={(e) => onChange({ ...c, to: Number(e.target.value) })}
          className={`${field} py-1 text-xs disabled:opacity-40`}
        >
          {STEPS.filter((s) => s > c.from).map((s) => (
            <option key={s} value={s}>
              {s}′
            </option>
          ))}
        </select>
      </div>
      {isHalvesOnly(c.metric) && (
        <p className="mt-1 text-[11px] text-neutral-600">Cantos só por parte/jogo: a fonte não tem cantos por 15′.</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <button
          type="button"
          onClick={() => onChange({ ...c, agg: "avg" as LiveAgg })}
          className={chip(c.agg === "avg")}
        >
          Esperados
        </button>
        <button
          type="button"
          onClick={() => onChange({ ...c, agg: "pct" as LiveAgg })}
          className={chip(c.agg === "pct")}
        >
          % de jogos
        </button>
        <span className="text-neutral-500">≥</span>
        <input
          type="number"
          min={1}
          max={20}
          value={c.target}
          onChange={(e) => onChange({ ...c, target: Math.max(1, Math.round(num(e.target.value, c.target))) })}
          className={`${field} w-16 py-1 text-xs`}
        />
        <span className="text-neutral-500">{METRIC_LABEL[c.metric].toLowerCase()}</span>
        {c.agg === "pct" && (
          <>
            <span className="text-neutral-500">em pelo menos</span>
            <input
              type="number"
              min={1}
              max={100}
              value={c.minPct}
              onChange={(e) => onChange({ ...c, minPct: Math.min(100, Math.max(1, Math.round(num(e.target.value, c.minPct)))) })}
              className={`${field} w-16 py-1 text-xs`}
            />
            <span className="text-neutral-500">% dos jogos</span>
          </>
        )}
      </div>
    </div>
  );
}

export default function PlaneamentoEditor({
  table,
  leagues,
  onClose,
  onSaved,
}: {
  table: LiveTableDef | null;
  leagues: { code: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<LiveTableDef>(() =>
    table ? { ...table, leagues: [...table.leagues], criteria: table.criteria.map((c) => ({ ...c })) } : blankTable()
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickLeagues, setPickLeagues] = useState(form.leaguesMode === "custom");

  const setCrit = (id: string, c: LiveCriterion): void =>
    setForm((f) => ({ ...f, criteria: f.criteria.map((x) => (x.id === id ? c : x)) }));

  const save = async (): Promise<void> => {
    setError(null);
    setSaving(true);
    try {
      const res = await saveLiveTableAction(form);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-2xl border border-neutral-700 bg-neutral-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-100">{table ? "Editar tabela" : "Nova tabela"}</h2>
          <button type="button" onClick={onClose} className="text-neutral-500 hover:text-neutral-200">
            ✕
          </button>
        </div>

        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Nome da tabela</p>
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="+2 cantos HT"
          maxLength={40}
          className={`${field} mb-4 w-full`}
        />

        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Competições</p>
        <div className="mb-2 flex gap-1.5">
          {(
            [
              { v: "favs", l: "⭐ Ligas favoritas" },
              { v: "all", l: "Todas" },
              { v: "custom", l: "Escolher…" },
            ] as const
          ).map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => {
                setForm((f) => ({ ...f, leaguesMode: o.v }));
                setPickLeagues(o.v === "custom");
              }}
              className={chip(form.leaguesMode === o.v)}
            >
              {o.l}
            </button>
          ))}
        </div>
        {pickLeagues && (
          <div className="mb-4 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950 p-3">
            {leagues.map((l) => (
              <label
                key={l.code}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-neutral-800 px-2.5 py-1.5 text-xs text-neutral-300 hover:border-neutral-600"
              >
                <input
                  type="checkbox"
                  checked={form.leagues.includes(l.code)}
                  onChange={() =>
                    setForm((f) => ({
                      ...f,
                      leagues: f.leagues.includes(l.code) ? f.leagues.filter((x) => x !== l.code) : [...f.leagues, l.code],
                    }))
                  }
                  className="accent-emerald-500"
                />
                {l.label}
              </label>
            ))}
          </div>
        )}

        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Amostra das equipas</p>
        <div className="mb-2 flex gap-1.5">
          <button type="button" onClick={() => setForm((f) => ({ ...f, sample: "last10" }))} className={chip(form.sample === "last10")}>
            Últimos 10
          </button>
          <button type="button" onClick={() => setForm((f) => ({ ...f, sample: "season" }))} className={chip(form.sample === "season")}>
            Época
          </button>
        </div>
        <label className="mb-4 flex cursor-pointer items-center gap-2 text-xs text-neutral-300">
          <input
            type="checkbox"
            checked={form.venueSplit}
            onChange={(e) => setForm((f) => ({ ...f, venueSplit: e.target.checked }))}
            className="accent-emerald-500"
          />
          Casa só com os jogos em casa, visitante só com os jogos fora
        </label>

        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Critérios (todos têm de se cumprir)
        </p>
        <div className="space-y-2">
          {form.criteria.map((c) => (
            <CriterionRow key={c.id} c={c} onChange={(n) => setCrit(c.id, n)} onRemove={() => setForm((f) => ({ ...f, criteria: f.criteria.filter((x) => x.id !== c.id) }))} />
          ))}
        </div>
        {form.criteria.length < 6 && (
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, criteria: [...f.criteria, blankCriterion()] }))}
            className="mt-2 rounded-lg border border-dashed border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:border-emerald-500"
          >
            + Adicionar critério
          </button>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
          Os números vêm dos jogos recentes das duas equipas (cantos, golos e amarelos por intervalo). “Esperados” é a
          média das duas equipas nesse intervalo; “% de jogos” é em quantos desses jogos houve pelo menos esse número.
        </p>

        {error && <p className="mt-3 rounded-lg bg-red-950 px-3 py-2 text-xs text-red-300">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:border-neutral-500"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {saving ? "A guardar…" : "Guardar tabela"}
          </button>
        </div>
      </div>
    </div>
  );
}
