import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES } from "@/lib/footballData";
import { createClient } from "@/lib/supabase/server";
import { linkLocalName, loadMaps, seasonTeamNames, tournamentSeasons } from "@/lib/sofaHistory";
import { slugify } from "@/lib/slugify";
import { loadSofaLeague, teamGoalTiming } from "@/lib/sofaLeague";
import { gamesOf } from "@/lib/footballModel";
import { first } from "@/lib/searchParams";
import EstatisticasTabs from "@/components/EstatisticasTabs";
import TeamSearch from "@/components/TeamSearch";
import { TeamForm } from "@/components/RecentForm";
import { GoalTimingCard, VenueGoalsCard } from "@/components/MatchupReport";

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

async function TeamSearchLoader({ userId }: { userId: string }) {
  const supabase = await createClient();
  const maps = await loadMaps(supabase, userId, "tournament").catch(() => []);
  const codes = new Set(maps.map((m) => m.name_key));
  const leagues = LEAGUES.filter((l) => codes.has(l.code) && !l.code.startsWith("int."));
  const byLeague = await pool(leagues, 8, async (l) => {
    const seasons = await tournamentSeasons(supabase, userId, maps.find((m) => m.name_key === l.code)!.sofascore_id).catch(() => []);
    if (seasons.length === 0) return [];
    const teams = await seasonTeamNames(supabase, userId, maps.find((m) => m.name_key === l.code)!.sofascore_id, seasons[0].id, true).catch(
      () => [] as string[]
    );
    return teams.map((team) => ({ team, league: l.code, leagueLabel: l.label as string }));
  });
  const index = byLeague.flat();
  if (index.length === 0) return null;
  return <TeamSearch index={index} base="/estatisticas/equipa" teamKey="equipa" />;
}

export default async function EquipaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const liga = first(params.liga);
  const equipaRaw = first(params.equipa);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div data-wide>
      <h1 className="mb-1 text-2xl font-bold tracking-tight">🔍 <span className="title-glow">Análise Equipa</span></h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Escolhe uma equipa das ligas mapeadas e vê a época, a forma e quando marca e sofre.
      </p>
      <EstatisticasTabs />
      {user && (
        <Suspense fallback={null}>
          <TeamSearchLoader userId={user.id} />
        </Suspense>
      )}
      {user && liga && equipaRaw && (
        <Suspense key={`${liga}|${equipaRaw}`} fallback={<p className="text-sm text-neutral-500">A carregar…</p>}>
          <EquipaBody liga={liga} equipa={equipaRaw} userId={user.id} />
        </Suspense>
      )}
    </div>
  );
}

async function EquipaBody({ liga, equipa, userId }: { liga: string; equipa: string; userId: string }) {
  const supabase = await createClient();
  const league = LEAGUES.find((l) => l.code === liga) ?? null;
  if (!league) return <p className="text-sm text-neutral-400">Liga desconhecida.</p>;
  const sofa = await loadSofaLeague(supabase, userId, league.code, { history: true }).catch(() => null);
  const data = sofa?.data ?? null;
  if (!data) return <p className="text-sm text-neutral-400">Sem dados desta liga.</p>;

  let team = equipa;
  if (!data.teams.includes(team)) {
    const teamMaps = await loadMaps(supabase, userId, "team").catch(() => []);
    team = linkLocalName(teamMaps, team) ?? team;
  }
  if (!data.teams.includes(team)) {
    // Same team, different SofaScore spelling across endpoints ("Feyenoord"
    // vs "Feyenoord Rotterdam"): accept an unambiguous containment match.
    const needle = slugify(team);
    const cands = data.teams.filter((t) => {
      const s = slugify(t);
      return s === needle || s.includes(needle) || needle.includes(s);
    });
    if (cands.length === 1) team = cands[0];
  }
  if (!data.teams.includes(team)) {
    return (
      <p className="max-w-4xl rounded-xl border border-dashed border-white/[0.07] px-4 py-6 text-center text-sm text-neutral-500">
        "{equipa}" não está nos dados ({league.label}).{" "}
        <Link href="/estatisticas/mapa" className="font-medium text-emerald-400 hover:underline">
          Ver no Mapa
        </Link>
      </p>
    );
  }

  const tg = gamesOf(data.matches, team);
  const wins = tg.filter((g) => g.gf > g.ga).length;
  const draws = tg.filter((g) => g.gf === g.ga).length;
  const losses = tg.length - wins - draws;
  const over = tg.length > 0 ? Math.round((tg.filter((g) => g.gf + g.ga > 2.5).length / tg.length) * 100) : 0;
  const timing = await teamGoalTiming(supabase, userId, league.code, team).catch(() => null);
  const next = data.fixtures
    .filter((f) => (f.team1 === team || f.team2 === team) && !f.ft)
    .sort((a, b) => `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`))
    .slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="glass p-4 shadow-sm">
        <p className="text-[11px] uppercase tracking-wide text-neutral-500">{league.label}</p>
        <h2 className="text-lg font-semibold text-neutral-100">{team}</h2>
        <p className="mt-1 text-sm text-neutral-300">
          Época: <span className="font-medium text-neutral-100">{tg.length}J</span> ·{" "}
          <span className="font-medium text-emerald-300">{wins}V</span> ·{" "}
          <span className="font-medium text-neutral-200">{draws}E</span> ·{" "}
          <span className="font-medium text-red-300">{losses}D</span> ·{" "}
          <span className="font-medium text-neutral-100">Over 2,5 {over}%</span>
        </p>
      </div>

      <VenueGoalsCard
        home={team}
        away={team}
        homeGames={tg.filter((g) => g.home)}
        awayGames={tg.filter((g) => !g.home)}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TeamForm team={team} matches={data.matches} />
        <div className="space-y-4">
          <GoalTimingCard home={team} away="" timing={{ home: timing, away: null }} />
          <div className="glass p-4">
            <h3 className="mb-2 text-sm font-semibold text-neutral-300">Próximos jogos</h3>
            {next.length === 0 ? (
              <p className="text-xs text-neutral-500">Sem jogos marcados nos dados.</p>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {next.map((f) => (
                  <div key={`${f.date}-${f.team1}`} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                    <span className="text-neutral-500">
                      {f.date.slice(8, 10)}/{f.date.slice(5, 7)}{f.time ? ` ${f.time.slice(0, 5)}` : ""}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-neutral-200">
                      {f.team1} <span className="text-neutral-600">vs</span> {f.team2}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
