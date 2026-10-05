"use client";

import { useState } from "react";
import type { OddMarket } from "./OddChecker";
import { formatOdd } from "@/lib/multiples";

// Same-game multiple builder: combine 2-4 legs of this game into one bet.
// The combined chance assumes independence (legs hit together as p1 * p2...).
export default function MultipleBuilder({ markets }: { markets: OddMarket[] }) {
  // Pushes (refunds) break the simple product, so only clean win/lose legs count.
  const eligible = markets.filter((m) => m.key && (m.push ?? 0) < 0.005 && m.p > 0 && m.p < 1);
  const idOf = (m: OddMarket) => `${m.group}|${m.label}`;
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState("");

  const toggle = (id: string) =>
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 4 ? prev : [...prev, id]
    );
  const legs = eligible.filter((m) => picked.includes(idOf(m)));
  // Independence: every leg must hit, so chances multiply.
  const p = legs.reduce((acc, m) => acc * m.p, 1);
  const fair = legs.length >= 2 ? 1 / p : Infinity;
  const odd = Number(text.replace(",", "."));
  const valid = Number.isFinite(odd) && odd > 1;
  const value = valid && legs.length >= 2 ? p * odd - 1 : null;
  const percent = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")}%`;
  const groups = [...new Set(eligible.map((m) => m.group))];

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h3 className="mb-1 text-sm font-semibold text-neutral-300">Múltipla do mesmo jogo</h3>
      <p className="mb-3 text-xs text-neutral-500">Escolhe 2 a 4 pernas deste jogo para combinar.</p>

      <div className="space-y-3">
        {groups.map((group) => (
          <div key={group}>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{group}</p>
            <div className="space-y-1.5">
              {eligible
                .filter((m) => m.group === group)
                .map((m) => {
                  const id = idOf(m);
                  const on = picked.includes(id);
                  const full = picked.length >= 4 && !on;
                  return (
                    <label
                      key={id}
                      className={`flex cursor-pointer items-center gap-2 text-sm ${full ? "opacity-40" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={full}
                        onChange={() => toggle(id)}
                        className="h-4 w-4 accent-emerald-500"
                      />
                      <span className="min-w-0 flex-1 truncate text-neutral-200">{m.label}</span>
                      <span className="shrink-0 text-xs text-neutral-500">
                        {percent(m.p)} · @{formatOdd(1 / m.p)}
                      </span>
                    </label>
                  );
                })}
            </div>
          </div>
        ))}
      </div>

      {legs.length >= 2 ? (
        <div className="mt-3 border-t border-neutral-800 pt-3 text-sm text-neutral-300">
          <p>
            Modelo: <span className="font-medium text-neutral-100">{percent(p)}</span> · odd justa{" "}
            <span className="font-medium text-emerald-300">{formatOdd(fair)}</span>{" "}
            <span className="text-xs text-neutral-500">
              ({legs.map((l) => l.label).join(" + ")})
            </span>
          </p>
          <input
            type="text"
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Odd combinada da casa (ex: 3,50)"
            className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-emerald-500"
          />
          {valid && value !== null && (
            <>
              <p className="mt-1 text-sm">
                A odd {formatOdd(odd)} implica{" "}
                <span className="font-medium text-neutral-100">{percent(1 / odd)}</span>.
              </p>
              <p className={`mt-1 font-medium ${value >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {value >= 0
                  ? `Segundo o modelo compensa: +${percent(value)} em média por unidade apostada.`
                  : `Segundo o modelo não compensa: ${percent(value)} em média por unidade apostada.`}
              </p>
            </>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-neutral-500">
          Escolhidas {picked.length} de 2 a 4 pernas.
        </p>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
        Atenção: pernas do mesmo jogo estão ligadas (vitória com mais golos, ambas marcam com mais golos), por isso
        multiplicar as chances sobrestima a chance real e a odd justa fica otimista. Metades e combinados sobrepõem-se
        por construção.
      </p>
    </div>
  );
}
