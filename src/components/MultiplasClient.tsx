"use client";

import { useEffect, useMemo, useState } from "react";
import { MULTI_FAMILIES, buildMultiples, type FamilyFilter, type PricedLeg } from "@/lib/multiplasGen";
import {
  loadFilterPresets,
  loadSavedTickets,
  persistSavedTickets,
  saveFilterPresets,
  type MultiFilterPreset,
  type SavedTicket,
} from "@/lib/multiplasStore";

const pct1 = (p: number): string => `${(p * 100).toFixed(1).replace(".", ",")}%`;
const pct0 = (p: number): string => `${Math.round(p * 100)}%`;
const odd2 = (n: number): string => (Number.isFinite(n) && n > 0 ? n.toFixed(2).replace(".", ",") : "—");

const shiftDay = (iso: string, by: number): string => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + by);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const dayLabel = (iso: string): string => {
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString("pt-PT", { weekday: "short", day: "2-digit", month: "2-digit" });
  } catch {
    return iso;
  }
};

const numOrNull = (t: string): number | null => {
  const n = Number(t.replace(",", "."));
  return t.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

interface GenMeta {
  fixturesTotal: number;
  oddsTotal: number;
  truncated: boolean;
}

export default function MultiplasClient({ leagues, today }: { leagues: { code: string; label: string }[]; today: string }) {
  const [days, setDays] = useState<string[]>([today]);
  const [customDay, setCustomDay] = useState("");
  const [ligas, setLigas] = useState<string[]>(leagues.map((l) => l.code));
  const [fam, setFam] = useState<Record<string, { on: boolean; min: string; max: string }>>(() =>
    Object.fromEntries(MULTI_FAMILIES.filter((f) => f.covered).map((f) => [f.id, { on: true, min: "1,30", max: "4,00" }]))
  );
  const [legsN, setLegsN] = useState("4");
  const [ticketsN, setTicketsN] = useState("1");
  const [minEdge, setMinEdge] = useState("3");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [priced, setPriced] = useState<PricedLeg[]>([]);
  const [meta, setMeta] = useState<GenMeta>({ fixturesTotal: 0, oddsTotal: 0, truncated: false });
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState<number | null>(null);
  const [presets, setPresets] = useState<MultiFilterPreset[]>([]);
  const [defPreset, setDefPreset] = useState<string | null>(null);
  const [presetName, setPresetName] = useState("");
  const [saved, setSaved] = useState<SavedTicket[]>([]);

  useEffect(() => {
    const { presets: p, def } = loadFilterPresets();
    setPresets(p);
    setDefPreset(def);
    const active = (def && p.find((x) => x.name === def)) || null;
    if (active) applyPreset(active);
    setSaved(loadSavedTickets());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status !== "loading") return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  const toggleLiga = (code: string): void =>
    setLigas((prev) => (prev.includes(code) ? prev.filter((l) => l !== code) : [...prev, code]));

  const applyPreset = (p: MultiFilterPreset): void => {
    setLigas(p.ligas);
    setFam((prev) => {
      const next = { ...prev };
      for (const [id, v] of Object.entries(p.fam)) {
        if (next[id]) next[id] = { on: v.on, min: v.min, max: v.max };
      }
      return next;
    });
    setLegsN(p.legsN);
    setTicketsN(p.ticketsN);
    setMinEdge(p.minEdge);
  };

  const persistPresets = (next: MultiFilterPreset[], def: string | null): void => {
    setPresets(next);
    setDefPreset(def);
    saveFilterPresets(next, def);
  };

  const savePreset = (): void => {
    const name = presetName.trim().slice(0, 30);
    if (!name) return;
    const entry: MultiFilterPreset = { name, ligas, fam, legsN, ticketsN, minEdge };
    persistPresets([...presets.filter((p) => p.name !== name), entry], defPreset);
    setPresetName("");
  };

  const saveTicket = (idx: number): void => {
    const t = tickets[idx];
    if (!t || t.legs.length === 0) return;
    const entry: SavedTicket = {
      id: `${Date.now()}-${idx}`,
      savedAt: Date.now(),
      days: [...days].sort(),
      index: idx,
      legs: t.legs,
      odd: t.odd,
      p: t.p,
      fair: t.fair,
      avgEdge: t.avgEdge,
    };
    const next = [entry, ...loadSavedTickets()].slice(0, 30);
    setSaved(next);
    persistSavedTickets(next);
  };

  const setFamField = (id: string, field: "on" | "min" | "max", value: boolean | string): void =>
    setFam((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));

  const parsedFam: Record<string, FamilyFilter> = useMemo(
    () =>
      Object.fromEntries(
        MULTI_FAMILIES.filter((f) => f.covered).map((f) => [
          f.id,
          { on: fam[f.id]?.on ?? false, min: numOrNull(fam[f.id]?.min ?? ""), max: numOrNull(fam[f.id]?.max ?? "") },
        ])
      ),
    [fam]
  );

  const nLegs = Math.max(1, Math.floor(Number(legsN)) || 4);
  const nTickets = Math.max(1, Math.min(10, Math.floor(Number(ticketsN)) || 1));
  const edgeMin = Math.max(0, (Number(minEdge.replace(",", ".")) || 0) / 100);

  const tickets = useMemo(
    () => buildMultiples(priced, { families: parsedFam, legs: nLegs, minEdge: edgeMin, tickets: nTickets }),
    [priced, parsedFam, nLegs, edgeMin, nTickets]
  );
  const placedLegs = tickets.reduce((s, t) => s + t.legs.length, 0);

  const famCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const leg of priced) {
      const f = parsedFam[leg.family];
      if (!f?.on) continue;
      if (f.min !== null && leg.real < f.min) continue;
      if (f.max !== null && leg.real > f.max) continue;
      if (leg.edge < edgeMin) continue;
      counts[leg.family] = (counts[leg.family] ?? 0) + 1;
    }
    return counts;
  }, [priced, parsedFam, edgeMin]);

  const canGenerate = days.length > 0 && ligas.length > 0 && status !== "loading";

  const generate = async (): Promise<void> => {
    if (!canGenerate) return;
    setStatus("loading");
    setError(null);
    setCopied(null);
    try {
      const res = await fetch("/api/multiplas/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ days: [...days].sort(), leagues: ligas }),
      });
      if (!res.ok) throw new Error(res.status === 401 ? "Sem sessão." : `Falhou (${res.status}).`);
      const body = (await res.json()) as { legs?: PricedLeg[]; fixturesTotal?: number; oddsTotal?: number; truncated?: boolean };
      setPriced(Array.isArray(body.legs) ? body.legs : []);
      setMeta({
        fixturesTotal: typeof body.fixturesTotal === "number" ? body.fixturesTotal : 0,
        oddsTotal: typeof body.oddsTotal === "number" ? body.oddsTotal : 0,
        truncated: body.truncated === true,
      });
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falhou a geração.");
      setStatus("error");
    }
  };

  const slipText = (t: (typeof tickets)[number], idx: number): string => {
    const lines = t.legs.map(
      (l) => `${l.date}${l.time ? ` ${l.time}` : ""} · ${l.home} vs ${l.away} — ${l.label} @ ${odd2(l.real)} (modelo ${pct0(l.p)})`
    );
    return `Múltipla ${idx + 1} (${t.legs.length} pernas) — odd ${odd2(t.odd)}\n${lines.join("\n")}`;
  };

  const copy = async (idx: number): Promise<void> => {
    try {
      await navigator.clipboard.writeText(slipText(tickets[idx], idx));
      setCopied(idx);
      setTimeout(() => setCopied((c) => (c === idx ? null : c)), 2000);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Dias</p>
        <div className="mb-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setDays([today])}
            className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300 transition hover:bg-neutral-800"
          >
            Hoje
          </button>
          <button
            type="button"
            onClick={() => setDays([shiftDay(today, 1)])}
            className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300 transition hover:bg-neutral-800"
          >
            Amanhã
          </button>
          <button
            type="button"
            onClick={() => setDays(Array.from({ length: 7 }, (_, i) => shiftDay(today, i)))}
            className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300 transition hover:bg-neutral-800"
          >
            Próximos 7 dias
          </button>
          <span className="flex items-center gap-1.5">
            <input
              type="date"
              value={customDay}
              onChange={(e) => setCustomDay(e.target.value)}
              className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200 outline-none"
            />
            <button
              type="button"
              disabled={!customDay}
              onClick={() => {
                if (customDay && !days.includes(customDay)) setDays((d) => [...d, customDay].sort());
                setCustomDay("");
              }}
              className="rounded-lg bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
            >
              + dia
            </button>
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {days.length === 0 && <span className="text-xs text-neutral-500">Escolhe pelo menos um dia.</span>}
          {days.map((d) => (
            <span key={d} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">
              {dayLabel(d)}
              <button type="button" onClick={() => setDays((prev) => prev.filter((x) => x !== d))} className="hover:text-red-300" title="Remover dia">
                ✕
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Ligas mapeadas</p>
          <span className="flex gap-2">
            <button type="button" onClick={() => setLigas(leagues.map((l) => l.code))} className="text-xs text-neutral-400 hover:text-neutral-200">
              Todas
            </button>
            <button type="button" onClick={() => setLigas([])} className="text-xs text-neutral-400 hover:text-neutral-200">
              Nenhuma
            </button>
          </span>
        </div>
        {leagues.length === 0 ? (
          <p className="text-xs text-neutral-500">Sem ligas mapeadas. Liga torneios no Mapa primeiro.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {leagues.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => toggleLiga(l.code)}
                className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                  ligas.includes(l.code)
                    ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                    : "border-neutral-800 text-neutral-500"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Tipos de aposta e intervalo de odd (odd real)</p>
        <p className="mb-2 text-[11px] text-neutral-500">Linhas asiáticas fracionadas (1,25…) ficam de fora — meia-devolução não cabe numa múltipla.</p>
        <div className="space-y-1.5">
          {MULTI_FAMILIES.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-neutral-950 px-3 py-2 text-xs">
              {f.covered ? (
                <button
                  type="button"
                  onClick={() => setFamField(f.id, "on", !(fam[f.id]?.on ?? false))}
                  className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                    fam[f.id]?.on ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300" : "border-neutral-800 text-neutral-500"
                  }`}
                >
                  {f.label}
                </button>
              ) : (
                <span className="rounded-full border border-neutral-800 px-2 py-0.5 text-[11px] text-neutral-600" title={f.whyDisabled}>
                  {f.label} · {f.whyDisabled}
                </span>
              )}
              {f.covered && (
                <span className="flex items-center gap-1 text-neutral-500">
                  odd
                  <input
                    value={fam[f.id]?.min ?? ""}
                    onChange={(e) => setFamField(f.id, "min", e.target.value)}
                    placeholder="min"
                    inputMode="decimal"
                    className="w-16 rounded-md border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-[11px] text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-emerald-500"
                  />
                  –
                  <input
                    value={fam[f.id]?.max ?? ""}
                    onChange={(e) => setFamField(f.id, "max", e.target.value)}
                    placeholder="max"
                    inputMode="decimal"
                    className="w-16 rounded-md border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-[11px] text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-emerald-500"
                  />
                  {status === "done" && (
                    <span className="text-[11px] text-neutral-500">{famCounts[f.id] ?? 0} pernas</span>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-neutral-300">
          <label className="flex items-center gap-1.5">
            Jogos
            <input
              value={legsN}
              onChange={(e) => setLegsN(e.target.value)}
              inputMode="numeric"
              className="w-14 rounded-md border border-neutral-700 bg-neutral-950 px-1.5 py-1 text-xs text-neutral-200 outline-none focus:border-emerald-500"
            />
            <span className="text-neutral-500">por boletim</span>
          </label>
          <label className="flex items-center gap-1.5">
            Boletins
            <input
              value={ticketsN}
              onChange={(e) => setTicketsN(e.target.value)}
              inputMode="numeric"
              className="w-14 rounded-md border border-neutral-700 bg-neutral-950 px-1.5 py-1 text-xs text-neutral-200 outline-none focus:border-emerald-500"
            />
            <span className="text-neutral-500">(1–10)</span>
          </label>
          <label className="flex items-center gap-1.5" title="Lucro médio mínimo esperado por perna: modelo × odd real − 1. Ex.: 3% = a perna tem de render +3% em média.">
            Edge mín. %
            <input
              value={minEdge}
              onChange={(e) => setMinEdge(e.target.value)}
              inputMode="decimal"
              className="w-14 rounded-md border border-neutral-700 bg-neutral-950 px-1.5 py-1 text-xs text-neutral-200 outline-none focus:border-emerald-500"
            />
          </label>
          <button
            type="button"
            onClick={generate}
            disabled={!canGenerate}
            className="rounded-lg bg-emerald-600 px-4 py-1.5 font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {status === "loading" ? `A gerar… ${elapsed}s` : "Gerar múltipla"}
          </button>
        </div>
        {status === "loading" && (
          <p className="mt-2 text-[11px] text-neutral-500">A ler odds jogo a jogo (a primeira vez demora minutos)…</p>
        )}
        {status === "error" && <p className="mt-2 text-xs text-red-300">{error}</p>}
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Filtros guardados</p>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="Nome do filtro…"
            maxLength={30}
            className="w-48 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-emerald-500"
          />
          <button
            type="button"
            onClick={savePreset}
            disabled={presetName.trim() === ""}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            Guardar atuais
          </button>
          <span className="text-[11px] text-neutral-500">Guarda ligas, tipos, odds, jogos e boletins (não os dias).</span>
        </div>
        {presets.length === 0 ? (
          <p className="text-[11px] text-neutral-500">Ainda sem filtros guardados.</p>
        ) : (
          <div className="space-y-1.5">
            {presets.map((p) => (
              <div key={p.name} className="flex items-center justify-between gap-2 rounded-lg bg-neutral-950 px-3 py-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-neutral-200">
                  {p.name}
                  {p.name === defPreset && <span className="ml-1 text-neutral-500">★</span>}
                </span>
                <span className="flex shrink-0 gap-2">
                  <button type="button" onClick={() => applyPreset(p)} className="text-neutral-400 hover:text-neutral-200">
                    Usar
                  </button>
                  {p.name !== defPreset && (
                    <button type="button" onClick={() => persistPresets(presets, p.name)} className="text-neutral-400 hover:text-neutral-200">
                      Padrão
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (!confirm(`Apagar o filtro "${p.name}"?`)) return;
                      persistPresets(
                        presets.filter((x) => x.name !== p.name),
                        defPreset === p.name ? null : defPreset
                      );
                    }}
                    className="text-neutral-400 hover:text-red-300"
                  >
                    Apagar
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {status === "done" && (
        <div className="space-y-4">
          <p className="-mb-2 text-[11px] text-neutral-500">
            {meta.fixturesTotal} jogos vistos · {meta.oddsTotal} com leitura de odds
            {meta.truncated ? " · limite de 60 leituras: alarga em fatias menores" : ""} · {priced.length} pernas com odd real
          </p>
          {tickets.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-center text-xs text-neutral-500">
              Nenhuma perna cumpre os filtros (intervalos de odd e edge mínimo). Alarga os intervalos ou baixa o edge mín.
            </p>
          ) : (
            <>
              {placedLegs < nLegs * nTickets && (
                <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  Só {placedLegs} perna{placedLegs === 1 ? "" : "s"} cumpre(m) os filtros (pediste {nLegs} por boletim ×{" "}
                  {nTickets} boletim{nTickets === 1 ? "" : "s"} = {nLegs * nTickets}). Alarga intervalos ou baixa o edge.
                </p>
              )}
              {tickets.map((t, idx) => (
                <div key={idx} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-neutral-300">
                      Múltipla {idx + 1} · {t.legs.length} perna{t.legs.length === 1 ? "" : "s"}
                      {idx === 0 && <span className="ml-1 text-[10px] font-normal text-emerald-400">a de maior valor</span>}
                    </h3>
                    <span className="flex gap-2">
                      <button type="button" onClick={() => saveTicket(idx)} className="rounded-lg bg-neutral-800 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-700">
                        Guardar
                      </button>
                      <button type="button" onClick={() => copy(idx)} className="rounded-lg bg-neutral-800 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-700">
                        {copied === idx ? "Copiado ✓" : "Copiar boletim"}
                      </button>
                    </span>
                  </div>
                  <div className="mb-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 rounded-lg bg-neutral-950 px-3 py-2">
                    <p className="text-lg font-bold text-emerald-300">Odd {odd2(t.odd)}</p>
                    <p className="text-xs text-neutral-400">
                      Modelo: <span className="font-medium text-neutral-200">{pct1(t.p)}</span> · justa{" "}
                      <span className="font-medium text-neutral-200">{odd2(t.fair)}</span> · valor médio{" "}
                      <span className="font-medium text-emerald-400">+{pct1(t.avgEdge)}</span>
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    {t.legs.map((l) => (
                      <div key={`${l.eventId}:${l.key}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-neutral-950 px-3 py-2 text-xs">
                        <span className="shrink-0 text-neutral-500">
                          {l.date.slice(8, 10)}/{l.date.slice(5, 7)}{l.time ? ` ${l.time.slice(0, 5)}` : ""}
                        </span>
                        <span className="min-w-0 flex-1 text-neutral-200">
                          {l.home} vs {l.away} — <span className="font-medium text-neutral-100">{l.label}</span>
                          <span className="ml-1 text-[10px] text-neutral-500">{l.leagueLabel}</span>
                          {l.voidNote && <span className="ml-1 text-[10px] text-amber-300">· {l.voidNote}</span>}
                        </span>
                        <span className="shrink-0 tabular-nums text-neutral-400">
                          {pct0(l.p)} @ <span className="font-semibold text-neutral-100">{odd2(l.real)}</span>{" "}
                          <span className="text-emerald-400">+{pct1(l.edge)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-[11px] leading-relaxed text-neutral-500">
                Combinadas assumem pernas independentes (otimista se correlacionadas). As odds mexem — confirma na casa
                antes de apostar. Pernas com devolução seguem as regras da casa para múltiplas.
              </p>
            </>
          )}
        </div>
      )}

      {saved.length > 0 && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Boletins guardados</p>
            <button
              type="button"
              onClick={() => {
                if (!confirm("Apagar todos os boletins guardados?")) return;
                setSaved([]);
                persistSavedTickets([]);
              }}
              className="text-xs text-neutral-400 hover:text-red-300"
            >
              Limpar tudo
            </button>
          </div>
          <div className="space-y-1.5">
            {saved.map((s) => (
              <details key={s.id} className="rounded-lg bg-neutral-950 px-3 py-2 text-xs">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-neutral-500">
                    {new Date(s.savedAt).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" })}
                  </span>
                  <span className="font-medium text-neutral-200">
                    {s.legs.length} pernas · odd {odd2(s.odd)}
                  </span>
                  <span className="text-neutral-500">
                    {s.days.map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`).join(", ")}
                  </span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      navigator.clipboard
                        .writeText(
                          `Múltipla (${s.legs.length} pernas) — odd ${odd2(s.odd)}\n${s.legs
                            .map((l) => `${l.date}${l.time ? ` ${l.time}` : ""} · ${l.home} vs ${l.away} — ${l.label} @ ${odd2(l.real)}`)
                            .join("\n")}`
                        )
                        .catch(() => {});
                    }}
                    className="text-neutral-400 hover:text-neutral-200"
                  >
                    Copiar
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      const next = saved.filter((x) => x.id !== s.id);
                      setSaved(next);
                      persistSavedTickets(next);
                    }}
                    className="text-neutral-400 hover:text-red-300"
                  >
                    Apagar
                  </button>
                </summary>
                <div className="mt-2 space-y-1 border-t border-neutral-800 pt-2">
                  {s.legs.map((l) => (
                    <p key={`${l.eventId}:${l.key}`} className="text-neutral-300">
                      {l.date.slice(8, 10)}/{l.date.slice(5, 7)}{l.time ? ` ${l.time.slice(0, 5)}` : ""} · {l.home} vs {l.away} —{" "}
                      {l.label} @ {odd2(l.real)}
                    </p>
                  ))}
                  <p className="text-neutral-500">
                    Modelo {pct1(s.p)} · justa {odd2(s.fair)} · valor médio +{pct1(s.avgEdge)}
                  </p>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
