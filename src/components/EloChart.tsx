// Elo rating curves of the two sides (last games each): rising means the
// team has been beating expectations, falling the opposite. Same visual
// language as the strength curve.
import type { EloPoint } from "@/lib/elo";

export default function EloChart({
  home,
  away,
  homeCurve,
  awayCurve,
}: {
  home: string;
  away: string;
  homeCurve: EloPoint[];
  awayCurve: EloPoint[];
}) {
  const W = 560;
  const H = 170;
  const PAD = 30;
  const n = Math.max(homeCurve.length, awayCurve.length);
  if (n < 2) return null;
  const vals = [...homeCurve, ...awayCurve].map((p) => p.elo);
  const lo = Math.min(...vals) - 5;
  const hi = Math.max(...vals) + 5;
  const x = (i: number, len: number) => PAD + (len === 1 ? 0 : (i / (n - 1)) * (W - PAD * 2));
  const y = (v: number) => H - PAD - ((v - lo) / (hi - lo || 1)) * (H - PAD * 2);
  const line = (curve: EloPoint[]): string =>
    curve.map((p, i) => `${i === 0 ? "M" : "L"}${x(i, curve.length).toFixed(1)},${y(p.elo).toFixed(1)}`).join(" ");
  const dates = homeCurve.length >= awayCurve.length ? homeCurve : awayCurve;
  const dayMonth = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const last = (c: EloPoint[]): string => (c.length > 0 ? String(c[c.length - 1].elo) : "–");
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h3 className="mb-1 text-sm font-semibold text-neutral-300">Elo das equipas (últimos {n} jogos)</h3>
      <div className="mb-1 flex items-center gap-4 text-[11px]">
        <span className="flex items-center gap-1 text-emerald-300">
          <span aria-hidden className="inline-block h-0.5 w-4 bg-emerald-400" />
          {home} {last(homeCurve)}
        </span>
        <span className="flex items-center gap-1 text-sky-300">
          <span aria-hidden className="inline-block h-0.5 w-4 bg-sky-400" />
          {away} {last(awayCurve)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Elo de ${home} e ${away}`}>
        <line x1={PAD} y1={y(1500)} x2={W - PAD} y2={y(1500)} stroke="#525252" strokeWidth="1" strokeDasharray="4 3" />
        <text x={PAD - 4} y={y(1500) + 3} textAnchor="end" fontSize="9" fill="#737373">
          1500
        </text>
        <path d={line(awayCurve)} fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
        <path d={line(homeCurve)} fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" />
        {homeCurve.map((p, i) => (
          <circle key={`h${i}`} cx={x(i, homeCurve.length)} cy={y(p.elo)} r="2.5" fill="#34d399" />
        ))}
        {awayCurve.map((p, i) => (
          <circle key={`a${i}`} cx={x(i, awayCurve.length)} cy={y(p.elo)} r="2.5" fill="#38bdf8" />
        ))}
        {dates.map((d, i) =>
          i % Math.ceil(n / 5) === 0 ? (
            <text key={d.date} x={x(i, dates.length)} y={H - 8} textAnchor="middle" fontSize="9" fill="#737373">
              {dayMonth(d.date)}
            </text>
          ) : null
        )}
      </svg>
      <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
        A subir é a ganhar a expectativas, a descer o contrário. Parte de 1500 para todas, conta só jogos desta liga.
      </p>
    </div>
  );
}
