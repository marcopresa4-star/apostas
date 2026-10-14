import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LEAGUES } from "@/lib/footballData";
import { loadMaps, linkLocalName, roundFixtures, tournamentRounds, tournamentSeasons, type SofaFixture } from "@/lib/sofaHistory";
import { loadSofaLeague } from "@/lib/sofaLeague";
import { fetchSofaLiveNow } from "@/lib/sofaBoard";
import { cacheGet, cacheSet, HOUR_MS } from "@/lib/sofaCache";
import { leagueRates, predict } from "@/lib/footballModel";
import { matchTotalOver, MIN_GAMES } from "@/lib/recommendation";

// Market matrix for one day: model chance + fair odd per game, per market.
// Opt-in (loads every league's history: minutes on first view, then cache).
// No corners/cards columns: the history carries no such data, so inventing
// them is out. No real odds either: that is an odds read per game, the
// Value page's job.
interface MatrixCell {
  p: number;
}

interface MatrixRow {
  eventId: number | null;
  time: string | null;
  home: string;
  away: string;
  ft: [number, number] | null;
  cells: Record<string, number>;
  games: number;
  fragile: boolean;
}

interface MatrixLeague {
  code: string;
  label: string;
  rows: MatrixRow[];
}

const COLS: { key: string; label: string }[] = [
  { key: "ht05", label: "Over 0,5 1.ª parte" },
  { key: "o15", label: "Over 1,5" },
  { key: "o25", label: "Over 2,5" },
  { key: "btts", label: "Ambas marcam" },
  { key: "h2p", label: "Golo nas 2 partes" },
  { key: "h", label: "Vitória casa" },
  { key: "d", label: "Empate" },
  { key: "a", label: "Vitória fora" },
];

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  });
  await Promise.all(workers);
  return out;
}

const pct1 = (p: number): string => `${(p * 100).toFixed(1).replace(".", ",")}%`;
const fair2 = (p: number): string => (p > 0 ? (1 / p).toFixed(2).replace(".", ",") : "—");
const band = (p: number): string =>
  p >= 0.65 ? "text-emerald-400" : p >= 0.4 ? "text-amber-300" : "text-red-400";

