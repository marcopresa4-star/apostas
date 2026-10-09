import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES } from "@/lib/footballData";
import { createClient } from "@/lib/supabase/server";
import { loadMaps, linkLocalName, roundFixtures, tournamentRounds, tournamentSeasons, type SofaFixture, type SofaSeason } from "@/lib/sofaHistory";
import { fixtureEventId, loadSofaLeague } from "@/lib/sofaLeague";
import { fetchSofaLiveNow } from "@/lib/sofaBoard";
import { cacheGet, cacheSet } from "@/lib/sofaCache";
import type { Fixture } from "@/lib/footballModel";
import EstatisticasTabs from "@/components/EstatisticasTabs";
import DayFilters from "@/components/DayFilters";
import { first } from "@/lib/searchParams";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const shift = (date: string, days: number): string => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dayMonth = (date: string): string => {
  const wd = new Date(`${date}T00:00:00`).toLocaleDateString("pt-PT", { weekday: "long", day: "2-digit", month: "2-digit" });
  return wd;
};

export default async function JogosDiaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const day = DATE.test(first(params.data)) ? first(params.data) : today;
  const pais = first(params.pais).trim();
  const ligaSel = first(params.liga).trim();
  const equipa = first(params.equipa).trim().toLowerCase();
  const refresh = first(params.refresh) === "1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const maps = user ? await loadMaps(supabase, user.id, "tournament").catch(() => []) : [];
  const codes = new Set(maps.map((m) => m.name_key));
  const leagues = LEAGUES.filter((l) => codes.has(l.code) && !l.code.startsWith("int."));
  const countryOf = (label: string): string => label.split("·")[0]?.trim() ?? label;
  const countries = [...new Set(leagues.map((l) => countryOf(l.label as string)))].sort((a, b) => a.localeCompare(b));
  const filterLeagues = leagues.map((l) => ({ code: l.code, label: l.label as string, country: countryOf(l.label as string) }));

  return (
    <div data-wide>
      <h1 className="mb-1 text-xl font-semibold">🧮 Estatísticas</h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Os jogos do dia das ligas mapeadas. Quando um jogo está a decorrer, aparece o minuto e abre direto na
        calculadora live.
      </p>

      <EstatisticasTabs />

      <div className="mb-4 flex max-w-4xl flex-wrap items-center gap-2">
        <Link
          href={`/estatisticas/jogos-dia?${new URLSearchParams({ data: shift(day, -1) })}`}
          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500"
        >
          ‹
        </Link>
        <Link
          href="/estatisticas/jogos-dia"
          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500"
        >
          Hoje
        </Link>
        <Link
          href={`/estatisticas/jogos-dia?${new URLSearchParams({ data: shift(day, 1) })}`}
          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500"
        >
          ›
        </Link>
        <form method="get" action="/estatisticas/jogos-dia" className="flex items-center gap-2">
          <input
            type="date"
            name="data"
            defaultValue={day}
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-500"
          />
          <button type="submit" className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500">
            Ver
          </button>
        </form>
        <span className="text-sm text-neutral-400">{dayMonth(day)}</span>
      </div>

      <DayFilters
        day={day}
        countries={countries}
        leagues={filterLeagues}
        initial={{ pais, liga: ligaSel, equipa: first(params.equipa).trim() }}
      />

      <Suspense
        key={`${day}|${pais}|${ligaSel}|${equipa}|${refresh ? "r" : ""}`}
        fallback={
          <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
            A carregar os jogos do dia… (a primeira vez demora, depois é cache)
          </p>
        }
      >
        <DayBoard day={day} today={today} pais={pais} ligaSel={ligaSel} equipa={equipa} refresh={refresh} />
      </Suspense>
    </div>
  );
}

interface DayGame {
  league: string;
  leagueLabel: string;
  home: string;
  away: string;
  time: string | null;
  ft: [number, number] | null;
  eventId: number | null;
  live: { minute: number | null; phase: string; hg: number | null; ag: number | null } | null;
}

type CachedDay = { code: string; games: Omit<DayGame, "live">[] }[];

// Bounded parallelism: the local scraper answers one read at a time, so
// unbounded Promise.all just queues dozens of chains behind each other.
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

