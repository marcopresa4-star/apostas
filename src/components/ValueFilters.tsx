"use client";

import { useState } from "react";
import { VALUE_MARKETS } from "@/lib/valueMarkets";

// Fully interactive filters: every choice reflects instantly (the old
// server-rendered radios only restyled after submitting, looking dead).
// Submit is still a plain GET, so results stay linkable.
export default function ValueFilters({
  leagues,
  initial,
}: {
  leagues: { code: string; label: string }[];
  initial: {
    ligas: string[];
    mercados: string[];
    edge: number;
    oddmax: string;
    conf: string;
    datas: string;
  };
}) {
  const [ligas, setLigas] = useState<string[]>(initial.ligas);
  const [mercados, setMercados] = useState<string[]>(initial.mercados);
  const [edge, setEdge] = useState<number>(initial.edge);
  const [oddmax, setOddmax] = useState<string>(initial.oddmax);
  const [conf, setConf] = useState<string>(initial.conf);
  const [datas, setDatas] = useState<string>(initial.datas);
  const [openComp, setOpenComp] = useState(false);

  const pill = (on: boolean) =>
    `inline-flex cursor-pointer items-center rounded-full border px-3 py-1.5 text-xs font-medium transition ${on ? "border-amber-500/50 bg-amber-500/15 text-amber-300" : "border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"}`;
  const chip =
    "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-neutral-800 px-2.5 py-1.5 text-xs text-neutral-300 transition hover:border-neutral-600";
  const toggle = (list: string[], v: string, set: (l: string[]) => void) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const groups = ["Resultado", "Golos", "Por equipa"] as const;

  return (
    <form method="get" action="/value" className="mb-4 max-w-4xl rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
      <input type="hidden" name="analisar" value="1" />
      <div className="space-y-5">
        <div>
          <button
            type="button"
            onClick={() => setOpenComp((o) => !o)}
            className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400 hover:text-neutral-200"
          >
            {openComp ? "▾" : "▸"} Competições ({ligas.length} de {leagues.length})
          </button>
          {openComp && (
            <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950 p-3">
              {leagues.map((l) => (
                <label key={l.code} className={chip}>
                  <input
                    type="checkbox"
                    name="ligas"
                    value={l.code}
                    checked={ligas.includes(l.code)}
                    onChange={() => toggle(ligas, l.code, setLigas)}
                    className="accent-amber-500"
                  />
                  {l.label}
                </label>
              ))}
            </div>
          )}
          {!openComp && ligas.map((c) => <input key={c} type="hidden" name="ligas" value={c} />)}
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Mercados ({mercados.length} selecionados)
          </p>
          {groups.map((g) => (
            <div key={g} className="mb-2">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{g}</p>
              <div className="flex flex-wrap gap-1.5">
                {VALUE_MARKETS.filter((m) => m.group === g).map((m) =>
                  m.disabled ? (
                    <span
                      key={m.key}
                      title={m.disabled}
                      className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-neutral-800/60 px-2.5 py-1.5 text-xs text-neutral-600"
                    >
                      {m.label} · {m.disabled}
                    </span>
                  ) : (
                    <label key={m.key} className={chip}>
                      <input
                        type="checkbox"
                        name="mercados"
                        value={m.key}
                        checked={mercados.includes(m.key)}
                        onChange={() => toggle(mercados, m.key, setMercados)}
                        className="accent-amber-500"
                      />
                      {m.label}
                    </label>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Edge mínimo (EV)</p>
            <div className="flex flex-wrap gap-1.5">
              {[3, 5, 8, 10].map((e) => (
                <label key={e} className={pill(edge === e / 100)}>
                  <input type="radio" name="edge" value={String(e)} checked={edge === e / 100} onChange={() => setEdge(e / 100)} className="sr-only" />
                  +{e}%
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Odd máxima</p>
            <div className="flex flex-wrap gap-1.5">
              {["1.8", "2.5", "3", "5"].map((o) => (
                <label key={o} className={pill(oddmax === o)}>
                  <input type="radio" name="oddmax" value={o} checked={oddmax === o} onChange={() => setOddmax(o)} className="sr-only" />
                  {o.replace(".", ",")}
                </label>
              ))}
              <label className={pill(oddmax === "")}>
                <input type="radio" name="oddmax" value="" checked={oddmax === ""} onChange={() => setOddmax("")} className="sr-only" />
                Sem limite
              </label>
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Confiança mínima</p>
            <div className="flex flex-wrap gap-1.5">
              {[
                { v: "qualquer", l: "Qualquer" },
                { v: "media", l: "Média+ (5+ jogos)" },
                { v: "alta", l: "Alta (12+ jogos)" },
              ].map((c) => (
                <label key={c.v} className={pill(conf === c.v)}>
                  <input type="radio" name="conf" value={c.v} checked={conf === c.v} onChange={() => setConf(c.v)} className="sr-only" />
                  {c.l}
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Datas</p>
            <div className="flex flex-wrap gap-1.5">
              {[
                { v: "hoje", l: "Hoje" },
                { v: "amanha", l: "Amanhã" },
                { v: "7d", l: "Próx. 7 dias" },
                { v: "14d", l: "Próx. 14 dias" },
              ].map((d) => (
                <label key={d.v} className={pill(datas === d.v)}>
                  <input type="radio" name="datas" value={d.v} checked={datas === d.v} onChange={() => setDatas(d.v)} className="sr-only" />
                  {d.l}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div>
          <button
            type="submit"
            className="rounded-lg bg-amber-600 px-5 py-2 text-sm font-medium text-white shadow-lg shadow-amber-600/20 transition hover:bg-amber-500"
          >
            Analisar jogos
          </button>
          <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
            Só contam jogos com odds reais da casa (regra geral, poucos dias antes do jogo) e equipas com 5+ jogos nos
            dados. A primeira análise demora minutos em cache fria; depois é rápido.
          </p>
        </div>
      </div>
    </form>
  );
}
