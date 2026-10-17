"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import FavoriteButton from "@/components/FavoriteButton";
import { criterionLabel, type LiveTableDef } from "@/lib/planeamento";
import { diaMes } from "@/lib/assistente";
import type { ScanOutput } from "@/lib/planeamentoEngine";
import { deleteLiveTableAction } from "@/app/(app)/planeamento/actions";
import PlaneamentoEditor from "@/components/PlaneamentoEditor";

const FAVS_KEY = "apostas:favLeagues";
const MIN_KEY = "apostas:planMin";

function loadMin(): Set<string> {
  try {
    if (typeof window === "undefined") return new Set();
    const list: unknown = JSON.parse(window.localStorage.getItem(MIN_KEY) ?? "[]");
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function loadFavLabels(): string[] {
  try {
    const list: unknown = JSON.parse(window.localStorage.getItem(FAVS_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

type ScanState = { status: "idle" | "loading" | "ok" | "error"; data?: ScanOutput };

const num1 = (v: number): string => v.toFixed(1).replace(".", ",");

export default function PlaneamentoClient({
  tables,
  leagues,
  favIds,
}: {
  tables: LiveTableDef[];
  leagues: { code: string; label: string }[];
  favIds: number[];
}) {
  const router = useRouter();
  const [scans, setScans] = useState<Record<string, ScanState>>({});
  // Ordenação por cartão: "valor" (padrão, do melhor padrão para o pior) ou
  // "hora" (por pontapé de saída, para preparar a sessão).
  const [sorts, setSorts] = useState<Record<string, "valor" | "hora">>({});
  // Cartões minimizados (persistente neste browser). Hidrata após o mount (o
  // servidor não vê o localStorage: ler aqui dava mismatch).
  const [min, setMin] = useState<Set<string>>(new Set());
  useEffect(() => {
    // Sincroniza com o localStorage (sistema externo): única leitura segura
    // sem mismatch de hidratação.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMin(loadMin());
  }, []);

  const toggleMin = (table: LiveTableDef): void => {
    const minimized = !min.has(table.id);
    setMin((prev) => {
      const next = new Set(prev);
      if (minimized) next.add(table.id);
      else next.delete(table.id);
      try {
        window.localStorage.setItem(MIN_KEY, JSON.stringify([...next]));
      } catch {
        // Private mode: só nesta sessão.
      }
      return next;
    });
    // Expanding no longer starts a scan by itself: only an explicit Analisar
    // (or ↻) click does. Nothing analyses without being asked.
  };
  const [editing, setEditing] = useState<LiveTableDef | "new" | null>(null);
  const favSet = new Set(favIds);

  const scan = async (table: LiveTableDef, refresh = false) => {
    setScans((s) => ({ ...s, [table.id]: { status: "loading" } }));
    try {
      const res = await fetch("/api/planeamento/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ table, favLabels: loadFavLabels(), ...(refresh ? { refresh: true } : {}) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ScanOutput;
      setScans((s) => ({ ...s, [table.id]: { status: "ok", data } }));
    } catch {
      setScans((s) => ({ ...s, [table.id]: { status: "error" } }));
    }
  };

  // Sem arranque automático: cada tabela só analisa quando pedida (botão
  // Analisar, expandir ou ↻). Abrir a página passa a ser instantâneo.

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Apagar a tabela "${name}"?`)) return;
    await deleteLiveTableAction(id);
    router.refresh();
  };

  return (
    <div>
      <div className="mb-4">
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
        >
          + Nova tabela
        </button>
      </div>

      {tables.length === 0 && (
        <p className="max-w-4xl rounded-xl border border-dashed border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
          Ainda não tens tabelas. Cria a primeira: nome, padrão (cantos/golos/amarelos por intervalo) e as competições —
          eu vou buscar os jogos de hoje e amanhã que encaixem.
        </p>
      )}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
        {tables.map((t) => {
          const scanState = scans[t.id] ?? { status: "idle" as const };
          const data = scanState.data;
          const c0 = t.criteria[0];
          return (
            <section key={t.id} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-100">
                  {t.name}{" "}
                  <span className="ml-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-bold text-sky-300">
                    {data ? data.jogos.length : "…"}
                  </span>
                </h2>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleMin(t)}
                    title={min.has(t.id) ? "Expandir" : "Minimizar"}
                    className="text-xs text-neutral-500 transition hover:text-neutral-200"
                  >
                    {min.has(t.id) ? "+" : "–"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSorts((s) => ({ ...s, [t.id]: (s[t.id] ?? "valor") === "valor" ? "hora" : "valor" }))}
                    title={(sorts[t.id] ?? "valor") === "valor" ? "Ordenar por hora" : "Ordenar por valor"}
                    className="text-xs text-neutral-500 transition hover:text-neutral-200"
                  >
                    {(sorts[t.id] ?? "valor") === "valor" ? "⏱" : "⭐"}
                  </button>
                  <button
                    type="button"
                    onClick={() => scan(t, true)}
                    disabled={scanState.status === "loading"}
                    title="Voltar a analisar (força leitura fresca)"
                    className="text-xs text-neutral-500 transition hover:text-neutral-200 disabled:opacity-50"
                  >
                    ↻
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(t)}
                    className="text-xs font-medium text-sky-400 hover:underline"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(t.id, t.name)}
                    className="text-xs font-medium text-neutral-600 hover:text-red-300"
                  >
                    Apagar
                  </button>
                </div>
              </div>
              <div className="mb-3 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400">
                  {t.leaguesMode === "favs" ? "Ligas favoritas" : t.leaguesMode === "custom" ? `${t.leagues.length} ligas` : "Todas"}
                </span>
                <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400">
                  {t.sample === "season" ? "Época" : "Últimos 10"}
                  {t.venueSplit ? " · casa/fora" : ""}
                </span>
                {t.criteria.map((c) => (
                  <span key={c.id} className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                    {criterionLabel(c)}
                  </span>
                ))}
              </div>

              {!min.has(t.id) && scanState.status === "idle" && (
                <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-center text-xs text-neutral-500">
                  <button type="button" onClick={() => scan(t)} className="underline">
                    Analisar
                  </button>
                </p>
              )}
              {!min.has(t.id) && scanState.status === "loading" && (
                <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-8 text-center text-xs text-neutral-500">
                  A analisar os jogos… (a primeira vez demora: lê os lances dos jogos recentes)
                </p>
              )}
              {!min.has(t.id) && scanState.status === "error" && (
                <p className="rounded-xl border border-red-900/50 bg-red-950/20 px-4 py-6 text-center text-xs text-red-300">
                  Falhou a leitura. <button type="button" onClick={() => scan(t)} className="underline">Tentar de novo</button>
                </p>
              )}
              {!min.has(t.id) && scanState.status === "ok" && data && (
                <>
                  {data.jogos.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-center text-xs text-neutral-500">
                      Nenhum jogo de hoje/amanhã cumpre o padrão.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {((sorts[t.id] ?? "valor") === "hora"
                        ? [...data.jogos].sort((a, b) =>
                            `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`)
                          )
                        : data.jogos
                      ).map((g) => {
                        const e0 = g.evals[0];
                        const big = c0.agg === "avg" ? num1(e0.avg) : `${Math.round(e0.pct)}%`;
                        const sub =
                          c0.agg === "avg" ? `${Math.round(e0.pct)}% ${g.target}+` : `média ${num1(e0.avg)}`;
                        return (
                          <li
                            key={`${g.eventId}`}
                            className="flex items-center gap-3 rounded-xl border border-neutral-800/70 bg-neutral-950 px-3 py-2"
                          >
                            <span className="w-10 shrink-0 text-xs tabular-nums text-neutral-400">
                              {g.time ? g.time.slice(0, 5) : "—"}
                              <span className="block text-[10px] text-neutral-600">{diaMes(g.date)}</span>
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-medium text-neutral-100">
                                {g.home} <span className="font-normal text-neutral-500">vs</span> {g.away}
                              </span>
                              <span className="block truncate text-[10px] text-neutral-500">{g.league}</span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="block text-base font-bold tabular-nums text-emerald-400">{big}</span>
                              <span className="block text-[10px] tabular-nums text-neutral-500">{sub}</span>
                            </span>
                            <FavoriteButton
                              eventId={g.eventId}
                              home={g.home}
                              away={g.away}
                              tournament={g.league}
                              initial={favSet.has(g.eventId)}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <p className="mt-2 text-[11px] text-neutral-600">
                    {data.semDados > 0 && `${data.semDados} jogo${data.semDados === 1 ? "" : "s"} sem dados avançados ${data.semDados === 1 ? "ficou" : "ficaram"} de fora. `}
                    {data.truncated && "Limite de 40 jogos por análise. "}
                    {data.stale && "Scraper desligado — dados em cache."}
                  </p>
                </>
              )}
            </section>
          );
        })}
      </div>

      {editing && (
        <PlaneamentoEditor
          table={editing === "new" ? null : editing}
          leagues={leagues}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
