"use client";

export interface ValueItem {
  key: string;
  label: string;
  p: number;
  minOdd: number;
  real: number;
  why: string;
}

// Fixed floor, no typing: every priced market at 1.65+ that the model rates
// ≥35%, ranked by value (real/minimum).
const FLOOR = 1.65;

export default function ValueHunt({ items }: { items: ValueItem[] }) {
  const hits = items
    .filter((i) => i.real >= FLOOR && i.p >= 0.35)
    .sort((a, b) => b.real / b.minOdd - a.real / a.minOdd);
  if (hits.length === 0) return null;
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h3 className="mb-1 text-sm font-semibold text-neutral-300">Caça-valor (≥1,65)</h3>
      <p className="mb-2 text-[11px] text-neutral-500">
        Mercados com odd real a 1,65 ou acima e ≥35% do modelo. Só o que tem preço.
      </p>
      <ul className="space-y-2 text-xs tabular-nums">
        {hits.map((hit) => (
          <li key={hit.key}>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-neutral-300">{hit.label}</span>
              <span className="shrink-0 text-neutral-400">
                {Math.round(hit.p * 100)}% · @{hit.real.toFixed(2).replace(".", ",")}
              </span>
              <span className={`shrink-0 font-bold ${hit.real >= hit.minOdd ? "text-emerald-400" : "text-red-400"}`}>
                {hit.real >= hit.minOdd ? "compensa" : "não chega"}
              </span>
            </div>
            {hit.why && (
              <p className="mt-0.5 text-[11px] leading-snug text-neutral-500">Porquê: {hit.why}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
