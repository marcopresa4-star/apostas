import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES, isInternational } from "@/lib/footballData";
import { createClient } from "@/lib/supabase/server";
import { loadMaps, seasonFixtures, tournamentSeasons, type SofaFixture } from "@/lib/sofaHistory";
import { predict, type PlayedMatch } from "@/lib/footballModel";
import {
  calibration,
  favouriteSegments,
  marketRates,
  splitChronology,
  type MarketRates,
  type Predictor,
  type Segment,
} from "@/lib/leagueProfile";
import { cacheGetAny } from "@/lib/sofaCache";
import { COMPARE_SORTS, compareSort, sortSnapshots, type LeagueCompareIndex } from "@/lib/leagueCompare";
import { first } from "@/lib/searchParams";
import EstatisticasTabs from "@/components/EstatisticasTabs";
import LeaguePicker from "@/components/LeaguePicker";
import LeagueGoalMinutes, { computeSeasonGoalMinutes } from "@/components/LeagueGoalMinutes";
import BuildCompareButton from "./buttons";
import Icon from "@/components/Icon";

// What a league really did this season, market by market: real frequencies
// (with the fair odd they imply), the same numbers split by half of the season
// and by favourite/even game, and how the model priced those games before
// kick-off. Everything comes from the fixtures list (result + half-time); goal
// minutes need one incidents read per game, so they sit behind ?minutos=1.

const pct = (v: number): string => `${(v * 100).toFixed(1).replace(".", ",")}%`;
const odd = (p: number): string => (p > 0 ? (1 / p).toFixed(2).replace(".", ",") : "—");
const num = (v: number): string => v.toFixed(2).replace(".", ",");

const predictor: Predictor = (prior, home, away, when) => {
  const p = predict(prior, home, away, when);
  return {
    over15: p.over["1.5"],
    over25: p.over["2.5"],
    btts: p.bothScore,
    home: p.fullTime.home,
    draw: p.fullTime.draw,
    away: p.fullTime.away,
  };
};

const toPlayed = (fixtures: SofaFixture[]): PlayedMatch[] =>
  fixtures.flatMap((f) =>
    f.ft ? [{ date: f.date, team1: f.team1, team2: f.team2, ft: f.ft, ht: f.ht }] : []
  );

interface Line {
  label: string;
  games: number;
  value: number;
}

const marketLines = (r: MarketRates): Line[] => [
  { label: "Over 0,5", games: r.games, value: r.over05 },
  { label: "Over 1,5", games: r.games, value: r.over15 },
  { label: "Over 2,5", games: r.games, value: r.over25 },
  { label: "Over 3,5", games: r.games, value: r.over35 },
  { label: "Ambas marcam", games: r.games, value: r.btts },
  { label: "Vitória casa", games: r.games, value: r.homeWin },
  { label: "Empate", games: r.games, value: r.draw },
  { label: "Vitória fora", games: r.games, value: r.awayWin },
  { label: "Golo na 1.ª parte", games: r.withHt, value: r.firstHalfGoal },
  { label: "0-0 ao intervalo", games: r.withHt, value: r.ht00 },
  { label: "Golo nas 2 partes", games: r.withHt, value: r.bothHalves },
  { label: "Reviravolta", games: r.withHt, value: r.comeback },
];

