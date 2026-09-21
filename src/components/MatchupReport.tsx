import Link from "next/link";
import OddChecker, { type OddMarket } from "./OddChecker";
import { formatOdd } from "@/lib/multiples";
import { VALUE_MARGIN, baseRates, recommend, type Pick } from "@/lib/recommendation";
import { seasonLabel, seasonStartDate, seasonsFor } from "@/lib/footballData";
import { isAdjusted, parts, strengthRatio, teamFactor, type TeamAdjust } from "@/lib/adjustments";
import {
  OVER_LINES,
  fairOdd,
  gamesOf,
  goalsByHalf,
  headToHead,
  predict,
  resultFor,
  seasonOf,
  summarize,
  type Fixture,
  type GoalsByHalf,
  type PlayedMatch,
  type Prediction,
  type Summary,
  type TeamGame,
} from "@/lib/footballModel";

const CARD = "rounded-xl border border-neutral-800 bg-neutral-900 p-4";

function pct(p: number): string {
  return p < 0.1 ? `${(p * 100).toFixed(1).replace(".", ",")}%` : `${Math.round(p * 100)}%`;
}

function oddText(p: number): string {
  return p >= 0.005 ? formatOdd(fairOdd(p)) : "—";
}

const dot = (n: number) => n.toFixed(1).replace(".", ",");
const shortDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "2-digit" });

interface Row {
  label: string;
  p: number;
}

