"use client";

import { useRef } from "react";
import { EFFECTS } from "@/lib/adjustments";

const SELECT =
  "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-amber-500";

export interface AdjustValues {
  lesoes_casa: string;
  lesoes_fora: string;
  castigos_casa: string;
  castigos_fora: string;
  descanso_casa: string;
  descanso_fora: string;
  motivacao_casa: string;
  motivacao_fora: string;
  outro_casa: string;
  outro_fora: string;
}

const pct = (n: number) => String(Math.round(n * 1000) / 10).replace(".", ",");

// League and the two teams, sent as ordinary address parameters, so the result
// page can be reloaded or shared. Picking another league reloads the page
// straight away, since the teams to choose from depend on it.
export default function MatchupForm({
  leagues,
  liga,
  teams,
  casa,
  fora,
  adjust,
  restHint,
}: {
  leagues: readonly { code: string; label: string }[];
  liga: string;
  teams: string[];
  casa: string;
  fora: string;
  adjust: AdjustValues;
  // What the data says about each team's last game, to help fill in the rest days.
  restHint: { casa: string; fora: string };
}) {
  const hasAdjust = Object.values(adjust).some((v) => v !== "" && v !== "0" && v !== "normal");
  const formRef = useRef<HTMLFormElement>(null);

  function changeLeague() {
    const form = formRef.current;
    if (!form) return;
    // The old league's teams mean nothing in the new one.
    for (const name of ["casa", "fora"]) {
      const select = form.elements.namedItem(name);
      if (select instanceof HTMLSelectElement) select.value = "";
    }
    form.requestSubmit();
  }

  return (
    <form
      ref={formRef}
      method="get"
      action="/estatisticas"
      className="space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-sm"
    >
      <div>
        <label className="mb-1 block text-sm text-neutral-300">Liga</label>
        <select name="liga" defaultValue={liga} onChange={changeLeague} className={SELECT}>
          <option value="">Escolhe a liga...</option>
          {leagues.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      {teams.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-neutral-300">Equipa da casa</label>
              <select key={`casa-${liga}`} name="casa" defaultValue={casa} className={SELECT}>
                <option value="">Escolhe a equipa...</option>
                {teams.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-neutral-300">Equipa de fora</label>
              <select key={`fora-${liga}`} name="fora" defaultValue={fora} className={SELECT}>
                <option value="">Escolhe a equipa...</option>
                {teams.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <details open={hasAdjust} className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-amber-400">
              Ajustes (opcional): lesões, castigos, descanso e motivação
            </summary>

            <div className="mt-3 grid grid-cols-[1fr_1fr_1fr] items-start gap-x-3 gap-y-3 text-sm">
              <span />
              <span className="truncate text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {casa || "Casa"}
              </span>
              <span className="truncate text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {fora || "Fora"}
              </span>

              <span className="pt-2 text-neutral-300">Lesões (importantes)</span>
              <select name="lesoes_casa" defaultValue={adjust.lesoes_casa || "0"} className={SELECT}>
                {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <select name="lesoes_fora" defaultValue={adjust.lesoes_fora || "0"} className={SELECT}>
                {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>

              <span className="pt-2 text-neutral-300">Castigos (importantes)</span>
              <select name="castigos_casa" defaultValue={adjust.castigos_casa || "0"} className={SELECT}>
                {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <select name="castigos_fora" defaultValue={adjust.castigos_fora || "0"} className={SELECT}>
                {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>

              <span className="pt-2 text-neutral-300">Dias de descanso</span>
              <div>
                <input
                  type="number"
                  name="descanso_casa"
                  min="0"
                  max="30"
                  defaultValue={adjust.descanso_casa}
                  placeholder="?"
                  className={SELECT}
                />
                {restHint.casa && <p className="mt-1 text-[11px] text-neutral-500">{restHint.casa}</p>}
              </div>
              <div>
                <input
                  type="number"
                  name="descanso_fora"
                  min="0"
                  max="30"
                  defaultValue={adjust.descanso_fora}
                  placeholder="?"
                  className={SELECT}
                />
                {restHint.fora && <p className="mt-1 text-[11px] text-neutral-500">{restHint.fora}</p>}
              </div>

              <span className="pt-2 text-neutral-300">Motivação</span>
              <select name="motivacao_casa" defaultValue={adjust.motivacao_casa || "normal"} className={SELECT}>
                <option value="baixa">Baixa</option>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
              </select>
              <select name="motivacao_fora" defaultValue={adjust.motivacao_fora || "normal"} className={SELECT}>
                <option value="baixa">Baixa</option>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
              </select>

              <span className="pt-2 text-neutral-300">Outro ajuste (%)</span>
              <input
                type="number"
                name="outro_casa"
                min={-EFFECTS.maxOther}
                max={EFFECTS.maxOther}
                defaultValue={adjust.outro_casa}
                placeholder="0"
                className={SELECT}
              />
              <input
                type="number"
                name="outro_fora"
                min={-EFFECTS.maxOther}
                max={EFFECTS.maxOther}
                defaultValue={adjust.outro_fora}
                placeholder="0"
                className={SELECT}
              />
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
              Cada jogador importante que falta, por lesão ou castigo, tira {pct(EFFECTS.perAbsence)}% à força da
              equipa (até {EFFECTS.maxAbsences}). Com menos de {EFFECTS.fullRestDays} dias de descanso, cada dia a
              menos tira {pct(EFFECTS.perRestDayShort)}%. Motivação baixa tira {pct(1 - EFFECTS.lowMotivation)}% e
              alta soma {pct(EFFECTS.highMotivation - 1)}%. Só conta a diferença entre as duas equipas: o mesmo
              problema nas duas não muda nada. Estes valores são estimativas minhas, que não consegui testar com
              dados: se achares que uma lesão pesa mais ou menos, usa o &quot;Outro ajuste&quot;.
            </p>
          </details>

          <button
            type="submit"
            className="rounded-lg bg-amber-600 px-4 py-2 font-medium text-white shadow-lg shadow-amber-600/20 transition hover:bg-amber-500"
          >
            Calcular
          </button>
        </>
      )}
    </form>
  );
}
