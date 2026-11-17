import type { SupabaseClient } from "@supabase/supabase-js";
import { eventCornersCards, seasonFixtures } from "@/lib/sofaHistory";
import { cacheGetAny, cacheSet, HOUR_MS } from "@/lib/sofaCache";

// Corners and yellow cards of a whole season: one statistics read per game, so
// it only runs when asked (?cantos=1) and the aggregate is cached. Counts
// never change, so the TTL is long — only a new game adds anything.
export interface TeamCounts {
  team: string;
  games: number;
  cornersFor: number;
  cornersAgainst: number;
  yellowsFor: number;
  yellowsAgainst: number;
}

export interface SeasonCounts {
  games: number; // games with full-time counts
  htGames: number; // games that also carry a first-half split
  corners: [number, number];
  cornersHt: [number, number];
  yellows: [number, number];
  yellowsHt: [number, number];
  over85: number;
  over95: number;
  over105: number;
  both4: number;
  over35y: number;
  over45y: number;
  over55y: number;
  htYellow: number;
  teams: TeamCounts[];
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

export async function computeSeasonCounts(
  supabase: SupabaseClient,
  userId: string,
  code: string,
  uniqueId: number,
  seasonId: number
): Promise<SeasonCounts> {
  const key = `cornercards:v1:${code}:${seasonId}`;
  // Counts never change, but the season grows: rebuild after 6 h so the new
  // games join. The per-game statistics stay cached, so the rebuild is cheap.
  const hit = await cacheGetAny(supabase, userId, key).catch(() => null);
  if (
    hit &&
    Date.now() - hit.fetchedAt < 6 * HOUR_MS &&
    hit.payload &&
    typeof hit.payload === "object" &&
    Array.isArray((hit.payload as SeasonCounts).teams)
  ) {
    return hit.payload as SeasonCounts;
  }
  const today = new Date().toISOString().slice(0, 10);
  const fixtures = await seasonFixtures(supabase, userId, uniqueId, seasonId, true, today).catch(() => []);
  // Newest 200 finished games, same cap as the goal minutes: a long season
  // must not turn the first read into hundreds of scrapes.
  const played = fixtures
    .filter((f) => f.ft && f.date < today)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 200);
  const reads = await pool(played, 4, async (f) => ({
    team1: f.team1,
    team2: f.team2,
    counts: await eventCornersCards(supabase, userId, f.id).catch(() => null),
  }));

  const teams = new Map<string, TeamCounts>();
  const team = (name: string): TeamCounts => {
    const found = teams.get(name);
    if (found) return found;
    const fresh: TeamCounts = {
      team: name,
      games: 0,
      cornersFor: 0,
      cornersAgainst: 0,
      yellowsFor: 0,
      yellowsAgainst: 0,
    };
    teams.set(name, fresh);
    return fresh;
  };

  const data: SeasonCounts = {
    games: 0,
    htGames: 0,
    corners: [0, 0],
    cornersHt: [0, 0],
    yellows: [0, 0],
    yellowsHt: [0, 0],
    over85: 0,
    over95: 0,
    over105: 0,
    both4: 0,
    over35y: 0,
    over45y: 0,
    over55y: 0,
    htYellow: 0,
    teams: [],
  };

  for (const r of reads) {
    const c = r.counts;
    if (!c) continue;
    const [ch, ca] = c.corners;
    data.games++;
    data.corners[0] += ch;
    data.corners[1] += ca;
    const total = ch + ca;
    if (total > 8.5) data.over85++;
    if (total > 9.5) data.over95++;
    if (total > 10.5) data.over105++;
    if (ch >= 4 && ca >= 4) data.both4++;

    if (c.yellows) {
      const [yh, ya] = c.yellows;
      data.yellows[0] += yh;
      data.yellows[1] += ya;
      const cards = yh + ya;
      if (cards > 3.5) data.over35y++;
      if (cards > 4.5) data.over45y++;
      if (cards > 5.5) data.over55y++;
    }
    if (c.cornersHt) {
      data.cornersHt[0] += c.cornersHt[0];
      data.cornersHt[1] += c.cornersHt[1];
    }
    if (c.yellowsHt) {
      data.yellowsHt[0] += c.yellowsHt[0];
      data.yellowsHt[1] += c.yellowsHt[1];
      if (c.yellowsHt[0] + c.yellowsHt[1] > 0) data.htYellow++;
    }
    if (c.cornersHt || c.yellowsHt) data.htGames++;

    const home = team(r.team1);
    const away = team(r.team2);
    home.games++;
    away.games++;
    home.cornersFor += ch;
    home.cornersAgainst += ca;
    away.cornersFor += ca;
    away.cornersAgainst += ch;
    if (c.yellows) {
      home.yellowsFor += c.yellows[0];
      home.yellowsAgainst += c.yellows[1];
      away.yellowsFor += c.yellows[1];
      away.yellowsAgainst += c.yellows[0];
    }
  }

  data.teams = [...teams.values()].sort(
    (a, b) => b.cornersFor / Math.max(1, b.games) - a.cornersFor / Math.max(1, a.games)
  );
  if (data.games > 0) await cacheSet(supabase, userId, key, data).catch(() => undefined);
  return data;
}

