"use client";

import { useState } from "react";
import { formatOdd } from "@/lib/multiples";

export interface OddMarket {
  group: string;
  label: string;
  p: number;
  // The model's market key ("home", "over:2.5", "btts:yes", "next:home"...):
  // when the bookmaker's real odd for it is known, it is priced automatically.
  key?: string;
}

// Type the odd a bookmaker offers for one of the markets and see how it
// compares with the model: the chance the odd implies against the model's, and
// how much a bet at that odd would win or lose on average. `realByKey` fills
// the comparison in by itself wherever the real odd is known.
export default function OddChecker({ markets, realByKey, realOpenByKey }: { markets: OddMarket[]; realByKey?: Record<string, number>; realOpenByKey?: Record<string, number> }) {
  // The chosen market is kept by its name: the list can change under it (the
  // live calculator's lines move with the score).
  const [chosen, setChosen] = useState<string | null>(null);
  const [text, setText] = useState("");

  const index = Math.max(0, markets.findIndex((m) => `${m.group}|${m.label}` === chosen));
  const market = markets[index];
  const odd = Number(text.replace(",", "."));
  const valid = Number.isFinite(odd) && odd > 1;
  // Average result of a 1 unit bet: win (odd - 1) with chance p, lose 1 otherwise.
  const value = valid ? market.p * odd - 1 : null;
  // The bookmaker's real odd for this market, when it was read (live or
  // pre-match): priced without typing anything.
  const real = market.key && realByKey ? realByKey[market.key] : undefined;
  const realValue = real !== undefined ? market.p * real - 1 : null;
  const open = market.key && realOpenByKey ? realOpenByKey[market.key] : undefined;
  const movement =
    open !== undefined && real !== undefined && open > 1 && real > 1
      ? ((open - real) / open) * 100
      : null;

  const groups = [...new Set(markets.map((m) => m.group))];
  const percent = (p: number) => `${(p * 100).toFixed(1).replace(".", ",")}%`;

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h3 className="mb-1 text-sm font-semibold text-neutral-300">Comparar com a odd da casa</h3>
      <p className="mb-3 text-xs text-neutral-500">
        {realByKey && Object.keys(realByKey).length > 0
          ? "Odds reais lidas da casa (comparação automática). Para outra odd, escolhe o mercado e escreve-a."
          : "Escolhe o mercado e escreve a odd que a casa de apostas oferece."}
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
        <select
          value={index}
          onChange={(e) => setChosen(`${markets[Number(e.target.value)].group}|${markets[Number(e.target.value)].label}`)}
          className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-amber-500"
        >
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              {markets.map((m, i) =>
                m.group === group ? (
                  <option key={i} value={i}>
                    {m.label}
                  </option>
                ) : null
              )}
            </optgroup>
          ))}
        </select>
        <input
          type="text"
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ex: 1.85"
          className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-amber-500"
        />
      </div>

      <div className="mt-3 text-sm text-neutral-300">
        <p>
          Modelo: <span className="font-medium text-neutral-100">{percent(market.p)}</span>{" "}
          · odd justa{" "}
          <span className="font-medium text-neutral-100">{formatOdd(1 / market.p)}</span>
        </p>
        {real !== undefined && realValue !== null && (
          <p className="mt-1">
            Na casa: <span className="font-medium text-neutral-100">{formatOdd(real)}</span> (implica{" "}
            {percent(1 / real)}) ·{" "}
            <span className={`font-medium ${realValue >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {realValue >= 0
                ? `compensa: +${percent(realValue)} em média`
                : `não compensa: ${percent(realValue)} em média`}
            </span>
            {movement !== null && open !== undefined && Math.abs(movement) >= 3 && (
              <span className="text-neutral-500">
                {" "}· abriu {formatOdd(open)} {movement > 0 ? "↘" : "↗"} {Math.abs(Math.round(movement))}%
              </span>
            )}
          </p>
        )}
        {valid && value !== null && (
          <>
            <p className="mt-1">
              A odd {formatOdd(odd)} implica{" "}
              <span className="font-medium text-neutral-100">{percent(1 / odd)}</span>.
            </p>
            <p
              className={`mt-1 font-medium ${value >= 0 ? "text-emerald-400" : "text-red-400"}`}
            >
              {value >= 0
                ? `Segundo o modelo compensa: +${percent(value)} em média por unidade apostada.`
                : `Segundo o modelo não compensa: ${percent(value)} em média por unidade apostada.`}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
