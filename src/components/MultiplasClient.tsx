"use client";

import { useEffect, useMemo, useState } from "react";
import { MULTI_FAMILIES, buildMultiple, type FamilyFilter, type PricedLeg } from "@/lib/multiplasGen";

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
  const [minEdge, setMinEdge] = useState("3");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [priced, setPriced] = useState<PricedLeg[]>([]);
  const [meta, setMeta] = useState<GenMeta>({ fixturesTotal: 0, oddsTotal: 0, truncated: false });
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (status !== "loading") return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  const toggleLiga = (code: string): void =>
    setLigas((prev) => (prev.includes(code) ? prev.filter((l) => l !== code) : [...prev, code]));

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
  const edgeMin = Math.max(0, (Number(minEdge.replace(",", ".")) || 0) / 100);

  const built = useMemo(
    () => buildMultiple(priced, { families: parsedFam, legs: nLegs, minEdge: edgeMin }),
    [priced, parsedFam, nLegs, edgeMin]
  );

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
    setCopied(false);
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

  const slipText = (): string => {
    const lines = built.legs.map(
      (l) => `${l.date}${l.time ? ` ${l.time}` : ""} · ${l.home} vs ${l.away} — ${l.label} @ ${odd2(l.real)} (modelo ${pct0(l.p)})`
    );
    return `Múltipla (${built.legs.length} pernas) — odd ${odd2(built.odd)}\n${lines.join("\n")}`;
  };

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(slipText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
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
            <span className="text-neutral-500">(sem limite)</span>
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

      {status === "done" && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-neutral-300">
              Múltipla sugerida · {built.legs.length} perna{built.legs.length === 1 ? "" : "s"}
            </h3>
            {built.legs.length > 0 && (
              <button type="button" onClick={copy} className="rounded-lg bg-neutral-800 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-700">
                {copied ? "Copiado ✓" : "Copiar boletim"}
              </button>
            )}
          </div>
          <p className="mb-3 text-[11px] text-neutral-500">
            {meta.fixturesTotal} jogos vistos · {meta.oddsTotal} com leitura de odds
            {meta.truncated ? " · limite de 60 leituras: alarga em fatias menores" : ""} · {priced.length} pernas com odd real
          </p>
          {built.legs.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-center text-xs text-neutral-500">
              Nenhuma perna cumpre os filtros (intervalos de odd e valor mínimo). Alarga os intervalos ou baixa o valor mín.
            </p>
          ) : (
            <>
              {built.legs.length < nLegs && (
                <p className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  Só {built.legs.length} perna{built.legs.length === 1 ? "" : "s"} cumpre(m) os filtros (pediste {nLegs}).
                </p>
              )}
              <div className="mb-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 rounded-lg bg-neutral-950 px-3 py-2">
                <p className="text-lg font-bold text-emerald-300">Odd {odd2(built.odd)}</p>
                <p className="text-xs text-neutral-400">
                  Modelo: <span className="font-medium text-neutral-200">{pct1(built.p)}</span> · justa{" "}
                  <span className="font-medium text-neutral-200">{odd2(built.fair)}</span> · valor médio{" "}
                  <span className="font-medium text-emerald-400">+{pct1(built.avgEdge)}</span>
                </p>
              </div>
              <div className="space-y-1.5">
                {built.legs.map((l) => (
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
              <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
                Combinada assume pernas independentes (otimista se correlacionadas). As odds mexem — confirma na casa
                antes de apostar. Pernas com devolução seguem as regras da casa para múltiplas.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