export default async function DayMatrix({
  day,
  pais,
  ligaSel,
  equipa,
  diretos,
  refresh,
}: {
  day: string;
  pais: string;
  ligaSel: string;
  equipa: string;
  diretos: boolean;
  refresh: boolean;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <p className="text-sm text-neutral-400">Sem sessão.</p>;

  const maps = await loadMaps(supabase, user.id, "tournament").catch(() => []);
  const codes = new Set(maps.map((m) => m.name_key));
  const countryOf = (label: string): string => label.split("·")[0]?.trim() ?? label;
  const leagues = LEAGUES.filter((l) => {
    if (!codes.has(l.code) || l.code.startsWith("int.")) return false;
    if (ligaSel && l.code !== ligaSel) return false;
    if (pais && countryOf(l.label as string) !== pais) return false;
    return true;
  });
  const labelOf = (code: string): string => leagues.find((l) => l.code === code)?.label ?? code;
  const now = new Date();

  const cacheKey = `daymatrix:${day}|${pais}|${ligaSel}`;
  const cached = refresh
    ? null
    : await cacheGet(supabase, user.id, cacheKey, HOUR_MS).catch(() => null);
  let table: MatrixLeague[] = [];
  let failed: string[] = [];
  let missedNames: string[] = [];
  if (Array.isArray(cached)) {
    table = cached as MatrixLeague[];
  } else {
    const teamMaps = await loadMaps(supabase, user.id, "team").catch(() => []);
    const toLocal = new Map(teamMaps.filter((m) => m.local_name).map((m) => [m.name, m.local_name]));
    const convert = (name: string): string => toLocal.get(name) ?? linkLocalName(teamMaps, name) ?? name;
    const failedSet = new Set<string>();
    const found: MatrixLeague[] = [];
    const missed = new Set<string>();
    // Same fixture source as the day board (round window, shared cache), so
    // the two views can never disagree on which games exist. History loads
    // only for leagues with games that day.
    await pool(leagues, 4, async (l) => {
      const map = maps.find((m) => m.name_key === l.code);
      if (!map) return;
      let seasons;
      try {
        seasons = await tournamentSeasons(supabase, user.id, map.sofascore_id);
      } catch {
        failedSet.add(l.code);
        return;
      }
      const s = seasons[0];
      if (!s) return;
      let rounds: number[];
      let currentRound: number | null;
      try {
        ({ rounds, currentRound } = await tournamentRounds(supabase, user.id, map.sofascore_id, s.id, true));
      } catch {
        failedSet.add(l.code);
        return;
      }
      if (rounds.length === 0) return;
      const want =
        currentRound !== null
          ? [currentRound - 1, currentRound, currentRound + 1].filter((r) => rounds.includes(r))
          : rounds.slice(0, 3);
      const lists = await Promise.all(
        want.map((r) => roundFixtures(supabase, user.id, map.sofascore_id, s.id, r, true).then((x) => x, () => null))
      );
      if (lists.some((x) => x === null)) {
        failedSet.add(l.code);
        return;
      }
      const flat: SofaFixture[] = [];
      for (const l of lists) if (l !== null) flat.push(...l);
      const dayFx = flat.filter((f) => f.date === day);
      if (dayFx.length === 0) return;
      let data;
      try {
        const loaded = await loadSofaLeague(supabase, user.id, l.code, { history: true, fixtures: false });
        data = loaded?.data ?? null;
      } catch {
        failedSet.add(l.code);
        return;
      }
      if (!data) {
        failedSet.add(l.code);
        return;
      }
      const fhs = leagueRates(data.matches, now).firstHalfShare;
      const rows: MatrixRow[] = [];
      for (const f of dayFx) {
        const home = convert(f.team1);
        const away = convert(f.team2);
        if (!data.teams.includes(home)) missed.add(`${f.team1}→${home}`);
        if (!data.teams.includes(away)) missed.add(`${f.team2}→${away}`);
        if (!data.teams.includes(home) || !data.teams.includes(away)) {
          continue;
        }
        const prediction = predict(data.matches, home, away, now);
        const games = Math.min(prediction.gamesHome, prediction.gamesAway);
        // Cups early on: little same-competition history is shown dimmed
        // with a tag (like Comparar's fragile estimates), never hidden.
        const fragile = games < MIN_GAMES;
        const lh = prediction.lambdaHome;
        const la = prediction.lambdaAway;
        const h1 = lh * fhs;
        const a1 = la * fhs;
        const h2 = lh * (1 - fhs);
        const a2 = la * (1 - fhs);
        const cells: Record<string, number> = {
          ht05: prediction.halfTime.over05,
          o15: prediction.over["1.5"] ?? matchTotalOver(lh, la, 1.5),
          o25: prediction.over["2.5"] ?? matchTotalOver(lh, la, 2.5),
          btts: prediction.bothScore,
          h2p: (1 - Math.exp(-(h1 + a1))) * (1 - Math.exp(-(h2 + a2))),
          h: prediction.fullTime.home,
          d: prediction.fullTime.draw,
          a: prediction.fullTime.away,
        };
        rows.push({
          eventId: f.id,
          time: f.time ?? null,
          home,
          away,
          ft: null,
          cells,
          games,
          fragile,
        });
      }
      if (rows.length > 0) {
        rows.sort((a, b) => `${a.time ?? ""}`.localeCompare(`${b.time ?? ""}`) || a.home.localeCompare(b.home));
        found.push({ code: l.code, label: labelOf(l.code), rows });
      }
    });
    table = found;
    failed = [...failedSet];
    missedNames = [...missed].slice(0, 12);
    if (failed.length === 0) await cacheSet(supabase, user.id, cacheKey, table).catch(() => {});
  }

  // Live-only view + team search filter on the (cached) rows.
  let liveIds: Set<number> | null = null;
  if (diretos) {
    const { games } = await fetchSofaLiveNow(Date.now()).catch(() => ({ games: [] as { id: number }[] }));
    liveIds = new Set(games.map((g) => g.id));
  }
  const shown = table
    .map((l) => ({
      ...l,
      rows: l.rows.filter(
        (r) =>
          (!equipa || `${r.home} ${r.away}`.toLowerCase().includes(equipa)) &&
          (!liveIds || (r.eventId !== null && liveIds.has(r.eventId)))
      ),
    }))
    .filter((l) => l.rows.length > 0);
  shown.sort((a, b) => a.label.localeCompare(b.label));
  const nRows = shown.reduce((s, l) => s + l.rows.length, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-500">
        <span>
          <span className="font-semibold text-emerald-400">≥65%</span> ·{" "}
          <span className="font-semibold text-amber-300">40–64%</span> · <span className="font-semibold text-red-400">＜40%</span>
        </span>
        <span>
          {nRows} jogos{nRows === 1 ? "" : "s"} · % do modelo (justa = 1/p em pequeno) ·{" "}
          <Link
            href={`/estatisticas/jogos-dia?${new URLSearchParams({
              data: day,
              ...(pais ? { pais } : {}),
              ...(ligaSel ? { liga: ligaSel } : {}),
              ...(equipa ? { equipa } : {}),
              ...(diretos ? { diretos: "1" } : {}),
              matriz: "1",
              refresh: "1",
            })}`}
            className="text-neutral-400 hover:text-neutral-200 hover:underline"
          >
            atualizar
          </Link>
        </span>
        {missedNames.length > 0 && (
          <span className="text-amber-300">Nomes fora dos dados: {missedNames.join(" · ")}</span>
        )}
        {failed.length > 0 && (
          <span className="text-amber-300">
            Sem leitura em {failed.length} liga{failed.length === 1 ? "" : "s"} — recarrega.
          </span>
        )}
      </div>
      <p className="max-w-4xl text-[11px] leading-relaxed text-neutral-500">
        Linhas esbatidas: menos de 5 jogos desta competição nos dados — estimativa frágil (Roma e Porto, por exemplo,
        andavam na Liga Europa). Sem colunas de cantos/cartões: o histórico não traz esses dados. Sem odds reais aqui
        (isso é uma leitura por jogo: vai ao Value ou ao Comparar).
      </p>
      {shown.length === 0 ? (
        <p className="max-w-4xl rounded-xl border border-dashed border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
          {diretos ? "Nenhum jogo a decorrer agora nos filtros escolhidos." : "Sem jogos para a matriz neste dia e filtros."}
        </p>
      ) : (
        shown.map((l) => (
          <div key={l.code} className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900">
            <p className="border-b border-neutral-800 bg-neutral-800/40 px-4 py-2 text-sm font-semibold text-neutral-200">
              {l.label} · {l.rows.length} {l.rows.length === 1 ? "jogo" : "jogos"}
            </p>
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className="border-b border-neutral-800 text-[10px] uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-2 text-left font-semibold">Jogo</th>
                  {COLS.map((c) => (
                    <th key={c.key} className="px-2 py-2 text-center font-semibold">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60">
                {l.rows.map((r) => (
                  <tr key={`${r.home}|${r.away}|${r.time ?? ""}`} className={`transition-colors hover:bg-neutral-800/40 ${r.fragile ? "opacity-55" : ""}`}>
                    <td className="min-w-52 px-4 py-2">
                      <span className="mr-2 tabular-nums text-neutral-500">{r.time ? r.time.slice(0, 5) : "—"}</span>
                      <span className="text-neutral-100">
                        {r.home} <span className="text-neutral-600">vs</span> {r.away}
                      </span>
                      {r.fragile && (
                        <span title={`Só ${r.games} jogo${r.games === 1 ? "" : "s"} desta competição nos dados`} className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                          poucos jogos
                        </span>
                      )}
                    </td>
                    {COLS.map((c) => {
                      const p = r.cells[c.key] ?? 0;
                      return (
                        <td key={c.key} className="px-2 py-2 text-center">
                          <p className={`font-semibold tabular-nums ${band(p)}`}>{pct1(p)}</p>
                          <p className="text-[10px] tabular-nums text-neutral-600">{fair2(p)}</p>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}
