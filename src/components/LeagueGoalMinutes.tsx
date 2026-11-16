import type { SupabaseClient } from "@supabase/supabase-js";
import { eventGoalMinutes, seasonFixtures } from "@/lib/sofaHistory";
import { cacheGetAny, cacheSet } from "@/lib/sofaCache";
import { GOAL_BLOCKS, goalBlocks } from "@/lib/leagueProfile";

// Goal minutes of a whole season: one incidents read per game, so it only runs
// when asked (?minutos=1) and the aggregate is cached. Results never change,
// so a long TTL is safe — only a new game adds anything.
export interface SeasonGoalMinutes {
  games: number;
  goals: number;
  home: number;
  away: number;
  blocks: number[];
  firstHalf: number;
  secondHalf: number;
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

export async function computeSeasonGoalMinutes(
  supabase: SupabaseClient,
  userId: string,
  code: string,
  uniqueId: number,
  seasonId: number
): Promise<SeasonGoalMinutes> {
  const key = `goalmins:v1:${code}:${seasonId}`;
  const hit = await cacheGetAny(supabase, userId, key).catch(() => null);
  if (hit?.payload && typeof hit.payload === "object" && Array.isArray((hit.payload as SeasonGoalMinutes).blocks)) {
    return hit.payload as SeasonGoalMinutes;
  }
  const today = new Date().toISOString().slice(0, 10);
  const fixtures = await seasonFixtures(supabase, userId, uniqueId, seasonId, true, today).catch(() => []);
  // Only finished games; keep the newest 200 so a long season cannot turn the
  // first read into hundreds of scrapes.
  const played = fixtures
    .filter((f) => f.ft && f.date < today)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 200);
  const reads = await pool(played, 4, async (f) => ({
    id: f.id,
    marks: await eventGoalMinutes(supabase, userId, f.id).catch(() => null),
  }));
  const minutes: number[] = [];
  let home = 0;
  let away = 0;
  let games = 0;
  for (const r of reads) {
    if (!r.marks) continue;
    games++;
    for (const mark of r.marks) {
      minutes.push(mark.minute);
      if (mark.home) home++;
      else away++;
    }
  }
  const blocks = goalBlocks(minutes);
  const firstHalf = blocks[0] + blocks[1] + blocks[2];
  const data: SeasonGoalMinutes = {
    games,
    goals: minutes.length,
    home,
    away,
    blocks,
    firstHalf,
    secondHalf: minutes.length - firstHalf,
  };
  if (games > 0) await cacheSet(supabase, userId, key, data).catch(() => undefined);
  return data;
}

export default function LeagueGoalMinutes({ data }: { data: SeasonGoalMinutes }) {
  const pct = (v: number): string => `${((v || 0) * 100).toFixed(1).replace(".", ",")}%`;
  const perGame = (v: number): string =>
    data.games > 0 ? (v / data.games).toFixed(2).replace(".", ",") : "—";
  const total = data.goals || 1;

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
      <h3 className="mb-1 text-sm font-semibold text-neutral-200">Quando caem os golos</h3>
      <p className="mb-3 text-xs text-neutral-500">
        {data.goals} golos em {data.games} jogos com dados de incidentes ({data.home} em casa, {data.away} fora).
        Blocos iguais aos da tabela de minutos por equipa; descontos entram no bloco anterior.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="py-1.5 pr-3 font-medium">Bloco</th>
              <th className="py-1.5 pr-3 font-medium">Golos</th>
              <th className="py-1.5 pr-3 font-medium">% do total</th>
              <th className="py-1.5 font-medium">Por jogo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {GOAL_BLOCKS.map((label, i) => (
              <tr key={label}>
                <td className="py-1.5 pr-3 text-neutral-300">{label}&apos;</td>
                <td className="py-1.5 pr-3 font-medium text-neutral-100">{data.blocks[i]}</td>
                <td className="py-1.5 pr-3 text-neutral-300">{pct(data.blocks[i] / total)}</td>
                <td className="py-1.5 text-neutral-400">{perGame(data.blocks[i])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        1.ª parte {pct(data.firstHalf / total)} · 2.ª parte {pct(data.secondHalf / total)}.
      </p>
    </div>
  );
}
