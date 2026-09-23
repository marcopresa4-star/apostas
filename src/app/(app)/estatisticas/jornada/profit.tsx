import { createClient } from "@/lib/supabase/server";
import { eventOdds } from "@/lib/sofaOdds";
import { oddsKeyFor } from "@/lib/oddsParse";
import { formatOdd } from "@/lib/multiples";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_GAMES = 20;

export interface ProfitGame {
  eventId: number;
  date: string;
  home: string;
  away: string;
  ft: [number, number];
  label: string;
  key: string;
  won: boolean;
}

// What the checked suggestions would have paid at the bookmaker's real odds:
// one unit staked on each, settled by the final score. Streams in after the
// page (one odds read per game). Finished games keep their prices, so a
// week-long cache is honest; games with no prices are left out, not zeroed.
export default async function CheckedProfit({
  games,
  userId,
}: {
  games: ProfitGame[];
  userId: string;
}) {
  const supabase = await createClient();
  const recent = games.slice(0, MAX_GAMES);
  const settled = await Promise.all(
    recent.map(async (g) => {
      const parsed = await eventOdds(supabase, userId, g.eventId, WEEK_MS).catch(() => null);
      let odd: number | undefined;
      if (parsed) {
        const byKey: Record<string, number> = {};
        for (const m of parsed.markets) for (const c of m.choices) byKey[c.key] = c.odd;
        const key = oddsKeyFor(g.key, g.home, g.away);
        odd = key ? byKey[key] : undefined;
      }
      return { ...g, odd };
    })
  );
  const priced = settled.filter((r): r is typeof r & { odd: number } => r.odd !== undefined);
  if (priced.length === 0) return null;
  const profit = priced.reduce((s, r) => s + (r.won ? r.odd - 1 : -1), 0);
  const roi = (profit / priced.length) * 100;
  const fmt = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1).replace(".", ",")}u`;

  return (
    <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3">
      <p className="text-sm text-neutral-200">
        Lucro às odds reais:{" "}
        <span className={`font-bold ${profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmt(profit)}</span>{" "}
        em {priced.length} apostas ({roi > 0 ? "+" : ""}
        {roi.toFixed(0)}% por aposta)
      </p>
      <ul className="mt-2 space-y-1 text-xs">
        {priced.map((r, i) => (
          <li key={`${r.date}-${r.home}-${i}`} className="flex items-center gap-2">
            <span className="shrink-0 text-neutral-500">
              {r.date.slice(8, 10)}/{r.date.slice(5, 7)}
            </span>
            <span className="min-w-0 flex-1 truncate text-neutral-300">
              {r.label} @{formatOdd(r.odd)}
            </span>
            <span className={`shrink-0 font-bold ${r.won ? "text-emerald-400" : "text-red-400"}`}>
              {r.won ? `+${(r.odd - 1).toFixed(2).replace(".", ",")}` : "−1,00"}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
        Uma unidade por sugestão, às odds de fecho (aproximadas: os preços congelados do jogo terminado). Sem elas,
        a taxa de acerto engana: acertar favoritos baratos não paga.
      </p>
    </div>
  );
}