function MarketTable({ rates, compact = false }: { rates: MarketRates; compact?: boolean }) {
  const lines = marketLines(rates);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="py-1.5 pr-3 font-medium">Mercado</th>
            {!compact && <th className="py-1.5 pr-3 font-medium">Jogos</th>}
            <th className="py-1.5 pr-3 font-medium">Aconteceu</th>
            <th className="py-1.5 font-medium">Odd justa</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {lines.map((l) => (
            <tr key={l.label} className={l.games < 5 ? "text-neutral-500" : ""}>
              <td className="py-1.5 pr-3">{l.label}</td>
              {!compact && <td className="py-1.5 pr-3 text-neutral-400">{l.games}</td>}
              <td className="py-1.5 pr-3 font-medium text-neutral-100">
                {l.games > 0 ? pct(l.value) : "—"}
              </td>
              <td className="py-1.5 text-neutral-400">{l.games > 0 ? odd(l.value) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SegmentTable({ segments }: { segments: Segment[] }) {
  if (segments.length === 0) {
    return <p className="text-sm text-neutral-500">Sem jogos suficientes para dividir.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="py-1.5 pr-3 font-medium">Segmento</th>
            <th className="py-1.5 pr-3 font-medium">Jogos</th>
            <th className="py-1.5 pr-3 font-medium">Golos/jogo</th>
            <th className="py-1.5 pr-3 font-medium">Over 2,5</th>
            <th className="py-1.5 pr-3 font-medium">Ambas</th>
            <th className="py-1.5 font-medium">2 partes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {segments.map((s) => (
            <tr key={s.label} className={s.rates.games < 5 ? "text-neutral-500" : ""}>
              <td className="py-1.5 pr-3 text-neutral-300">{s.label}</td>
              <td className="py-1.5 pr-3 text-neutral-400">{s.rates.games}</td>
              <td className="py-1.5 pr-3 font-medium text-neutral-100">{num(s.rates.perGame)}</td>
              <td className="py-1.5 pr-3 text-neutral-200">{pct(s.rates.over25)}</td>
              <td className="py-1.5 pr-3 text-neutral-200">{pct(s.rates.btts)}</td>
              <td className="py-1.5 text-neutral-200">
                {s.rates.withHt > 0 ? pct(s.rates.bothHalves) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function PerfilLigaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const liga = first(params.liga);
  const wantsMinutes = first(params.minutos) === "1";
  const sortKey = compareSort(first(params.ordem));
  const league = LEAGUES.find((l) => l.code === liga && !isInternational(l.code)) ?? null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const maps = user ? await loadMaps(supabase, user.id, "tournament").catch(() => []) : [];
  const compareHit = user ? await cacheGetAny(supabase, user.id, "leaguecompare:v2").catch(() => null) : null;
  const compare = (compareHit?.payload as LeagueCompareIndex | undefined) ?? null;
  const tournamentMap = league ? maps.find((m) => m.name_key === league.code) ?? null : null;

  let fixtures: SofaFixture[] = [];
  let seasonName = "";
  let seasonId: number | null = null;
  let failed = false;
  if (league && tournamentMap && user) {
    try {
      const seasons = await tournamentSeasons(supabase, user.id, tournamentMap.sofascore_id);
      const season = seasons[0] ?? null;
      if (season) {
        seasonId = season.id;
        seasonName = season.name || season.year;
        fixtures = await seasonFixtures(
          supabase,
          user.id,
          tournamentMap.sofascore_id,
          season.id,
          true,
          new Date().toISOString().slice(0, 10)
        );
      }
    } catch {
      failed = true;
    }
  }

  const played = toPlayed(fixtures);
  const rates = marketRates(played);
  const chronology = splitChronology(played);
  const segments = played.length > 20 ? favouriteSegments(played, predictor) : [];
  const calib = played.length > 20 ? calibration(played, predictor) : [];
  const fragile = rates.games > 0 && rates.games < 5;

  const minutesHref = league
    ? `/estatisticas/perfil-liga?${new URLSearchParams({ liga: league.code, minutos: "1" })}`
    : "#";

  return (
    <div data-wide>
      <h1 className="hero-title mb-3">
        <Icon name="calc" className="mr-2 inline-block h-8 w-8 -translate-y-0.5 text-emerald-300" />{" "}
        <span className="title-glow">Estatísticas</span>
        <span className="hero-underline" />
      </h1>
      <p className="mb-4 text-sm text-neutral-500">
        O que esta liga realmente fez na época: frequência de cada mercado, como muda ao longo da época e entre jogos
        equilibrados e desequilibrados, e onde o modelo esteve otimista ou pessimista.
      </p>

      <EstatisticasTabs />
      <LeaguePicker
        leagues={LEAGUES.filter((l) => !isInternational(l.code))}
        liga={league?.code ?? ""}
        action="/estatisticas/perfil-liga"
        keep={wantsMinutes ? { minutos: "1" } : {}}
      />

      {league && !tournamentMap && (
        <p className="mb-4 max-w-4xl rounded-xl border border-dashed border-white/[0.07] px-4 py-3 text-xs leading-relaxed text-neutral-400">
          Sem dados desta liga no SofaScore.{" "}
          <Link href="/estatisticas/mapa" className="font-medium text-emerald-400 hover:underline">
            Mapear no Mapa SofaScore
          </Link>
          .
        </p>
      )}

      {failed && (
        <p className="rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">
          Não foi possível ler os jogos desta época (scraper desligado?). Tenta outra vez daqui a pouco.
        </p>
      )}

      {league && tournamentMap && !failed && rates.games === 0 && (
        <p className="rounded-xl border border-dashed border-white/[0.07] px-4 py-8 text-center text-sm text-neutral-500">
          Ainda não há jogos terminados nesta época.
        </p>
      )}

      {league && rates.games > 0 && (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
              <p className="text-xs text-neutral-500">Jogos com resultado</p>
              <p className="mt-1 text-2xl font-semibold text-neutral-100">{rates.games}</p>
              <p className="mt-0.5 text-xs text-neutral-500">{seasonName}</p>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
              <p className="text-xs text-neutral-500">Golos por jogo</p>
              <p className="mt-1 text-2xl font-semibold text-neutral-100">{num(rates.perGame)}</p>
              <p className="mt-0.5 text-xs text-neutral-500">
                {num(rates.homeGoals)} em casa · {num(rates.awayGoals)} fora
              </p>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
              <p className="text-xs text-neutral-500">Over 2,5</p>
              <p className="mt-1 text-2xl font-semibold text-neutral-100">{pct(rates.over25)}</p>
              <p className="mt-0.5 text-xs text-neutral-500">odd justa {odd(rates.over25)}</p>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
              <p className="text-xs text-neutral-500">Ambas marcam</p>
              <p className="mt-1 text-2xl font-semibold text-neutral-100">{pct(rates.btts)}</p>
              <p className="mt-0.5 text-xs text-neutral-500">odd justa {odd(rates.btts)}</p>
            </div>
          </div>

          {fragile && (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
              Amostra frágil: menos de 5 jogos. As percentagens são indicativas, não um padrão.
            </p>
          )}

          <section className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
            <h2 className="mb-1 text-sm font-semibold text-neutral-200">Frequência real por mercado</h2>
            <p className="mb-3 text-xs text-neutral-500">
              Percentagem dos jogos em que o mercado aconteceu. «Odd justa» é 1 ÷ frequência — a odd a partir da qual
              uma aposta nesse mercado passa a ter valor esperado positivo se a frequência se mantiver.
            </p>
            <MarketTable rates={rates} />
          </section>

          <section className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
            <h2 className="mb-1 text-sm font-semibold text-neutral-200">Segmentos</h2>
            <p className="mb-3 text-xs text-neutral-500">
              A média esconde assimetrias. A primeira metade da época é comparada com a segunda (por data), e os jogos
              em que o modelo dava 55%+ a um lado são separados dos jogos equilibrados — sempre com o modelo tal como
              estava antes de cada jogo.
            </p>
            <div className="space-y-4">
              <div>
                <p className="mb-1 text-xs font-medium text-neutral-400">Por altura da época</p>
                <SegmentTable segments={chronology} />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-neutral-400">Por equilíbrio do jogo</p>
                {segments.length > 0 ? (
                  <SegmentTable segments={segments} />
                ) : (
                  <p className="text-sm text-neutral-500">
                    Ainda não há jogos suficientes depois dos primeiros 20 para separar favoritos de jogos
                    equilibrados.
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
            <h2 className="mb-1 text-sm font-semibold text-neutral-200">Calibração do modelo nesta liga</h2>
            <p className="mb-3 text-xs text-neutral-500">
              Cada jogo é avaliado só com os jogos anteriores (walk-forward). «Modelo» é a probabilidade média que o
              modelo dava; «Real» é a frequência que aconteceu. O Brier mede o erro: 0 é perfeito, 0,25 é o mesmo que
              atirar uma moeda ao ar.
            </p>
            {calib.length === 0 ? (
              <p className="text-sm text-neutral-500">
                São precisos mais de 20 jogos nesta época para a calibração ter sentido.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-wide text-neutral-500">
                    <tr>
                      <th className="py-1.5 pr-3 font-medium">Mercado</th>
                      <th className="py-1.5 pr-3 font-medium">Jogos</th>
                      <th className="py-1.5 pr-3 font-medium">Modelo</th>
                      <th className="py-1.5 pr-3 font-medium">Real</th>
                      <th className="py-1.5 pr-3 font-medium">Desvio</th>
                      <th className="py-1.5 font-medium">Brier</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {calib.map((row) => {
                      const diff = row.real - row.model;
                      return (
                        <tr key={row.key}>
                          <td className="py-1.5 pr-3 text-neutral-300">{row.label}</td>
                          <td className="py-1.5 pr-3 text-neutral-400">{row.games}</td>
                          <td className="py-1.5 pr-3 text-neutral-200">{pct(row.model)}</td>
                          <td className="py-1.5 pr-3 font-medium text-neutral-100">{pct(row.real)}</td>
                          <td
                            className={`py-1.5 pr-3 ${
                              Math.abs(diff) < 0.05
                                ? "text-neutral-400"
                                : diff > 0
                                  ? "text-emerald-300"
                                  : "text-amber-300"
                            }`}
                          >
                            {diff > 0 ? "+" : ""}
                            {(diff * 100).toFixed(1).replace(".", ",")} pp
                          </td>
                          <td className="py-1.5 text-neutral-400">{row.brier.toFixed(3).replace(".", ",")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-xs leading-relaxed text-neutral-500">
              Desvio positivo: aconteceu mais do que o modelo dizia (modelo cauteloso neste mercado). Negativo:
              aconteceu menos (modelo otimista). Com poucos jogos, o desvio é ruído.
            </p>
          </section>

          {league && seasonId !== null && (
            <section>
              {!wantsMinutes ? (
                <div className="rounded-xl border border-dashed border-white/[0.07] px-4 py-6 text-center">
                  <p className="mb-1 text-sm text-neutral-300">Minutos dos golos</p>
                  <p className="mb-3 text-xs text-neutral-500">
                    Distribuição dos golos por bloco de 15 minutos, a partir dos incidentes de cada jogo. A primeira
                    leitura lê um jogo de cada vez (demora alguns minutos); depois fica em cache.
                  </p>
                  <Link
                    href={minutesHref}
                    className="btn-glow inline-block px-3 py-1.5 text-sm"
                  >
                    Calcular minutos dos golos
                  </Link>
                </div>
              ) : (
                <Suspense
                  key={`${league.code}:${seasonId}`}
                  fallback={
                    <p className="rounded-xl border border-dashed border-white/[0.07] px-4 py-10 text-center text-sm text-neutral-500">
                      A ler os minutos dos golos ({rates.games} jogos, um de cada vez)… depois fica em cache.
                    </p>
                  }
                >
                  <GoalMinutesSection
                    code={league.code}
                    uniqueId={tournamentMap!.sofascore_id}
                    seasonId={seasonId}
                    userId={user!.id}
                  />
                </Suspense>
              )}
            </section>
          )}

          <div className="space-y-1.5 text-xs leading-relaxed text-neutral-500">
            <p>
              Tudo aqui vem dos jogos já terminados desta época (resultado e intervalo). Sem cantos e cartões: o
              histórico não os traz. Sem odds reais: a odd justa é só 1 ÷ frequência.
            </p>
            <p>Linhas esbatidas: menos de 5 jogos — amostra frágil.</p>
          </div>
        </div>
      )}

      <section className="mt-8 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-neutral-200">Comparador das ligas</h2>
          <BuildCompareButton
            hasIndex={compare !== null}
            rows={compare?.rows.length ?? 0}
            total={compare?.total ?? 0}
          />
        </div>
        <p className="mb-3 text-xs leading-relaxed text-neutral-500">
          As mesmas frequências, para todas as ligas mapeadas, lado a lado: onde se marca mais, onde a casa manda mais e
          onde os golos chegam mais cedo. A construção lê a época inteira de cada liga (uma leitura por jornada), por
          isso avança em lotes de quatro e pode ser retomada; depois fica em cache.
        </p>
        {!compare || compare.rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-white/[0.07] px-4 py-6 text-center text-sm text-neutral-500">
            Ainda sem tabela. Carrega em «Calcular todas as ligas» para a construir.
          </p>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-neutral-500">Ordenar por</span>
              {COMPARE_SORTS.map((s) => {
                const href = `/estatisticas/perfil-liga?${new URLSearchParams({
                  ...(league ? { liga: league.code } : {}),
                  ordem: s.key,
                })}`;
                return (
                  <Link
                    key={s.key}
                    href={href}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      sortKey === s.key
                        ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40"
                        : "bg-neutral-900 text-neutral-400 hover:bg-white/[0.06]"
                    }`}
                  >
                    {s.label}
                  </Link>
                );
              })}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">Liga</th>
                    <th className="py-1.5 pr-3 font-medium">Jogos</th>
                    <th className="py-1.5 pr-3 font-medium">Golos/jogo</th>
                    <th className="py-1.5 pr-3 font-medium">Over 2,5</th>
                    <th className="py-1.5 pr-3 font-medium">Ambas</th>
                    <th className="py-1.5 pr-3 font-medium">2 partes</th>
                    <th className="py-1.5 pr-3 font-medium">Casa</th>
                    <th className="py-1.5 pr-3 font-medium">1.ª parte</th>
                    <th className="py-1.5 font-medium">Reviravolta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {sortSnapshots(compare.rows, sortKey).map((row) => (
                    <tr key={row.code} className={row.games < 5 ? "text-neutral-500" : ""}>
                      <td className="py-1.5 pr-3">
                        <Link
                          href={`/estatisticas/perfil-liga?${new URLSearchParams({ liga: row.code, ordem: sortKey })}`}
                          className="text-neutral-200 hover:text-emerald-300"
                        >
                          {row.label}
                        </Link>
                        <span className="ml-1.5 text-[11px] text-neutral-600">{row.season}</span>
                      </td>
                      <td className="py-1.5 pr-3 text-neutral-400">{row.games}</td>
                      <td className="py-1.5 pr-3 font-medium text-neutral-100">{num(row.rates.perGame)}</td>
                      <td className="py-1.5 pr-3 text-neutral-200">{pct(row.rates.over25)}</td>
                      <td className="py-1.5 pr-3 text-neutral-200">{pct(row.rates.btts)}</td>
                      <td className="py-1.5 pr-3 text-neutral-200">
                        {row.rates.withHt > 0 ? pct(row.rates.bothHalves) : "—"}
                      </td>
                      <td className="py-1.5 pr-3 text-neutral-200">{pct(row.rates.homeWin)}</td>
                      <td className="py-1.5 pr-3 text-neutral-200">
                        {row.rates.withHt > 0 ? pct(row.rates.firstHalfGoal) : "—"}
                      </td>
                      <td className="py-1.5 text-neutral-300">
                        {row.rates.withHt > 0 ? pct(row.rates.comeback) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              {compare.rows.length < compare.total ? (
                <>
                  Em construção: {compare.rows.length} de {compare.total} ligas. Carrega outra vez para continuar de
                  onde ficou.
                </>
              ) : compare.at > 0 ? (
                <>
                  Tabela de{" "}
                  {new Date(compare.at).toLocaleString("pt-PT", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  . {compare.rows.length} ligas com dados
                </>
              ) : (
                <>{compare.rows.length} ligas com dados</>
              )}
              {compare.missing.length > 0 && (
                <> · {compare.missing.length} sem dados ({compare.missing.map((m) => m.label).join(", ")})</>
              )}
              . Linhas esbatidas: menos de 5 jogos.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

async function GoalMinutesSection({
  code,
  uniqueId,
  seasonId,
  userId,
}: {
  code: string;
  uniqueId: number;
  seasonId: number;
  userId: string;
}) {
  const supabase = await createClient();
  const data = await computeSeasonGoalMinutes(supabase, userId, code, uniqueId, seasonId);
  if (data.games === 0) {
    return (
      <p className="rounded-xl border border-dashed border-white/[0.07] px-4 py-8 text-center text-sm text-neutral-500">
        Sem incidentes utilizáveis nos jogos desta época.
      </p>
    );
  }
  return <LeagueGoalMinutes data={data} />;
}
