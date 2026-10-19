import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import FavoriteButton from "@/components/FavoriteButton";
import { LEAGUES } from "@/lib/footballData";
import { loadMaps, linkLocalName, fetchLiveEntries, seasonUpcomingExtra, seasonRecentLite, tournamentLiveFixtures, tournamentSeasons, type SofaFixture } from "@/lib/sofaHistory";
import { loadSofaLeague } from "@/lib/sofaLeague";
import { fetchSofaLiveNow } from "@/lib/sofaBoard";
import { cacheGetAny, cacheSet, HOUR_MS } from "@/lib/sofaCache";
import { matchTeamIn } from "@/lib/liveMatch";
import { prewarmDayDetail } from "@/components/DayDetail";
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

// Refrescos já em curso, por chave: quando a página serve a última avaliação
// e lança a reavaliação em segundo plano, visitas seguintes à mesma tabela
// não empilham outra por cima (o refresco termina quando termina).
const recomputing = new Set<string>();
function kickRecompute(key: string, run: () => Promise<void>): void {
  if (recomputing.has(key)) return;
  recomputing.add(key);
  void run()
    .catch(() => {})
    .finally(() => recomputing.delete(key));
}

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
  const { data: favRows } = await supabase.from("favorite_games").select("event_id").eq("user_id", user.id);
  const favIds = new Set((favRows ?? []).map((r) => (r as { event_id?: unknown }).event_id).filter((n): n is number => typeof n === "number"));
  const countryOf = (label: string): string => label.split("·")[0]?.trim() ?? label;
  const leagues = LEAGUES.filter((l) => {
    if (!codes.has(l.code) || l.code.startsWith("int.")) return false;
    if (ligaSel && l.code !== ligaSel) return false;
    if (pais && countryOf(l.label as string) !== pais) return false;
    return true;
  });
  const labelOf = (code: string): string => leagues.find((l) => l.code === code)?.label ?? code;
  const now = new Date();

  const cacheKey = `daymatrix:v3:${day}|${pais}|${ligaSel}`;
  const meta = refresh ? null : await cacheGetAny(supabase, user.id, cacheKey).catch(() => null);
  const age = meta ? now.getTime() - meta.fetchedAt : Infinity;
  let table: MatrixLeague[] = [];
  let failed: string[] = [];
  let staleLeagues: string[] = [];
  let unlinkedNames: string[] = [];
  let missedNames: string[] = [];
  let shownAge: number | null = null; // minutos quando servimos a última avaliação
  let refazendo = false;

  const compute = async (): Promise<void> => {
    const teamMaps = await loadMaps(supabase, user.id, "team").catch(() => []);
    const toLocal = new Map(teamMaps.filter((m) => m.local_name).map((m) => [m.name, m.local_name]));
    const convert = (name: string): string => toLocal.get(name) ?? linkLocalName(teamMaps, name) ?? name;
    const failedSet = new Set<string>();
    const staleSet = new Set<string>();
    const unlinkedSet = new Set<string>();
    const found: MatrixLeague[] = [];
    const missed = new Set<string>();
    // Same fixture source as the day board (season upcoming page 0 + recent
    // extras + live ties, shared cache), so the two views can never disagree
    // on which games exist. History loads only for leagues with games that day.
    // One live read per render (scraper caches it 60s), shared by all leagues.
    const liveEntries = await fetchLiveEntries().catch(() => []);
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
      // Sonda leve: os próximos e os recentes da época (2–3 leituras, matas-
      // mata incluídos) cobrem o dia inteiro — agendados, ao vivo e acabados.
      // Ligas sem jogos no dia ficam-se por aqui (jornadas e histórico nunca
      // arrancam para elas, e era isso que enlentecia a visita fria).
      const upcoming = await seasonUpcomingExtra(supabase, user.id, map.sofascore_id, s.id, true, 0).catch(() => null);
      if (upcoming === null) {
        failedSet.add(l.code);
        return;
      }
      const recent = await seasonRecentLite(supabase, user.id, map.sofascore_id, s.id, true).catch(() => [] as SofaFixture[]);
      const seenIds = new Set<number>();
      const flat: SofaFixture[] = [];
      for (const f of [...upcoming, ...(recent ?? []), ...tournamentLiveFixtures(liveEntries, map.sofascore_id, 0)]) {
        if (f.date === day && !seenIds.has(f.id)) {
          seenIds.add(f.id);
          flat.push(f);
        }
      }
      const dayFx = flat.filter((f) => f.date === day);
      if (dayFx.length === 0) return;
      let data;
      try {
        const loaded = await loadSofaLeague(supabase, user.id, l.code, { history: true, fixtures: false });
        data = loaded?.data ?? null;
        if (loaded?.stale) staleSet.add(l.code);
        for (const u of loaded?.unlinked ?? []) unlinkedSet.add(`${labelOf(l.code)}: ${u}`);
      } catch {
        failedSet.add(l.code);
        return;
      }
      if (!data) {
        failedSet.add(l.code);
        return;
      }
      const fhs = leagueRates(data.matches, now).firstHalfShare;
      let rows: MatrixRow[] = [];
      for (const f of dayFx) {
        const home = convert(f.team1);
        const away = convert(f.team2);
        if (!data.teams.includes(home) && !matchTeamIn(home, data.teams)) missed.add(`${f.team1}→${home}`);
        if (!data.teams.includes(away) && !matchTeamIn(away, data.teams)) missed.add(`${f.team2}→${away}`);
        // Stale spellings (cache built before the team map landed) keep the
        // row when the tolerant fit sees "Getafe CF" == "Getafe".
        const teamIn = (name: string): boolean => data.teams.includes(name) || matchTeamIn(name, data.teams) !== null;
        if (!teamIn(home) || !teamIn(away)) {
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
        // The same tie twice under different event ids (a postponed entry
        // beside its rescheduling, upstream data overlap) duplicates the row
        // and breaks React keys: one pairing per league per day is the rule.
        const seenPairs = new Set<string>();
        rows = rows.filter((r) => {
          const k = `${r.home}|${r.away}`;
          if (seenPairs.has(k)) return false;
          seenPairs.add(k);
          return true;
        });
        if (rows.length > 0) found.push({ code: l.code, label: labelOf(l.code), rows });
      }
    });
    table = found;
    failed = [...failedSet];
    staleLeagues = [...staleSet];
    unlinkedNames = [...unlinkedSet].slice(0, 12);
    missedNames = [...missed].slice(0, 12);
    if (failed.length === 0) {
      await cacheSet(supabase, user.id, cacheKey, table).catch(() => {});
      // A compacta ficou pronta: pré-aquecer a detalhada do mesmo dia em
      // segundo plano para o próximo clique não esperar minutos.
      prewarmDayDetail(supabase, user.id, day, pais, ligaSel);
    } else {
      // Partial evaluations are cached too: while leagues warm up (or the
      // scraper hiccups), the same visit must never re-block for minutes —
      // the table keeps what worked and the retry converges in background.
      await cacheSet(supabase, user.id, cacheKey, { rows: table, failed }).catch(() => {});
    }
  };

  // Cached payloads come in two shapes: a plain MatrixLeague[] (complete
  // evaluation) or { rows, failed } (partial eval with leagues still failing).
  const readPayload = (p: unknown): { rows: MatrixLeague[]; partialFailed: string[] } | null => {
    if (Array.isArray(p)) return { rows: p as MatrixLeague[], partialFailed: [] };
    if (p !== null && typeof p === "object") {
      const o = p as Record<string, unknown>;
      if (Array.isArray(o.rows)) {
        return { rows: o.rows as MatrixLeague[], partialFailed: Array.isArray(o.failed) ? (o.failed as string[]) : [] };
      }
    }
    return null;
  };
  const served = readPayload(meta?.payload);
  if (served) {
    table = served.rows;
    failed = served.partialFailed;
    if (failed.length > 0) {
      // Parcial: mostra o que funcionou e reavalia sempre em segundo plano —
      // as ligas em falha só recuperam nas tentativas seguintes.
      shownAge = Math.max(0, Math.round(age / 60_000));
      refazendo = true;
      kickRecompute(cacheKey, compute);
    } else if (age <= HOUR_MS) {
      // cache fresca, avaliação completa: serve-se sem reavaliar
    } else if (age <= 6 * HOUR_MS) {
      // A última avaliação serve já (dados de hoje raramente mudam sem novo
      // histórico) e a reavaliação corre em segundo plano: a página deixa de
      // esperar minutos no refresco horário — o até-6h é a mesma barra que os
      // utilizador escolheu para as jornadas terminadas.
      shownAge = Math.round(age / 60_000);
      if (shownAge < 1) shownAge = 0;
      refazendo = true;
      kickRecompute(cacheKey, compute);
    } else {
      await compute();
    }
  } else {
    await compute();
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
          {nRows} jogo{nRows === 1 ? "" : "s"} · % do modelo (justa = 1/p em pequeno) ·{" "}
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
        {shownAge !== null && refazendo && (
          <span className="text-sky-300" title="A última avaliação é de hoje; a nova corre agora em segundo plano">
            Mostrada a última avaliação (há {shownAge} min) — a reavaliar em segundo plano; recarrega daqui a ~1 min para ver o refresco.
          </span>
        )}
        {missedNames.length > 0 && (
          <span className="text-amber-300">Nomes fora dos dados: {missedNames.join(" · ")}</span>
        )}
        {failed.length > 0 && (
          <span className="text-amber-300">
            Sem leitura em {failed.length} liga{failed.length === 1 ? "" : "s"} — recarrega.
          </span>
        )}
        {staleLeagues.length > 0 && (
          <span className="text-amber-300" title={staleLeagues.join(", ")}>
            Cache antiga em {staleLeagues.length} liga{staleLeagues.length === 1 ? "" : "s"} (falha técnica): os números podem estar desatualizados — recarrega.
          </span>
        )}
        {unlinkedNames.length > 0 && (
          <span className="text-amber-300" title={unlinkedNames.join(", ")}>
            Grafias por ligar no Mapa: {unlinkedNames.slice(0, 6).join(", ")}
            {unlinkedNames.length > 6 ? ` +${unlinkedNames.length - 6}` : ""}.
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
                  <tr key={`${r.eventId ?? "x"}|${r.home}|${r.away}|${r.time ?? ""}`} className={`transition-colors hover:bg-neutral-800/40 ${r.fragile ? "opacity-55" : ""}`}>
                    <td className="min-w-52 px-4 py-2">
                      <span className="mr-2 tabular-nums text-neutral-500">{r.time ? r.time.slice(0, 5) : "—"}</span>
                      {r.eventId !== null && r.eventId > 0 && (
                        <FavoriteButton eventId={r.eventId} home={r.home} away={r.away} tournament={l.label} initial={favIds.has(r.eventId)} />
                      )}{" "}
                      <Link
                        href={`/estatisticas?${new URLSearchParams({ liga: l.code, casa: r.home, fora: r.away })}`}
                        title="Abrir no Comparar equipas"
                        className="text-neutral-100 transition hover:text-emerald-300"
                      >
                        {r.home} <span className="text-neutral-600">vs</span> {r.away}
                      </Link>
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
