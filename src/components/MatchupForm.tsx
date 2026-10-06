"use client";

import { useRef, useState } from "react";
import { EFFECTS } from "@/lib/adjustments";
import { NEUTRAL_WEIGHTS } from "@/lib/modelWeights";
import type { ExtraGame } from "@/lib/extraGames";
import ExtraGames from "./ExtraGames";

const SELECT =
  "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-emerald-500";

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

// One model-weight slider: uncontrolled (the form submits natively), with a
// live readout beside it. Neutral = the fitted model, reproduced exactly.
function WeightSlider({
  name,
  label,
  minLabel,
  maxLabel,
  hint,
  raw,
  neutral,
}: {
  name: string;
  label: string;
  minLabel: string;
  maxLabel: string;
  hint: string;
  raw: string | undefined;
  neutral: number;
}) {
  const start = raw !== undefined && raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : neutral;
  const [v, setV] = useState(start);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={`peso-${name}`} className="text-sm font-medium text-neutral-200">
          {label}
        </label>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-emerald-300">{v}</span>
      </div>
      <input
        id={`peso-${name}`}
        type="range"
        name={name}
        min={0}
        max={100}
        step={1}
        defaultValue={start}
        onInput={(e) => setV(Number((e.target as HTMLInputElement).value))}
        className="w-full accent-emerald-500"
      />
      <div className="flex justify-between text-[11px] text-neutral-500">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
      <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-500">{hint}</p>
    </div>
  );
}

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
  restAuto,
  extras,
  matchDate,
  scheduledDate,
  pesos,
  pesosAtivos,
  resetPesosHref,
  international = false,
  neutral = false,
}: {
  leagues: readonly { code: string; label: string }[];
  liga: string;
  teams: string[];
  casa: string;
  fora: string;
  adjust: AdjustValues;
  // What the data says about each team's last game, to help fill in the rest days.
  restHint: { casa: string; fora: string };
  // The days of rest worked out for the game's date, if it is known.
  restAuto: { casa: number | null; fora: number | null };
  // Games of other competitions typed in by hand, for each team.
  extras: { casa: ExtraGame[]; fora: ExtraGame[] };
  // The date of the game as asked for, and the one the calendar gives for these
  // two teams (used when none was asked for).
  matchDate: string;
  scheduledDate: string;
  // Model weights as they came in the address ("" = neutral default), whether
  // any is active, and where "Repor predefinições" points (same page without
  // them). Clubs only: national sides have their own model.
  pesos: Record<string, string>;
  pesosAtivos: boolean;
  resetPesosHref: string;
  // National teams: they can meet at a neutral venue, and there is no home/away form.
  international?: boolean;
  neutral?: boolean;
}) {
  const hasAdjust =
    pesosAtivos ||
    Object.values(adjust).some((v) => v !== "" && v !== "0" && v !== "normal") ||
    extras.casa.length > 0 ||
    extras.fora.length > 0 ||
    matchDate !== "";
  const formRef = useRef<HTMLFormElement>(null);

  // What is picked right now in the two team boxes, which may differ from the
  // teams the page was last calculated for (nothing is calculated until the
  // button is pressed, so adjustments can be filled in first). The rest hints
  // and the game's date from the calendar belong to the calculated teams, so
  // they are only shown while the two match.
  const [pick, setPick] = useState({ casa, fora });
  const fresh = pick.casa === casa && pick.fora === fora;
  const dateShown = matchDate || (fresh ? scheduledDate : "");
  const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

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
              <label className="mb-1 block text-sm text-neutral-300">
                {international ? "Seleção da casa (ou a primeira)" : "Equipa da casa"}
              </label>
              <select
                key={`casa-${liga}`}
                name="casa"
                defaultValue={casa}
                onChange={(e) => setPick((p) => ({ ...p, casa: e.target.value }))}
                className={SELECT}
              >
                <option value="">Escolhe a equipa...</option>
                {teams.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-neutral-300">
                {international ? "Seleção de fora (ou a segunda)" : "Equipa de fora"}
              </label>
              <select
                key={`fora-${liga}`}
                name="fora"
                defaultValue={fora}
                onChange={(e) => setPick((p) => ({ ...p, fora: e.target.value }))}
                className={SELECT}
              >
                <option value="">Escolhe a equipa...</option>
                {teams.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {international && (
            <label className="flex cursor-pointer items-start gap-2 text-sm text-neutral-300">
              <input type="checkbox" name="neutro" value="1" defaultChecked={neutral} className="mt-1 accent-emerald-500" />
              <span>
                Campo neutro
                <span className="block text-[11px] text-neutral-500">
                  Mundial, fases finais e jogos num país que não é o de nenhuma das duas: ninguém joga em casa.
                </span>
              </span>
            </label>
          )}
          <details open={hasAdjust} className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-emerald-400">
              Ajustes (opcional): lesões, castigos, descanso e motivação
            </summary>

            <div className="mt-3 max-w-xs">
              <label className="mb-1 block text-sm text-neutral-300">Data do jogo</label>
              <input
                type="date"
                name="data_jogo"
                defaultValue={matchDate}
                className={SELECT}
              />
              <p className="mt-1 text-[11px] text-neutral-500">
                {matchDate
                  ? ""
                  : !fresh
                    ? "Em branco: usa-se a data do calendário da liga. Clica em Calcular para a ver para estas equipas. "
                    : scheduledDate
                      ? `Em branco: usa-se a data do calendário da liga (${dayMonth(scheduledDate)}). `
                      : "Estas duas equipas não se defrontam no calendário da liga: sem data, o descanso não é calculado sozinho. "}
                Com a data, os dias de descanso calculam-se sozinhos a partir do último jogo de cada equipa, em
                todas as competições, ou dos que acrescentares abaixo.
              </p>
            </div>

            <div className="mt-4 grid grid-cols-[1fr_1fr_1fr] items-start gap-x-3 gap-y-3 text-sm">
              <span />
              <span className="truncate text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {pick.casa || "Casa"}
              </span>
              <span className="truncate text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {pick.fora || "Fora"}
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

              <span className="pt-2 text-neutral-300">
                Dias de descanso
                {dateShown && (
                  <span className="block text-[11px] text-neutral-500">até ao jogo de {dayMonth(dateShown)}</span>
                )}
              </span>
              <div>
                <input
                  type="number"
                  name="descanso_casa"
                  min="0"
                  max="30"
                  defaultValue={adjust.descanso_casa}
                  placeholder={fresh && restAuto.casa !== null ? `auto: ${restAuto.casa}` : "?"}
                  className={SELECT}
                />
                {fresh && restHint.casa && <p className="mt-1 text-[11px] text-neutral-500">{restHint.casa}</p>}
              </div>
              <div>
                <input
                  type="number"
                  name="descanso_fora"
                  min="0"
                  max="30"
                  defaultValue={adjust.descanso_fora}
                  placeholder={fresh && restAuto.fora !== null ? `auto: ${restAuto.fora}` : "?"}
                  className={SELECT}
                />
                {fresh && restHint.fora && <p className="mt-1 text-[11px] text-neutral-500">{restHint.fora}</p>}
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

            {!international && (
              <div className="mt-5 space-y-5 border-t border-neutral-800 pt-4">
                <p className="text-sm font-medium text-neutral-200">Pesos do modelo</p>
                <p className="-mt-3 text-[11px] leading-relaxed text-neutral-500">
                  Afinam os golos esperados depois do ajuste. Em neutro, a previsão sai exatamente igual à de
                  sempre. Só o peso da forma foi testado (piorou); o resto são heurísticas por testar, como as
                  lesões.
                </p>
                <WeightSlider
                  name="w_ataque"
                  label="Equilíbrio de ataque"
                  minLabel="Só defesa do adversário"
                  maxLabel="Só ataque próprio"
                  hint="Equilíbrio entre a média de golos marcados de uma equipa e a média de golos sofridos do adversário."
                  raw={pesos.w_ataque}
                  neutral={NEUTRAL_WEIGHTS.attack}
                />
                <WeightSlider
                  name="w_casa"
                  label="Vantagem em casa"
                  minLabel="Desvantagem"
                  maxLabel="Super vantagem"
                  hint="Aumenta os golos esperados da equipa da casa / penaliza os da equipa visitante."
                  raw={pesos.w_casa}
                  neutral={NEUTRAL_WEIGHTS.homeAdv}
                />
                <div>
                  <WeightSlider
                    name="w_local"
                    label="Forma por local"
                    minLabel="Só forma geral"
                    maxLabel="Só específica do local"
                    hint="Combina a forma geral com as médias específicas de casa/fora de cada equipa."
                    raw={pesos.w_local}
                    neutral={NEUTRAL_WEIGHTS.venue}
                  />
                  <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
                    Testei isto nos jogos de 2025/26 das 7 maiores ligas e{" "}
                    <span className="text-emerald-400">piorou</span> a previsão de quem ganha, mais quanto maior o
                    peso (acerto de 55,1% a 0%, 54,9% a 25%, 54,5% a 50% e 54,3% a 100%): a diferença entre casa e
                    fora é, em grande parte, ruído. Só a Espanha melhorou um pouco. Usa só se souberes porque é que
                    esta equipa é diferente.
                  </p>
                </div>
                <WeightSlider
                  name="w_hist"
                  label="Combinação com taxa histórica"
                  minLabel="Só modelo"
                  maxLabel="Só taxa histórica"
                  hint="Puxa os golos esperados para a média de golos da liga."
                  raw={pesos.w_hist}
                  neutral={NEUTRAL_WEIGHTS.historic}
                />
                <WeightSlider
                  name="w_class"
                  label="Diferença na classificação"
                  minLabel="Sem ajuste"
                  maxLabel="Ajuste máximo"
                  hint="Ajusta pelos lugares na tabela oficial (sem tabela oficial, não faz nada)."
                  raw={pesos.w_class}
                  neutral={NEUTRAL_WEIGHTS.standings}
                />
                <WeightSlider
                  name="w_sot"
                  label="Regressão para remates à baliza"
                  minLabel="Só média de golos"
                  maxLabel="Só remates à baliza"
                  hint="Pesa mais quem cria (remates à baliza) contra quem concretiza (golos)."
                  raw={pesos.w_sot}
                  neutral={NEUTRAL_WEIGHTS.sot}
                />
                <WeightSlider
                  name="w_rec"
                  label="Peso pela recência"
                  minLabel="Todos os jogos iguais"
                  maxLabel="Só o jogo mais recente"
                  hint="Memória curta (só o recente) ou longa (quase todos iguais); a meio, o decaimento de sempre."
                  raw={pesos.w_rec}
                  neutral={NEUTRAL_WEIGHTS.recency}
                />
                <WeightSlider
                  name="w_h2h"
                  label="Combinação com confrontos diretos"
                  minLabel="Ignorar confrontos diretos"
                  maxLabel="Só confrontos diretos"
                  hint="Com poucos confrontos, conta quase só o modelo."
                  raw={pesos.w_h2h}
                  neutral={NEUTRAL_WEIGHTS.h2h}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm text-neutral-300">Estilo da equipa da casa</label>
                    <select name="estilo_casa" defaultValue={pesos.estilo_casa || "equilibrado"} className={SELECT}>
                      <option value="ofensivo">Ofensivo</option>
                      <option value="equilibrado">Equilibrado</option>
                      <option value="defensivo">Defensivo</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-neutral-300">Estilo da equipa visitante</label>
                    <select name="estilo_fora" defaultValue={pesos.estilo_fora || "equilibrado"} className={SELECT}>
                      <option value="ofensivo">Ofensivo</option>
                      <option value="equilibrado">Equilibrado</option>
                      <option value="defensivo">Defensivo</option>
                    </select>
                  </div>
                </div>
                <p className="-mt-2 text-[11px] leading-relaxed text-neutral-500">
                  A tua leitura de como cada equipa aborda o jogo: jogo aberto sobe os golos dos dois lados.
                </p>
                <a href={resetPesosHref} className="inline-block text-xs font-medium text-emerald-400 hover:underline">
                  ↺ Repor predefinições
                </a>
              </div>
            )}

            <div className="mt-5 space-y-4 border-t border-neutral-800 pt-4">
              <div>
                <p className="text-sm font-medium text-neutral-300">Outros jogos das equipas</p>
                <p className="text-[11px] leading-relaxed text-neutral-500">
                  O descanso conta sozinho todas as competições (liga, taças e Europa). Acrescenta aqui amigáveis
                  ou jogos em falta para contarem no descanso, na forma e nas estatísticas da época.
                </p>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  {pick.casa || "Casa"}
                </p>
                <ExtraGames
                  key={`extra-casa-${liga}-${pick.casa}`}
                  name="extra_casa"
                  initial={pick.casa === casa ? extras.casa : []}
                />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  {pick.fora || "Fora"}
                </p>
                <ExtraGames
                  key={`extra-fora-${liga}-${pick.fora}`}
                  name="extra_fora"
                  initial={pick.fora === fora ? extras.fora : []}
                />
              </div>
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
            className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-500"
          >
            Calcular
          </button>
        </>
      )}
    </form>
  );
}
