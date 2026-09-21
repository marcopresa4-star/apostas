"use client";

import { useEffect, useState } from "react";
import OddChecker, { type OddMarket } from "./OddChecker";
import { predictLive } from "@/lib/liveModel";
import { liveSummary } from "@/lib/liveSummary";
import { fairOdd } from "@/lib/footballModel";
import { formatOdd } from "@/lib/multiples";

const INPUT =
  "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-amber-500";
const dot = (n: number) => n.toFixed(1).replace(".", ",");
const pct = (p: number) => (p > 0 && p < 0.1 ? `${(p * 100).toFixed(1).replace(".", ",")}%` : `${Math.round(p * 100)}%`);
const oddText = (p: number) => (p >= 0.005 ? formatOdd(fairOdd(p)) : "—");

// Read a whole number, kept in range; anything else counts as `fallback`.
function whole(text: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function decimal(text: string, min: number, max: number, fallback: number): number {
  const n = Number.parseFloat(text.replace(",", "."));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

interface Row {
  label: string;
  p: number;
  note?: string;
}

function Table({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h3 className="mb-2 text-sm font-semibold text-neutral-300">{title}</h3>
      <div className="space-y-1.5 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-neutral-200">
              {row.label}
              {row.note && <span className="ml-1.5 text-[11px] text-neutral-500">{row.note}</span>}
            </span>
            <span className="flex shrink-0 items-center gap-3">
              <span className="w-12 text-right font-medium text-amber-300">{pct(row.p)}</span>
              <span className="w-14 text-right text-xs text-neutral-500">@{oddText(row.p)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// The odds of what is left of a game in progress, updated as the minute and the
// score are typed. `lambdaHome` / `lambdaAway` are the goals each side was
// expected to score in the whole game; they can be edited, so it also works for
// a game the data does not cover.
export default function LiveCalculator({
  home,
  away,
  lambdaHome,
  lambdaAway,
  firstHalfShare,
  fromModel,
}: {
  home: string;
  away: string;
  lambdaHome: number;
  lambdaAway: number;
  firstHalfShare: number;
  // Whether the expected goals came from the two teams chosen (or are typical figures).
  fromModel: boolean;
}) {
  const [minute, setMinute] = useState("60");
  // The minute can move on by itself, one every real minute; it starts over from
  // whatever is typed, so the clock keeps in step when it is corrected by hand.
  const [running, setRunning] = useState(false);
  const [sync, setSync] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setMinute((current) => String(Math.min(120, whole(current, 0, 120, 0) + 1))), 60_000);
    return () => clearInterval(id);
  }, [running, sync]);
  const setMinuteByHand = (value: string) => {
    setMinute(value);
    setSync((n) => n + 1);
  };
  const [homeGoals, setHomeGoals] = useState("0");
  const [awayGoals, setAwayGoals] = useState("0");
  const [lh, setLh] = useState(dot(lambdaHome));
  const [la, setLa] = useState(dot(lambdaAway));

  const m = whole(minute, 0, 120, 0);
  const h = whole(homeGoals, 0, 20, 0);
  const a = whole(awayGoals, 0, 20, 0);
  const expectedHome = decimal(lh, 0.05, 6, lambdaHome);
  const expectedAway = decimal(la, 0.05, 6, lambdaAway);

  const p = predictLive({
    lambdaHome: expectedHome,
    lambdaAway: expectedAway,
    firstHalfShare,
    minute: m,
    homeGoals: h,
    awayGoals: a,
  });

  const total = h + a;
  const homeName = home || "Casa";
  const awayName = away || "Fora";

  // "More than X,5 goals" only for the lines still open, with how many are missing.
  const goalRows: Row[] = [];
  for (let k = 0; k < 4; k++) {
    const line = total + k + 0.5;
    const over = p.over[String(line)];
    goalRows.push(
      { label: `Mais de ${dot(line)} golos`, p: over, note: `faltam ${k + 1}` },
      { label: `Menos de ${dot(line)} golos`, p: 1 - over }
    );
  }
  const bothDone = h > 0 && a > 0;

  const groups: { title: string; rows: Row[] }[] = [
    {
      title: "Resultado final",
      rows: [
        { label: `${homeName} vence`, p: p.fullTime.home },
        { label: "Empate", p: p.fullTime.draw },
        { label: `${awayName} vence`, p: p.fullTime.away },
        { label: `${homeName} ou empate (1X)`, p: p.fullTime.home + p.fullTime.draw },
        { label: `${awayName} ou empate (X2)`, p: p.fullTime.away + p.fullTime.draw },
      ],
    },
    { title: "Golos até ao fim", rows: goalRows },
    {
      title: "Ambas marcam",
      rows: [
        { label: "Sim", p: p.bothScore, note: bothDone ? "já marcaram os dois" : undefined },
        { label: "Não", p: 1 - p.bothScore },
      ],
    },
    {
      title: "Próximo golo",
      rows: [
        { label: `${homeName}`, p: p.nextGoal.home },
        { label: `${awayName}`, p: p.nextGoal.away },
        { label: "Nenhum até ao fim", p: p.nextGoal.none },
      ],
    },
  ];
  const oddMarkets: OddMarket[] = groups.flatMap((g) => g.rows.map((r) => ({ group: g.title, label: r.label, p: r.p })));

  const step = (setter: (v: string) => void, current: number, by: number, min: number, max: number) =>
    setter(String(Math.min(max, Math.max(min, current + by))));
  const button =
    "rounded-lg bg-neutral-800 px-3 py-2 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-700";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-sm">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_2fr]">
          <div>
            <label className="mb-1 block text-sm text-neutral-300">Minuto</label>
            <div className="flex gap-2">
              <button type="button" className={button} onClick={() => step(setMinuteByHand, m, -1, 0, 120)} aria-label="Menos um minuto">
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="120"
                value={minute}
                onChange={(e) => setMinuteByHand(e.target.value)}
                className={`${INPUT} text-center`}
              />
              <button type="button" className={button} onClick={() => step(setMinuteByHand, m, 1, 0, 120)} aria-label="Mais um minuto">
                +
              </button>
            </div>
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-neutral-400">
              <input
                type="checkbox"
                checked={running}
                onChange={(e) => {
                  setRunning(e.target.checked);
                  setSync((n) => n + 1);
                }}
                className="accent-amber-500"
              />
              Deixar o minuto andar sozinho
            </label>
            {running && (
              <p className="mt-1 text-[11px] leading-snug text-amber-400/90">
                Sobe um minuto por minuto real. Não sabe do intervalo: desliga aos 45&apos; e volta a ligar quando a
                2.ª parte começar (com o minuto 46).
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm text-neutral-300">Resultado</label>
            <div className="flex items-center gap-2">
              <span className="hidden min-w-0 flex-1 truncate text-right text-sm text-neutral-300 sm:block">{homeName}</span>
              <button type="button" className={button} onClick={() => step(setHomeGoals, h, -1, 0, 20)} aria-label={`Menos um golo ${homeName}`}>
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="20"
                value={homeGoals}
                onChange={(e) => setHomeGoals(e.target.value)}
                className={`${INPUT} w-16 text-center`}
              />
              <button type="button" className={button} onClick={() => step(setHomeGoals, h, 1, 0, 20)} aria-label={`Mais um golo ${homeName}`}>
                +
              </button>
              <span className="px-1 text-neutral-500">–</span>
              <button type="button" className={button} onClick={() => step(setAwayGoals, a, -1, 0, 20)} aria-label={`Menos um golo ${awayName}`}>
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="20"
                value={awayGoals}
                onChange={(e) => setAwayGoals(e.target.value)}
                className={`${INPUT} w-16 text-center`}
              />
              <button type="button" className={button} onClick={() => step(setAwayGoals, a, 1, 0, 20)} aria-label={`Mais um golo ${awayName}`}>
                +
              </button>
              <span className="hidden min-w-0 flex-1 truncate text-sm text-neutral-300 sm:block">{awayName}</span>
            </div>
            <p className="mt-1 text-center text-[11px] text-neutral-500 sm:hidden">
              {homeName} – {awayName}
            </p>
          </div>
        </div>

        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium text-amber-400 hover:underline">
            Golos esperados antes do jogo: {dot(expectedHome)} – {dot(expectedAway)}
            {fromModel ? " (do modelo)" : " (valores típicos)"}
          </summary>
          <div className="mt-3 grid max-w-md grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-neutral-400">{homeName}</label>
              <input type="text" inputMode="decimal" value={lh} onChange={(e) => setLh(e.target.value)} className={INPUT} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-400">{awayName}</label>
              <input type="text" inputMode="decimal" value={la} onChange={(e) => setLa(e.target.value)} className={INPUT} />
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
            {fromModel
              ? "Vêm da comparação das duas equipas, sem ajustes. Podes mudá-los se souberes mais (uma lesão, um jogo que se sabe aberto)."
              : "Sem equipas escolhidas, usam-se valores típicos de uma liga (1,4 e 1,1). Muda-os para o jogo que estás a ver: uma equipa muito superior tem mais golos esperados, e um jogo fechado menos."}
          </p>
        </details>

        <p className="mt-3 text-xs text-neutral-400">
          Ainda se esperam <span className="font-medium text-neutral-200">{dot(p.remainingHome + p.remainingAway)}</span>{" "}
          golos ({dot(p.remainingHome)} de {homeName}, {dot(p.remainingAway)} de {awayName}).
        </p>
      </div>

      <div className="rounded-2xl border border-amber-800/50 bg-amber-950/20 p-5">
        <h3 className="mb-2 text-sm font-semibold text-amber-300">O que ainda pode acontecer</h3>
        <ul className="list-disc space-y-1.5 pl-4 text-sm leading-relaxed text-neutral-200 marker:text-neutral-600">
          {liveSummary(p, { home: homeName, away: awayName, minute: m, homeGoals: h, awayGoals: a }).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {groups.map((g) => (
          <Table key={g.title} title={g.title} rows={g.rows} />
        ))}
      </div>

      <OddChecker markets={oddMarkets} />

      <p className="text-xs leading-relaxed text-neutral-500">
        Parte dos golos que cada equipa devia marcar no jogo todo e tira a parte que já passou, dando mais peso à 2.ª
        parte, onde há mais golos. Conta o resultado (quem está a ganhar marca menos, quem está a perder ou empatado
        marca mais) e que os golos são mais regulares do que o acaso puro. Foi medido em 4.431 jogos e testado ao{" "}
        <span className="text-neutral-400">intervalo</span> em 2.220 jogos de 2025/26 que não usei para o medir: a
        probabilidade de &quot;mais um golo até ao fim&quot; previu 86,2% e aconteceu 86,0%, e em quem ganha e em ambas
        marcam bateu a média histórica. <span className="text-amber-400">A outros minutos não consigo testar</span>, porque
        os dados não têm o minuto dos golos: aí é uma extrapolação razoável e mais nada. Não sabe de cartões vermelhos,
        lesões nem do ritmo do jogo.
      </p>
    </div>
  );
}