async function DayBoard({ day, today, pais, ligaSel, equipa, refresh }: { day: string; today: string; pais: string; ligaSel: string; equipa: string; refresh: boolean }) {
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

  // The fixtures of a day barely move (only results trickle in): cache them
  // 30 minutes. The live merge below stays fresh on every load.
  const cacheKey = `dayboard:${day}`;
  const cached = refresh ? null : await cacheGet(supabase, user.id, cacheKey, 30 * 60_000).catch(() => null);
  const hit = Array.isArray(cached) ? (cached as CachedDay) : null;
  let rows: CachedDay = [];
  // Leagues whose rounds could not be read (transient scraper failure): the
  // board must neither hide that nor cache the partial result for 30 min.
  const failed = new Set<string>();
  if (hit) {
    rows = hit.filter((r) => leagues.some((l) => l.code === r.code));
  } else {
    // Day boards read a window of rounds around the current one (3 reads per
    // league instead of the whole season): today's games live there, barring
    // rescheduled ties. Seasons with no rounds at all (MLS-style) fall back
    // to the full league load for that league only.
    const teamMaps = await loadMaps(supabase, user.id, "team").catch(() => []);
    const toLocal = new Map(teamMaps.filter((m) => m.local_name).map((m) => [m.name, m.local_name]));
    const convert = (name: string): string => toLocal.get(name) ?? linkLocalName(teamMaps, name) ?? name;
    const found: CachedDay = [];
    await pool(leagues, 4, async (l) => {
      const map = maps.find((m) => m.name_key === l.code);
      if (!map) return;
      let seasons: SofaSeason[] | null = null;
      try {
        seasons = await tournamentSeasons(supabase, user.id, map.sofascore_id);
      } catch {
        failed.add(l.code);
        return;
      }
      const readWindow = async (idx: number): Promise<{ fx: SofaFixture[] | null; ok: boolean }> => {
        const s = seasons[idx];
        if (!s) return { fx: null, ok: true };
        let rounds: number[];
        let currentRound: number | null;
        try {
          ({ rounds, currentRound } = await tournamentRounds(supabase, user.id, map.sofascore_id, s.id, true));
        } catch {
          return { fx: null, ok: false };
        }
        if (rounds.length === 0) return { fx: null, ok: true };
        const want =
          currentRound !== null
            ? [currentRound - 1, currentRound, currentRound + 1].filter((r) => rounds.includes(r))
            : rounds.slice(0, 3);
        if (want.length === 0) return { fx: null, ok: true };
        const lists = await Promise.all(
          want.map((r) => roundFixtures(supabase, user.id, map.sofascore_id, s.id, r, true).then((x) => x, () => null))
        );
        // A round that throws leaves a hole the day filter cannot see: fail
        // the league instead of silently dropping its games.
        if (lists.some((x) => x === null)) return { fx: null, ok: false };
        return { fx: (lists as SofaFixture[][]).flat(), ok: true };
      };
      let read = await readWindow(0);
      if ((!read.fx || read.fx.length === 0) && read.ok && seasons.length > 1) read = await readWindow(1);
      if (!read.ok) {
        failed.add(l.code);
        return;
      }
      let fx = read.fx;
      if (!fx) {
        // No rounds at all: full load so these leagues still show something.
        const loaded = await loadSofaLeague(supabase, user.id, l.code, { history: false, shots: false, seasons: 1 }).catch(() => null);
        if (!loaded) {
          failed.add(l.code);
          return;
        }
        const games: Omit<DayGame, "live">[] = [];
        for (const f of loaded.data.fixtures) {
          if (f.date !== day) continue;
          if (equipa && !`${f.team1} ${f.team2}`.toLowerCase().includes(equipa)) continue;
          games.push({
            league: l.code,
            leagueLabel: labelOf(l.code),
            home: f.team1,
            away: f.team2,
            time: f.time ?? null,
            ft: f.ft,
            eventId: fixtureEventId(f as Fixture & { sid?: number }),
          });
        }
        if (games.length > 0) {
          games.sort((a, b) => `${a.time ?? ""}`.localeCompare(`${b.time ?? ""}`) || a.home.localeCompare(b.home));
          found.push({ code: l.code, games });
        }
        return;
      }
      const games: Omit<DayGame, "live">[] = [];
      for (const f of fx) {
        if (f.date !== day) continue;
        const home = convert(f.team1);
        const away = convert(f.team2);
        if (equipa && !`${home} ${away}`.toLowerCase().includes(equipa)) continue;
        games.push({
          league: l.code,
          leagueLabel: labelOf(l.code),
          home,
          away,
          time: f.time ?? null,
          ft: f.ft,
          eventId: f.id,
        });
      }
      if (games.length > 0) {
        games.sort((a, b) => `${a.time ?? ""}`.localeCompare(`${b.time ?? ""}`) || a.home.localeCompare(b.home));
        found.push({ code: l.code, games });
      }
    });
    rows = found;
    // Never freeze a partial board: with failed leagues the next load
    // retries instead of serving the hole for 30 minutes.
    if (rows.length > 0 && failed.size === 0) await cacheSet(supabase, user.id, cacheKey, rows).catch(() => {});
  }

  const { games: live } = await fetchSofaLiveNow(Date.now()).catch(() => ({ games: [], offline: true }));
  const liveById = new Map(live.map((g) => [g.id, g]));
  const usedLive = new Set<number>();
  const byLeague: { code: string; games: DayGame[] }[] = rows
    .map((r) => ({
      code: r.code,
      games: r.games
        .filter((g) => !equipa || `${g.home} ${g.away}`.toLowerCase().includes(equipa))
        .map((g) => {
      const lg = g.eventId !== null ? liveById.get(g.eventId) : undefined;
      if (lg) {
        usedLive.add(lg.id);
        return { ...g, live: { minute: lg.minute, phase: lg.phase, hg: lg.homeGoals, ag: lg.awayGoals } };
      }
      // Fallback: match live games by teams when the fixture carries no event id.
      const same = live.find(
        (x) => !usedLive.has(x.id) && ((x.home === g.home && x.away === g.away) || (x.home === g.away && x.away === g.home))
      );
      if (same) usedLive.add(same.id);
      return {
        ...g,
        eventId: same ? same.id : g.eventId,
        live: same ? { minute: same.minute, phase: same.phase, hg: same.homeGoals, ag: same.awayGoals } : null,
      };
    }),
  })).filter((r) => r.games.length > 0);
  byLeague.sort((a, b) => a.games[0].leagueLabel.localeCompare(b.games[0].leagueLabel));
  const liveCount = byLeague.flatMap((l) => l.games).filter((g) => g.live).length;

  if (byLeague.length === 0) {
    return (
      <div className="max-w-4xl space-y-2">
        <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
          Sem jogos das ligas mapeadas neste dia{day < today ? " (ou os resultados ainda não entraram nos dados)" : ""}.
        </p>
        {failed.size > 0 && (
          <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-center text-xs text-amber-200">
            A leitura falhou em {failed.size} liga{failed.size === 1 ? "" : "s"} — pode ser falha técnica e não falta de
            jogos.{" "}
            <Link
              href={`/estatisticas/jogos-dia?${new URLSearchParams({
                data: day,
                ...(pais ? { pais } : {}),
                ...(ligaSel ? { liga: ligaSel } : {}),
                ...(equipa ? { equipa } : {}),
                refresh: "1",
              })}`}
              className="font-medium underline"
            >
              Recarregar sem cache
            </Link>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-400">
        {byLeague.flatMap((l) => l.games).length} jogos · {liveCount} em direto
      </p>
      {failed.size > 0 && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200">
          Sem leitura em {failed.size} liga{failed.size === 1 ? "" : "s"} (
          {[...failed]
            .map((c) => labelOf(c))
            .slice(0, 6)
            .join(", ")}
          {failed.size > 6 ? ` +${failed.size - 6}` : ""}): o quadro pode estar incompleto.{" "}
          <Link
            href={`/estatisticas/jogos-dia?${new URLSearchParams({
              data: day,
              ...(pais ? { pais } : {}),
              ...(ligaSel ? { liga: ligaSel } : {}),
              ...(equipa ? { equipa } : {}),
              refresh: "1",
            })}`}
            className="font-medium underline"
          >
            Recarregar sem cache
          </Link>
        </p>
      )}
      {byLeague.map((l) => (
        <div key={l.code} className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
          <p className="border-b border-neutral-800 bg-neutral-800/40 px-4 py-2 text-sm font-semibold text-neutral-200">
            {l.games[0].leagueLabel} · {l.games.length} {l.games.length === 1 ? "jogo" : "jogos"}
          </p>
          <div className="divide-y divide-neutral-800/70">
            {l.games.map((g, i) => {
              const key = `${g.home}|${g.away}|${g.time ?? ""}|${i}`;
              const isLive = g.live !== null && (g.live.phase === "live" || g.live.phase === "halftime");
              const score = isLive
                ? `${g.live!.hg ?? "?"}–${g.live!.ag ?? "?"}`
                : g.ft
                  ? `${g.ft[0]}–${g.ft[1]}`
                  : null;
              return (
                <div key={key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                  <span className="w-16 shrink-0 tabular-nums">
                    {isLive ? (
                      <span className="font-semibold text-red-400">
                        <span aria-hidden className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                        {g.live!.phase === "halftime" ? "INT" : `${g.live!.minute ?? ""}'`}
                      </span>
                    ) : (
                      <span className="text-neutral-500">{g.time ? g.time.slice(0, 5) : day < today ? "?" : "—"}</span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 text-neutral-100">
                    {g.home} <span className="text-neutral-600">vs</span> {g.away}
                  </span>
                  {score !== null ? (
                    <span className={`shrink-0 font-semibold tabular-nums ${isLive ? "text-emerald-300" : "text-neutral-200"}`}>{score}</span>
                  ) : (
                    <span className="shrink-0 text-xs text-neutral-600">por disputar</span>
                  )}
                  {isLive && g.eventId !== null ? (
                    <Link
                      href={`/estatisticas/live?${new URLSearchParams({ sofascore: `id:${g.eventId}` })}`}
                      className="shrink-0 text-xs font-medium text-emerald-400 hover:underline"
                    >
                      Abrir no live →
                    </Link>
                  ) : (
                    <Link
                      href={`/estatisticas?${new URLSearchParams({ liga: g.league, casa: g.home, fora: g.away })}`}
                      className="shrink-0 text-xs font-medium text-neutral-400 hover:text-neutral-200 hover:underline"
                    >
                      Analisar →
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