function MarketTable({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className={CARD}>
      <h3 className="mb-2 text-sm font-semibold text-neutral-300">{title}</h3>
      <div className="space-y-1.5 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-neutral-200">{row.label}</span>
            <span className="flex shrink-0 items-center gap-3">
              <span className="w-12 text-right font-medium text-amber-300">{pct(row.p)}</span>
              <span className="w-14 text-right text-xs text-neutral-500">@{oddText(row.p)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultBar({ home, draw, away }: { home: number; draw: number; away: number }) {
  return (
    <div className="flex h-2.5 overflow-hidden rounded-full bg-neutral-800">
      <div className="bg-emerald-500" style={{ width: `${home * 100}%` }} />
      <div className="bg-neutral-500" style={{ width: `${draw * 100}%` }} />
      <div className="bg-sky-500" style={{ width: `${away * 100}%` }} />
    </div>
  );
}

const CHIP = {
  V: "bg-emerald-600 text-white",
  E: "bg-neutral-600 text-white",
  D: "bg-red-600 text-white",
} as const;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-neutral-500">{label}</span>
      <span className="font-medium text-neutral-200">{value}</span>
    </div>
  );
}

function SummaryBlock({ title, summary }: { title: string; summary: Summary | null }) {
  if (!summary) return null;
  return (
    <div className="mt-3">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
        {title} · {summary.games} {summary.games === 1 ? "jogo" : "jogos"}
      </p>
      <div className="space-y-0.5">
        <Stat label="V / E / D" value={`${summary.wins} / ${summary.draws} / ${summary.losses}`} />
        <Stat label="Golos marcados / jogo" value={dot(summary.gfPerGame)} />
        <Stat label="Golos sofridos / jogo" value={dot(summary.gaPerGame)} />
        <Stat label="Ambas marcam" value={`${Math.round(summary.bothScorePct)}%`} />
        <Stat label="Mais de 2,5 golos" value={`${Math.round(summary.over25Pct)}%`} />
        <Stat label="Sem sofrer golos" value={`${Math.round(summary.cleanSheetPct)}%`} />
      </div>
    </div>
  );
}

function TeamCard({
  name,
  role,
  games,
  venue,
  season,
}: {
  name: string;
  role: string;
  // This season's games, most recent first.
  games: TeamGame[];
  venue: "home" | "away";
  season: string;
}) {
  const last5 = games.slice(0, 5);
  const atVenue = games.filter((g) => g.home === (venue === "home"));
  return (
    <div className={CARD}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
        {role} · época {season}
      </p>
      <h3 className="mb-2 text-base font-semibold text-neutral-100">{name}</h3>

      <div className="flex flex-wrap gap-1.5">
        {last5.length === 0 && (
          <span className="text-xs text-neutral-500">Ainda sem jogos esta época.</span>
        )}
        {last5.map((g) => (
          // Opens straight away on hover (and on focus, for touch), unlike the
          // browser's own tooltip, and spells the game out home team first.
          <span key={`${g.date}-${g.opponent}`} className="group relative">
            <span
              tabIndex={0}
              className={`flex h-7 min-w-7 cursor-help items-center justify-center rounded-md px-1.5 text-xs font-bold outline-none ring-white/60 focus-visible:ring-2 ${CHIP[g.result]}`}
            >
              {g.result}
            </span>
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 hidden w-max max-w-[18rem] rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-left shadow-xl group-focus-within:block group-hover:block"
            >
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                {shortDate(g.date)} · {g.home ? "em casa" : "fora"}
              </span>
              <span className="block text-xs text-neutral-200">
                {g.home ? name : g.opponent}{" "}
                <span className="font-bold text-neutral-100">
                  {g.home ? `${g.gf}–${g.ga}` : `${g.ga}–${g.gf}`}
                </span>{" "}
                {g.home ? g.opponent : name}
              </span>
            </span>
          </span>
        ))}
        {last5.length > 0 && (
          <span className="self-center pl-1 text-[11px] text-neutral-500">últimos 5 (mais recente primeiro)</span>
        )}
      </div>

      <SummaryBlock title="Esta época" summary={summarize(games)} />
      <SummaryBlock
        title={venue === "home" ? "Esta época em casa" : "Esta época fora"}
        summary={summarize(atVenue)}
      />
    </div>
  );
}

const dayMonth = (date: string) => date.slice(8, 10) + "/" + date.slice(5, 7);

const SCORE_STYLE = {
  V: "bg-emerald-600/30 text-emerald-300",
  E: "bg-amber-500/25 text-amber-300",
  D: "bg-red-600/30 text-red-300",
} as const;

function GameRow({ fixture, team, today }: { fixture: Fixture; team: string; today: string }) {
  const result = resultFor(fixture, team);
  // Still no result although the date has passed: the data is a few days behind.
  const score = fixture.ft ? `${fixture.ft[0]}-${fixture.ft[1]}` : fixture.date < today ? "?" : "-";
  const name = (n: string) =>
    n === team ? "font-semibold text-neutral-100" : "text-neutral-400";
  return (
    <div className="grid grid-cols-[2.6rem_1fr_3.2rem_1fr] items-center gap-2 py-1 text-xs">
      <span className="text-neutral-500">{dayMonth(fixture.date)}</span>
      <span className={`truncate text-right ${name(fixture.team1)}`}>{fixture.team1}</span>
      <span
        className={`rounded px-1 py-0.5 text-center font-semibold ${
          result ? SCORE_STYLE[result] : "bg-neutral-800 text-neutral-500"
        }`}
      >
        {score}
      </span>
      <span className={`truncate ${name(fixture.team2)}`}>{fixture.team2}</span>
    </div>
  );
}

// One team's league season, in the way of the classic results tables: the last
// games with the score coloured by the team's result, the next ones, and every
// game of the season on request.
function TeamSeason({ team, fixtures, today }: { team: string; fixtures: Fixture[]; today: string }) {
  const all = seasonOf(fixtures, team);
  // A game whose date has passed but has no result yet belongs with the past
  // ones (marked "?"): the data is a few days behind, not the game still to come.
  const isPast = (f: Fixture) => f.ft !== null || f.date < today;
  const last = all.filter(isPast).slice(-10).reverse();
  const behind = last.some((f) => !f.ft);
  const next = all.filter((f) => !isPast(f)).slice(0, 3);
  const heading = "mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500";
  return (
    <div className={CARD}>
      <h3 className="mb-2 text-base font-semibold text-neutral-100">{team}</h3>

      <p className={heading}>Últimos jogos da liga</p>
      {last.length === 0 ? (
        <p className="text-xs text-neutral-500">Ainda sem jogos esta época.</p>
      ) : (
        <div className="divide-y divide-neutral-800/60">
          {last.map((f) => (
            <GameRow key={`${f.date}-${f.team1}`} fixture={f} team={team} today={today} />
          ))}
        </div>
      )}

      {behind && (
        <p className="mt-1.5 text-[11px] text-amber-400">
          ? = resultado ainda não nos dados: a fonte atualiza-se com alguns dias de atraso.
        </p>
      )}

      <p className={`${heading} mt-4`}>Próximos jogos</p>
      {next.length === 0 ? (
        <p className="text-xs text-neutral-500">Sem mais jogos da liga nos dados.</p>
      ) : (
        <div className="divide-y divide-neutral-800/60">
          {next.map((f) => (
            <GameRow key={`${f.date}-${f.team1}`} fixture={f} team={team} today={today} />
          ))}
        </div>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-amber-400 hover:underline">
          Ver todos os jogos da época ({all.length})
        </summary>
        <div className="mt-2 divide-y divide-neutral-800/60">
          {all.map((f) => (
            <GameRow key={`${f.date}-${f.team1}`} fixture={f} team={team} today={today} />
          ))}
        </div>
      </details>
    </div>
  );
}

// Goals scored (green) and conceded (red) in each half, bars on one scale for
// both teams so they can be compared.
function HalfBars({ label, scored, conceded, max }: { label: string; scored: number; conceded: number; max: number }) {
  const bar = (n: number, color: string) => (
    <div className="flex items-center gap-2">
      <span className="w-4 text-right text-xs font-medium text-neutral-200">{n}</span>
      <div className="h-2 flex-1">
        {n > 0 && <div className={`h-full rounded-full ${color}`} style={{ width: `${(n / max) * 100}%` }} />}
      </div>
    </div>
  );
  return (
    <div className="grid grid-cols-[4.5rem_1fr] items-center gap-3 rounded-lg bg-neutral-950 px-3 py-2">
      <span className="text-xs font-semibold text-neutral-300">{label}</span>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-[11px] text-neutral-500">Marcados</span>
          <div className="flex-1">{bar(scored, "bg-emerald-500")}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-[11px] text-neutral-500">Sofridos</span>
          <div className="flex-1">{bar(conceded, "bg-red-500")}</div>
        </div>
      </div>
    </div>
  );
}

function HalvesCard({ team, halves, max }: { team: string; halves: GoalsByHalf; max: number }) {
  return (
    <div className={CARD}>
      <h3 className="mb-2 text-base font-semibold text-neutral-100">{team}</h3>
      {halves.games === 0 ? (
        <p className="text-xs text-neutral-500">Ainda sem jogos esta época.</p>
      ) : (
        <div className="space-y-2">
          <HalfBars label="1.ª parte" scored={halves.firstFor} conceded={halves.firstAgainst} max={max} />
          <HalfBars label="2.ª parte" scored={halves.secondFor} conceded={halves.secondAgainst} max={max} />
          <p className="text-[11px] text-neutral-500">
            {halves.games} {halves.games === 1 ? "jogo" : "jogos"} desta época.
          </p>
        </div>
      )}
    </div>
  );
}

// What was adjusted by hand and what it did to the expected goals.
function AdjustmentsCard({
  home,
  away,
  homeAdjust,
  awayAdjust,
  before,
  after,
}: {
  home: string;
  away: string;
  homeAdjust: TeamAdjust;
  awayAdjust: TeamAdjust;
  before: Prediction;
  after: Prediction;
}) {
  const line = (team: string, adjust: TeamAdjust) => {
    const list = parts(adjust);
    const change = (teamFactor(adjust) - 1) * 100;
    return (
      <p className="text-xs text-neutral-300">
        <span className="font-medium text-neutral-100">{team}:</span>{" "}
        {list.length === 0 ? "sem ajustes" : list.map((p) => p.label).join(", ")}
        {list.length > 0 && (
          <span className={change < 0 ? "text-red-400" : "text-emerald-400"}>
            {" "}
            → {change > 0 ? "+" : ""}
            {change.toFixed(1).replace(".", ",")}%
          </span>
        )}
      </p>
    );
  };
  return (
    <div className={CARD}>
      <h3 className="mb-2 text-sm font-semibold text-neutral-300">Ajustes aplicados</h3>
      <div className="space-y-1">
        {line(home, homeAdjust)}
        {line(away, awayAdjust)}
      </div>
      <p className="mt-2 text-xs text-neutral-400">
        Golos esperados: {dot(before.lambdaHome)} – {dot(before.lambdaAway)} sem ajustes,{" "}
        <span className="font-medium text-neutral-200">
          {dot(after.lambdaHome)} – {dot(after.lambdaAway)}
        </span>{" "}
        com eles.
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
        Os testes de fiabilidade que a página cita foram feitos sem ajustes: com eles, as probabilidades valem o que
        valer a tua avaliação.
      </p>
    </div>
  );
}

function SuggestedBet({ picks, few }: { picks: Pick[]; few: boolean }) {
  const [main, ...others] = picks;
  const line = (pick: Pick) => (
    <p className="text-xs text-neutral-400">
      Chance estimada <span className="font-medium text-neutral-200">{pct(pick.p)}</span> · média da liga{" "}
      {pct(pick.base)} · odd justa {formatOdd(pick.fairOdd)} ·{" "}
      <span className="font-medium text-emerald-400">compensa a partir de {formatOdd(pick.minOdd)}</span>
    </p>
  );

  return (
    <div className="rounded-xl border border-amber-700/50 bg-amber-950/20 p-4">
      <h3 className="mb-2 text-sm font-semibold text-amber-300">Aposta sugerida</h3>

      {few ? (
        <p className="text-sm text-neutral-400">
          Há poucos jogos destas equipas nos dados para sugerir uma aposta com alguma confiança.
        </p>
      ) : !main ? (
        <p className="text-sm text-neutral-400">
          Sem aposta clara: o modelo não vê nenhum mercado com vantagem suficiente sobre a média da liga. Não apostar
          também é uma decisão.
        </p>
      ) : (
        <>
          <p className="text-base font-semibold text-neutral-100">{main.label}</p>
          {line(main)}
          {others.length > 0 && (
            <div className="mt-3 space-y-2 border-t border-amber-900/40 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Outras opções</p>
              {others.map((pick) => (
                <div key={pick.label}>
                  <p className="text-sm font-medium text-neutral-200">{pick.label}</p>
                  {line(pick)}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
        Sem a odd real da casa não dá para saber se uma aposta compensa: só compensa se a odd oferecida for maior do que
        a indicada (a odd justa mais {Math.round(VALUE_MARGIN * 100)}%). Compara no quadro em baixo. Acertar muitas vezes
        não é o mesmo que ganhar dinheiro, porque os favoritos pagam pouco. Nos golos e em ambas marcam a chance está
        puxada para a média da liga, porque o modelo exagera nesses mercados.
      </p>
    </div>
  );
}

function buildMarkets(prediction: Prediction): { groups: { title: string; rows: Row[] }[]; odd: OddMarket[] } {
  const ft = prediction.fullTime;
  const ht = prediction.halfTime;
  const overRows = OVER_LINES.filter((l) => l <= 3.5).flatMap((line) => [
    { label: `Mais de ${dot(line)} golos`, p: prediction.over[String(line)] },
    { label: `Menos de ${dot(line)} golos`, p: 1 - prediction.over[String(line)] },
  ]);
  const groups = [
    {
      title: "Resultado final",
      rows: [
        { label: "Casa vence", p: ft.home },
        { label: "Empate", p: ft.draw },
        { label: "Fora vence", p: ft.away },
        { label: "Casa ou empate (1X)", p: ft.home + ft.draw },
        { label: "Fora ou empate (X2)", p: ft.away + ft.draw },
        { label: "Sem empate (12)", p: ft.home + ft.away },
      ],
    },
    { title: "Golos", rows: overRows },
    {
      title: "Ambas marcam",
      rows: [
        { label: "Sim", p: prediction.bothScore },
        { label: "Não", p: 1 - prediction.bothScore },
      ],
    },
    {
      title: "Ao intervalo",
      rows: [
        { label: "Casa ganha ao intervalo", p: ht.home },
        { label: "Empate ao intervalo", p: ht.draw },
        { label: "Fora ganha ao intervalo", p: ht.away },
        { label: "Mais de 0,5 golos na 1.ª parte", p: ht.over05 },
        { label: "Mais de 1,5 golos na 1.ª parte", p: ht.over15 },
      ],
    },
    {
      title: "Resultados exatos mais prováveis",
      rows: prediction.topScores.map((s) => ({ label: `${s.home}-${s.away}`, p: s.p })),
    },
  ];
  const odd: OddMarket[] = groups.flatMap((g) => g.rows.map((r) => ({ group: g.title, label: r.label, p: r.p })));
  return { groups, odd };
}

export default function MatchupReport({
  matches,
  home,
  away,
  leagueLabel,
  latest,
  swapHref,
  now,
  fixtures,
  adjust,
}: {
  matches: PlayedMatch[];
  home: string;
  away: string;
  leagueLabel: string;
  latest: string | null;
  swapHref: string;
  now: Date;
  fixtures: Fixture[];
  adjust: { home: TeamAdjust; away: TeamAdjust };
}) {
  const adjusted = isAdjusted(adjust.home, adjust.away);
  const prediction = predict(matches, home, away, now, strengthRatio(adjust.home, adjust.away));
  const unadjusted = adjusted ? predict(matches, home, away, now) : prediction;
  const { groups, odd } = buildMarkets(prediction);

  // The teams' own records count only this season (from 1 July); the estimate
  // above still leans on the earlier seasons, which it needs.
  const seasonStart = seasonStartDate(now);
  const thisSeason = (team: string) => gamesOf(matches, team).filter((g) => g.date >= seasonStart);
  const homeGames = thisSeason(home);
  const awayGames = thisSeason(away);
  const season = seasonLabel(seasonsFor(now, 1)[0]);
  const homeHalves = goalsByHalf(matches, home, seasonStart);
  const awayHalves = goalsByHalf(matches, away, seasonStart);
  const halvesMax = Math.max(
    1,
    homeHalves.firstFor, homeHalves.firstAgainst, homeHalves.secondFor, homeHalves.secondAgainst,
    awayHalves.firstFor, awayHalves.firstAgainst, awayHalves.secondFor, awayHalves.secondAgainst
  );
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  // Head to head looks at every season in the data.
  const meetings = headToHead(matches, home, away);
  const h2h = { home: 0, draw: 0, away: 0 };
  for (const m of meetings) {
    const homeGoals = m.team1 === home ? m.ft[0] : m.ft[1];
    const awayGoals = m.team1 === home ? m.ft[1] : m.ft[0];
    if (homeGoals > awayGoals) h2h.home++;
    else if (homeGoals === awayGoals) h2h.draw++;
    else h2h.away++;
  }

  const few = Math.min(prediction.gamesHome, prediction.gamesAway) < 8;
  const picks = few ? [] : recommend(prediction, baseRates(matches), home, away);
  // The suggestions first, priced with their own (pulled back) chance, so the
  // comparer opens on the suggested bet.
  const oddMarkets: OddMarket[] = [
    ...picks.map((p) => ({ group: "Aposta sugerida", label: p.label, p: p.p })),
    ...odd,
  ];

  return (
    <div className="mt-6 space-y-4">
      <div className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-neutral-500">{leagueLabel}</p>
            <h2 className="text-lg font-semibold text-neutral-100">
              {home} <span className="text-neutral-500">vs</span> {away}
            </h2>
          </div>
          <Link href={swapHref} className="text-xs font-medium text-amber-400 hover:underline">
            ↔ Trocar casa e fora
          </Link>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-2xl font-bold text-emerald-400">{pct(prediction.fullTime.home)}</p>
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">Casa · @{oddText(prediction.fullTime.home)}</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-neutral-300">{pct(prediction.fullTime.draw)}</p>
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">Empate · @{oddText(prediction.fullTime.draw)}</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-sky-400">{pct(prediction.fullTime.away)}</p>
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">Fora · @{oddText(prediction.fullTime.away)}</p>
          </div>
        </div>
        <div className="mt-2">
          <ResultBar {...prediction.fullTime} />
        </div>

        <p className="mt-3 text-xs text-neutral-400">
          Golos esperados:{" "}
          <span className="font-medium text-neutral-200">
            {dot(prediction.lambdaHome)} – {dot(prediction.lambdaAway)}
          </span>
          . Dados até {latest ? shortDate(latest) : "?"}.
        </p>
        {few && (
          <p className="mt-2 rounded-lg bg-amber-950 px-3 py-2 text-xs text-amber-300">
            Há poucos jogos destas equipas nos dados ({prediction.gamesHome} e {prediction.gamesAway}), por isso a
            estimativa é frágil.
          </p>
        )}
      </div>

      {adjusted && (
        <AdjustmentsCard
          home={home}
          away={away}
          homeAdjust={adjust.home}
          awayAdjust={adjust.away}
          before={unadjusted}
          after={prediction}
        />
      )}

      <SuggestedBet picks={picks} few={few} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          {groups.map((g) => (
            <MarketTable key={g.title} title={g.title} rows={g.rows} />
          ))}
        </div>

        <div className="space-y-4">
          <TeamCard name={home} role="Casa" games={homeGames} venue="home" season={season} />
          <TeamCard name={away} role="Fora" games={awayGames} venue="away" season={season} />

          <div className={CARD}>
            <h3 className="mb-2 text-sm font-semibold text-neutral-300">Confrontos diretos</h3>
            {meetings.length === 0 ? (
              <p className="text-xs text-neutral-500">Sem jogos entre as duas equipas nos dados.</p>
            ) : (
              <>
                <p className="mb-2 text-xs text-neutral-400">
                  {home}: {h2h.home} vitórias · {h2h.draw} empates · {away}: {h2h.away} vitórias
                </p>
                <div className="space-y-1 text-xs">
                  {meetings.slice(0, 6).map((m) => (
                    <div key={`${m.date}-${m.team1}`} className="flex items-center justify-between gap-2 text-neutral-300">
                      <span className="text-neutral-500">{shortDate(m.date)}</span>
                      <span className="min-w-0 flex-1 truncate text-right">
                        {m.team1} <span className="font-semibold text-neutral-100">{m.ft[0]}–{m.ft[1]}</span> {m.team2}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-1 text-sm font-semibold text-neutral-300">Momento dos golos · época {season}</h2>
        <p className="mb-3 text-xs text-neutral-500">
          Por parte do jogo: os minutos exatos dos golos não estão nos dados gratuitos (só existem para Inglaterra,
          Alemanha e Áustria em 2025/26). As barras usam a mesma escala nas duas equipas.
        </p>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <HalvesCard team={home} halves={homeHalves} max={halvesMax} />
          <HalvesCard team={away} halves={awayHalves} max={halvesMax} />
        </div>
      </div>

      <div>
        <h2 className="mb-1 text-sm font-semibold text-neutral-300">Jogos da liga · época {season}</h2>
        <p className="mb-3 text-xs text-neutral-500">
          Só os jogos da liga: as taças e as provas europeias não estão nos dados gratuitos.
        </p>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <TeamSeason team={home} fixtures={fixtures} today={today} />
          <TeamSeason team={away} fixtures={fixtures} today={today} />
        </div>
      </div>

      <OddChecker markets={oddMarkets} />

      <p className="text-xs leading-relaxed text-neutral-500">
        Estimativa estatística a partir dos golos das últimas épocas (modelo de Poisson). Não sabe de lesões, castigos,
        onze inicial nem motivação. Testado nos jogos de 2025/26 das 7 maiores ligas, previu bem quem ganha (acertou em
        cerca de 55% dos jogos, contra 46% se se apostasse sempre na média da liga), mas em mais/menos golos e ambas
        marcam ficou perto da média da liga, por isso nesses mercados vale pouco mais do que a média. Usa-o como
        referência, não como garantia.
      </p>
    </div>
  );
}