const avg = (total: number, games: number): string =>
  games > 0 ? (total / games).toFixed(2).replace(".", ",") : "—";

export default function LeagueCornersCards({ data }: { data: SeasonCounts }) {
  const pct = (v: number): string => `${((v || 0) * 100).toFixed(1).replace(".", ",")}%`;
  const share = (part: number, whole: number): string => (whole > 0 ? pct(part / whole) : "—");
  const odd = (part: number, whole: number): string => (part > 0 && whole > 0 ? (whole / part).toFixed(2).replace(".", ",") : "—");

  const lines = [
    { label: "Over 8,5 cantos", hit: data.over85 },
    { label: "Over 9,5 cantos", hit: data.over95 },
    { label: "Over 10,5 cantos", hit: data.over105 },
    { label: "4+ cantos de cada equipa", hit: data.both4 },
    { label: "Over 3,5 amarelos", hit: data.over35y },
    { label: "Over 4,5 amarelos", hit: data.over45y },
    { label: "Over 5,5 amarelos", hit: data.over55y },
    { label: "Amarelo na 1.ª parte", hit: data.htYellow },
  ];

  return (
    <div className="space-y-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
      <div>
        <h3 className="mb-1 text-sm font-semibold text-neutral-200">Cantos e cartões</h3>
        <p className="text-xs text-neutral-500">
          {data.games} jogos com estatísticas ({data.htGames} com separação ao intervalo). Lido da ficha de cada jogo;
          descontos contam na parte em que aconteceram.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-white/[0.06] p-3">
          <p className="text-xs font-medium text-neutral-400">Cantos por jogo</p>
          <p className="mt-1 text-xl font-semibold text-neutral-100">
            {avg(data.corners[0] + data.corners[1], data.games)}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            {avg(data.corners[0], data.games)} casa · {avg(data.corners[1], data.games)} fora
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            1.ª parte: {avg(data.cornersHt[0] + data.cornersHt[1], data.htGames)} ({avg(data.cornersHt[0], data.htGames)} ·{" "}
            {avg(data.cornersHt[1], data.htGames)})
          </p>
        </div>
        <div className="rounded-lg border border-white/[0.06] p-3">
          <p className="text-xs font-medium text-neutral-400">Amarelos por jogo</p>
          <p className="mt-1 text-xl font-semibold text-neutral-100">
            {avg(data.yellows[0] + data.yellows[1], data.games)}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            {avg(data.yellows[0], data.games)} casa · {avg(data.yellows[1], data.games)} fora
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            1.ª parte: {avg(data.yellowsHt[0] + data.yellowsHt[1], data.htGames)} (
            {avg(data.yellowsHt[0], data.htGames)} · {avg(data.yellowsHt[1], data.htGames)})
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="py-1.5 pr-3 font-medium">Mercado</th>
              <th className="py-1.5 pr-3 font-medium">Jogos</th>
              <th className="py-1.5 pr-3 font-medium">Aconteceu</th>
              <th className="py-1.5 font-medium">Odd justa</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {lines.map((l) => (
              <tr key={l.label} className={data.games < 5 ? "text-neutral-500" : ""}>
                <td className="py-1.5 pr-3 text-neutral-300">{l.label}</td>
                <td className="py-1.5 pr-3 text-neutral-400">{data.games}</td>
                <td className="py-1.5 pr-3 font-medium text-neutral-100">{share(l.hit, data.games)}</td>
                <td className="py-1.5 text-neutral-400">{odd(l.hit, data.games)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-neutral-400">Por equipa (média por jogo)</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Equipa</th>
                <th className="py-1.5 pr-3 font-medium">Jogos</th>
                <th className="py-1.5 pr-3 font-medium">Cantos</th>
                <th className="py-1.5 pr-3 font-medium">Cantos sofridos</th>
                <th className="py-1.5 pr-3 font-medium">Amarelos</th>
                <th className="py-1.5 font-medium">Amarelos sofridos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {data.teams.map((t) => (
                <tr key={t.team} className={t.games < 5 ? "text-neutral-500" : ""}>
                  <td className="py-1.5 pr-3 text-neutral-300">{t.team}</td>
                  <td className="py-1.5 pr-3 text-neutral-400">{t.games}</td>
                  <td className="py-1.5 pr-3 font-medium text-neutral-100">{avg(t.cornersFor, t.games)}</td>
                  <td className="py-1.5 pr-3 text-neutral-300">{avg(t.cornersAgainst, t.games)}</td>
                  <td className="py-1.5 pr-3 font-medium text-neutral-100">{avg(t.yellowsFor, t.games)}</td>
                  <td className="py-1.5 text-neutral-300">{avg(t.yellowsAgainst, t.games)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-neutral-500">
          Cantos e amarelos «sofridos» são os da equipa adversária nesses jogos. Linhas esbatidas: menos de 5 jogos.
          Cantos e cartões não entram no modelo nem na calibração — são perfil, não previsão.
        </p>
      </div>
    </div>
  );
}
