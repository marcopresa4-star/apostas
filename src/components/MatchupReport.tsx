import Link from "next/link";
import { Fragment } from "react";
import OddChecker, { type OddMarket } from "./OddChecker";
import ValueHunt, { type ValueItem } from "./ValueHunt";
import FormChart from "./FormChart";
import H2HPatternCard from "./H2HPatternCard";
import StandingsTable, { type StandingsLine } from "./StandingsTable";
import { buildStandings, formOf, ratings } from "@/lib/standings";
import type { GoalTiming, OfficialStanding } from "@/lib/sofaLeague";
import { h2hPattern } from "@/lib/headToHeadPattern";
import { formatOdd } from "@/lib/multiples";
import {
  MIN_GAMES,
  SOLID_GAMES,
  VALUE_MARGIN,
  ahWinPush,
  baseRates,
  candidatesFor,
  matchTotalOver,
  matchTotalPush,
  pickWhy,
  recommend,
  teamTotalWinPush,
  type Pick,
} from "@/lib/recommendation";
import type { SeasonInfo } from "@/lib/footballData";
import { isAdjusted, parts, strengthRatio, teamFactor, type TeamAdjust } from "@/lib/adjustments";
import { extraToFixture, extraToTeamGame, type ExtraGame } from "@/lib/extraGames";
import {
  OVER_LINES,
  blendedStrength,
  fairOdd,
  gamesOf,
  headToHead,
  leagueRates,
  predict,
  resultFor,
  seasonOf,
  shotRates,
  shotStrengthOf,
  strengthOf,
  summarize,
  type Fixture,
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
  // The model's market key ("home", "over:2.5", "ht:home"...): links the row
  // to the bookmaker's real odd.
  key?: string;
  // Chance the stake comes back (draws on DNB, exact ties): the fair odd
  // pays it out.
  push?: number;
}

// Fair odd of a row, paying the refund out when pushes exist.
function rowFair(row: Row): number {
  if (!(row.p > 0)) return Infinity;
  const push = row.push ?? 0;
  return push > 0 ? (1 - push) / row.p : 1 / row.p;
}

function MarketTable({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className={CARD}>
      <h3 className="mb-2 text-sm font-semibold text-neutral-300">{title}</h3>
      <div className="space-y-1.5 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-neutral-200">
              {row.label}
              {row.push !== undefined && row.push >= 0.005 && (
                <span className="ml-1.5 text-[10px] text-neutral-500">devolve {Math.round(row.push * 100)}%</span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-3">
              <span className="w-12 text-right font-medium text-amber-300">{pct(row.p)}</span>
              <span className="w-14 text-right text-xs text-neutral-500">
                @{Number.isFinite(rowFair(row)) ? formatOdd(rowFair(row)) : "—"}
              </span>
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

// One result chip with the hover card that spells the game out, home team
// first. Opens straight away on hover (and on focus, for touch), unlike the
// browser's own tooltip.
function ResultChip({ game, name }: { game: TeamGame; name: string }) {
  return (
    <span className="group relative">
      <span
        tabIndex={0}
        className={`flex h-7 min-w-7 cursor-help items-center justify-center rounded-md px-1.5 text-xs font-bold outline-none ring-white/60 focus-visible:ring-2 ${CHIP[game.result]}`}
      >
        {game.result}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 hidden w-max max-w-[18rem] rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-left shadow-xl group-focus-within:block group-hover:block"
      >
        <span className="block text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
          {shortDate(game.date)} · {game.competition ? `${game.competition} · ` : ""}
          {game.neutral ? "campo neutro" : game.home ? "em casa" : "fora"}
        </span>
        <span className="block text-xs text-neutral-200">
          {game.home ? name : game.opponent}{" "}
          <span className="font-bold text-neutral-100">
            {game.home ? `${game.gf}–${game.ga}` : `${game.ga}–${game.gf}`}
          </span>{" "}
          {game.home ? game.opponent : name}
        </span>
      </span>
    </span>
  );
}

function TeamCard({
  name,
  role,
  games,
  venue,
  season,
  pending,
  international,
}: {
  name: string;
  role: string;
  // This season's games, most recent first.
  games: TeamGame[];
  venue: "home" | "away";
  // "época 26/27", or "últimos 12 meses" for national teams.
  season: string;
  // Games whose date has passed but whose result is not in the data yet.
  pending: Fixture[];
  international: boolean;
}) {
  const typed = games.filter((g) => g.competition !== undefined).length;
  const last5 = games.slice(0, 5);
  // (A game at a neutral venue was not played at home or away.)
  const atVenue = games.filter((g) => g.home === (venue === "home") && !g.neutral);
  return (
    <div className={CARD}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
        {role} · {season}
      </p>
      <h3 className="mb-2 text-base font-semibold text-neutral-100">{name}</h3>

      <div className="flex flex-wrap gap-1.5">
        {last5.length === 0 && pending.length === 0 && (
          <span className="text-xs text-neutral-500">Ainda sem jogos esta época.</span>
        )}
        {pending.map((f) => (
          // A game already played whose result the data does not have yet.
          <span key={`pending-${f.date}-${f.team1}`} className="group relative">
            <span
              tabIndex={0}
              className="flex h-7 min-w-7 cursor-help items-center justify-center rounded-md border border-dashed border-neutral-500 px-1.5 text-xs font-bold text-neutral-300 outline-none ring-white/60 focus-visible:ring-2"
            >
              ?
            </span>
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 hidden w-max max-w-[18rem] rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-left shadow-xl group-focus-within:block group-hover:block"
            >
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                {shortDate(f.date)} · {f.team1 === name ? "em casa" : "fora"}
              </span>
              <span className="block text-xs text-neutral-200">
                {f.team1} <span className="font-bold text-neutral-100">?–?</span> {f.team2}
              </span>
              <span className="block text-[10px] text-amber-400">resultado ainda não nos dados</span>
            </span>
          </span>
        ))}
        {last5.map((g) => (
          <ResultChip key={`${g.date}-${g.opponent}`} game={g} name={name} />
        ))}
        {(last5.length > 0 || pending.length > 0) && (
          <span className="self-center pl-1 text-[11px] text-neutral-500">últimos 5 (mais recente primeiro)</span>
        )}
      </div>

      {pending.length > 0 && (
        <p className="mt-2 text-[11px] text-amber-400">
          ? = jogo já disputado sem resultado nos dados (a fonte atrasa-se alguns dias). Os números abaixo não
          o contam.
        </p>
      )}
      {typed > 0 && (
        <p className="mt-2 text-[11px] text-amber-500/80">
          Inclui {typed} {typed === 1 ? "jogo acrescentado" : "jogos acrescentados"} por ti.
        </p>
      )}
      {atVenue.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Forma {venue === "home" ? "em casa" : "fora"}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {atVenue.slice(0, 5).map((g) => (
              <ResultChip key={`v-${g.date}-${g.opponent}`} game={g} name={name} />
            ))}
            <span className="pl-1 text-[11px] text-neutral-500">últimos 5 (mais recente primeiro)</span>
          </div>
        </div>
      )}
      <FormChart name={name} games={games} />
      <SummaryBlock title={international ? "Últimos 12 meses" : "Esta época"} summary={summarize(games)} />
      <SummaryBlock
        title={`${international ? "Últimos 12 meses" : "Esta época"} ${venue === "home" ? "em casa" : "fora"}`}
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
    <div className="grid grid-cols-[3.2rem_1fr_3.2rem_1fr] items-center gap-2 py-1 text-xs">
      <span className="text-neutral-500">
        {dayMonth(fixture.date)}
        {fixture.competition && (
          <span title={fixture.competition} className="block truncate text-[9px] leading-tight text-amber-500/80">
            {fixture.competition}
          </span>
        )}
      </span>
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
function TeamSeason({
  team,
  fixtures,
  extras,
  today,
  international,
}: {
  team: string;
  fixtures: Fixture[];
  extras: ExtraGame[];
  today: string;
  international: boolean;
}) {
  // The league from the data plus the games typed in, by date. The extras are
  // per team: a rival's extras must not end up in this team's list.
  const all = [...seasonOf(fixtures, team), ...extras.map((g) => extraToFixture(g, team))].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
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

      <p className={heading}>{international ? "Últimos jogos" : "Últimos jogos da liga"}</p>
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
        <p className="text-xs text-neutral-500">
          {international ? "Não há jogos marcados nos dados." : "Sem mais jogos da liga nos dados."}
        </p>
      ) : (
        <div className="divide-y divide-neutral-800/60">
          {next.map((f) => (
            <GameRow key={`${f.date}-${f.team1}`} fixture={f} team={team} today={today} />
          ))}
        </div>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-amber-400 hover:underline">
          {international ? "Ver todos os jogos dos últimos 12 meses" : "Ver todos os jogos da época"} ({all.length})
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

// How each side's blended attack (goals half, shots half, same maths as the
// ratings) stood after each of its last games: rising means improving,
// falling means fading. The dashed line is the league average (1,00).
function FormCurve({
  home,
  away,
  homeCurve,
  awayCurve,
}: {
  home: string;
  away: string;
  homeCurve: { date: string; attack: number }[];
  awayCurve: { date: string; attack: number }[];
}) {
  const W = 560;
  const H = 170;
  const PAD = 30;
  const n = Math.max(homeCurve.length, awayCurve.length);
  if (n < 2) return null;
  const vals = [...homeCurve, ...awayCurve].map((p) => p.attack);
  const lo = Math.min(0.7, ...vals);
  const hi = Math.max(1.3, ...vals);
  const x = (i: number) => PAD + (n === 1 ? 0 : (i / (n - 1)) * (W - PAD * 2));
  const y = (v: number) => H - PAD - ((v - lo) / (hi - lo || 1)) * (H - PAD * 2);
  const line = (curve: { attack: number }[]): string =>
    curve.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.attack).toFixed(1)}`).join(" ");
  const dates = homeCurve.length >= awayCurve.length ? homeCurve : awayCurve;
  const dayMonth = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  return (
    <div className={CARD}>
      <h3 className="mb-1 text-sm font-semibold text-neutral-300">Evolução da força (ataque, últimos {n} jogos)</h3>
      <div className="mb-1 flex items-center gap-4 text-[11px]">
        <span className="flex items-center gap-1 text-emerald-300">
          <span aria-hidden className="inline-block h-0.5 w-4 bg-emerald-400" />
          {home} {homeCurve.length > 0 && homeCurve[homeCurve.length - 1].attack.toFixed(2).replace(".", ",")}
        </span>
        <span className="flex items-center gap-1 text-sky-300">
          <span aria-hidden className="inline-block h-0.5 w-4 bg-sky-400" />
          {away} {awayCurve.length > 0 && awayCurve[awayCurve.length - 1].attack.toFixed(2).replace(".", ",")}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Evolução do ataque de ${home} e ${away}`}>
        <line x1={PAD} y1={y(1)} x2={W - PAD} y2={y(1)} stroke="#525252" strokeWidth="1" strokeDasharray="4 3" />
        <text x={PAD - 4} y={y(1) + 3} textAnchor="end" fontSize="9" fill="#737373">
          1,00
        </text>
        <path d={line(awayCurve)} fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
        <path d={line(homeCurve)} fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" />
        {homeCurve.map((p, i) => (
          <circle key={`h${i}`} cx={x(i)} cy={y(p.attack)} r="2.5" fill="#34d399" />
        ))}
        {awayCurve.map((p, i) => (
          <circle key={`a${i}`} cx={x(i)} cy={y(p.attack)} r="2.5" fill="#38bdf8" />
        ))}
        {dates.map((d, i) =>
          i % Math.ceil(n / 5) === 0 ? (
            <text key={d.date} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#737373">
              {dayMonth(d.date)}
            </text>
          ) : null
        )}
      </svg>
      <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
        A subir é a melhorar, a descer a piorar. Conta golos e remates com mais peso nos jogos recentes, como as
        probabilidades.
      </p>
    </div>
  );
}

// When each side scores and concedes, per 15 minutes over its last games with
// incident data (stoppage time counts in 31–45 and 76'–fim). Bars scale to the
// busiest block of each column.
function GoalTimingCard({
  home,
  away,
  timing,
}: {
  home: string;
  away: string;
  timing: { home: GoalTiming | null; away: GoalTiming | null };
}) {
  const PERIODS = ["0–15", "16–30", "31–45", "46–60", "61–75", "76'–fim"];
  const column = (team: string, t: GoalTiming, color: string) => {
    const max = Math.max(1, ...t.scored, ...t.conceded);
    return (
      <div className="min-w-0 flex-1">
        <p className={`mb-1.5 truncate text-xs font-medium ${color}`}>
          {team} <span className="font-normal text-neutral-500">· {t.games} jogos</span>
        </p>
        <div className="space-y-1.5">
          {PERIODS.map((label, i) => (
            <div key={label}>
              <p className="mb-0.5 text-[10px] font-semibold text-neutral-500">{label}</p>
              {(
                [
                  ["G.Marc", t.scored[i], "bg-emerald-500/80"],
                  ["G.Sofr", t.conceded[i], "bg-red-500/80"],
                ] as const
              ).map(([kind, n, bar]) => (
                <div key={kind} className="flex items-center gap-1.5">
                  <span className="w-11 shrink-0 text-[10px] text-neutral-500">{kind}</span>
                  <span className="w-3 shrink-0 text-right text-[11px] font-medium text-neutral-200">{n}</span>
                  <div className="h-1.5 min-w-0 flex-1">
                    {n > 0 && <div className={`h-full rounded-full ${bar}`} style={{ width: `${(n / max) * 100}%` }} />}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  };
  return (
    <div className={CARD}>
      <h3 className="mb-2 text-sm font-semibold text-neutral-300">Momento dos golos (por 15&apos;)</h3>
      <div className="flex gap-4">
        {timing.home && column(home, timing.home, "text-emerald-300")}
        {timing.away && column(away, timing.away, "text-sky-300")}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
        Os períodos 31–45 e 76&apos;–fim incluem os descontos. Só contam jogos da liga com dados de incidentes.
      </p>
    </div>
  );
}

// Goals split by venue over the last games, like the classic golos tables:
// averages scored/conceded/total, clean sheets, scoreless games and over/under
// 2,5 — for home games, away games and overall. The column matching the side's
// role in this fixture is shaded.
function VenueGoalsCard({
  home,
  away,
  homeGames,
  awayGames,
}: {
  home: string;
  away: string;
  homeGames: TeamGame[];
  awayGames: TeamGame[];
}) {
  const LAST = 10;
  interface Split { n: number; gf: string; ga: string; total: string; clean: string; blank: string; over: string; under: string }
  const dash = "–";
  const avg = (n: number, games: number): string => (games === 0 ? dash : (n / games).toFixed(1).replace(".", ","));
  const share = (n: number, games: number): string => (games === 0 ? dash : `${Math.round((n / games) * 100)}%`);
  const split = (games: TeamGame[]): Split => ({
    n: games.length,
    gf: avg(games.reduce((s, g) => s + g.gf, 0), games.length),
    ga: avg(games.reduce((s, g) => s + g.ga, 0), games.length),
    total: avg(games.reduce((s, g) => s + g.gf + g.ga, 0), games.length),
    clean: share(games.filter((g) => g.ga === 0).length, games.length),
    blank: share(games.filter((g) => g.gf === 0).length, games.length),
    over: share(games.filter((g) => g.gf + g.ga > 2.5).length, games.length),
    under: share(games.filter((g) => g.gf + g.ga < 2.5).length, games.length),
  });
  const table = (team: string, games: TeamGame[], role: "home" | "away") => {
    const last = games.slice(0, LAST);
    const sets = [split(last.filter((g) => g.home)), split(last.filter((g) => !g.home)), split(last)];
    const rows: [string, (s: Split) => string][] = [
      ["Média de golos marcados por jogo", (s) => s.gf],
      ["Média de golos sofridos por jogo", (s) => s.ga],
      ["Média de golos marcados+sofridos", (s) => s.total],
      ["Jogos sem sofrer", (s) => s.clean],
      ["Jogos sem marcar golos", (s) => s.blank],
      ["Jogos com mais de 2,5 golos", (s) => s.over],
      ["Jogos com menos de 2,5 golos", (s) => s.under],
    ];
    return (
      <div className="min-w-0 flex-1">
        <p className={`mb-2 truncate text-sm font-semibold ${role === "home" ? "text-emerald-300" : "text-sky-300"}`}>
          {team} <span className="font-normal text-neutral-500">· últimos {last.length} jogos</span>
        </p>
        <div className="grid grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] gap-x-2 text-xs">
          <span />
          {(["Casa", "Fora", "Global"] as const).map((label, i) => (
            <span
              key={label}
              className={`rounded-t px-1 py-1 text-center text-[11px] font-semibold ${
                (role === "home") === (i === 0) ? "bg-neutral-800 text-neutral-100" : "text-neutral-500"
              }`}
            >
              {label}
            </span>
          ))}
          {rows.map(([label, get]) => (
            <Fragment key={label}>
              <span className="py-1 pr-1 leading-tight text-neutral-400">{label}</span>
              {sets.map((s, i) => (
                <span
                  key={i}
                  className={`px-1 py-1 text-center font-medium text-neutral-100 ${
                    (role === "home") === (i === 0) ? "bg-neutral-800/60" : ""
                  }`}
                >
                  {get(s)}
                </span>
              ))}
            </Fragment>
          ))}
        </div>
      </div>
    );
  };
  return (
    <div className={CARD}>
      <h3 className="mb-2 text-sm font-semibold text-neutral-300">Golos por recinto</h3>
      <div className="flex flex-col gap-5 lg:flex-row lg:gap-6">
        {table(home, homeGames, "home")}
        {table(away, awayGames, "away")}
      </div>
    </div>
  );
}

// Combined markets per team and head to head: BTTS and over 2.5, BTTS or
// over 2.5, and winning both halves (needs half-time scores: games without
// them don't count). Teams over their last 10 games, H2H over the meetings.
interface ComboGame {
  gf: number;
  ga: number;
  htGF: number | null;
  htGA: number | null;
}

function ComboCard({
  home,
  away,
  homeGames,
  awayGames,
  meetings,
}: {
  home: string;
  away: string;
  homeGames: ComboGame[];
  awayGames: ComboGame[];
  meetings: { home: ComboGame[]; away: ComboGame[] };
}) {
  const pct = (n: number, d: number): string => (d === 0 ? "–" : `${Math.round((n / d) * 100)}%`);
  const btts = (g: ComboGame): boolean => g.gf > 0 && g.ga > 0;
  const over25 = (g: ComboGame): boolean => g.gf + g.ga > 2.5;
  const share = (games: ComboGame[], test: (g: ComboGame) => boolean): string =>
    pct(games.filter(test).length, games.length);
  const halves = (games: ComboGame[]): string => {
    const withHt = games.filter((g) => g.htGF !== null && g.htGA !== null);
    const won = withHt.filter((g) => g.htGF! > g.htGA! && g.gf - g.htGF! > g.ga - g.htGA!).length;
    return pct(won, withHt.length);
  };
  // Scored in both halves, from the team's own point of view (venue doesn't
  // matter). Needs half-time scores like everything below.
  const scoresBoth = (games: ComboGame[]): string => {
    const withHt = games.filter((g) => g.htGF !== null && g.htGA !== null);
    return pct(withHt.filter((g) => g.htGF! > 0 && g.gf - g.htGF! > 0).length, withHt.length);
  };
  const bothHalves = (games: ComboGame[]): string => {
    const withHt = games.filter((g) => g.htGF !== null && g.htGA !== null);
    return pct(
      withHt.filter((g) => g.htGF! + g.htGA! > 0 && g.gf - g.htGF! + (g.ga - g.htGA!) > 0).length,
      withHt.length
    );
  };
  const h2hGames = [...meetings.home, ...meetings.away];
  const rows: [string, string, string, string][] = [
    [
      "Ambas marcam e +2,5",
      share(homeGames, (g) => btts(g) && over25(g)),
      share(awayGames, (g) => btts(g) && over25(g)),
      share(h2hGames, (g) => btts(g) && over25(g)),
    ],
    [
      "Ambas marcam ou +2,5",
      share(homeGames, (g) => btts(g) || over25(g)),
      share(awayGames, (g) => btts(g) || over25(g)),
      share(h2hGames, (g) => btts(g) || over25(g)),
    ],
    ["Vence as 2 partes", halves(homeGames), halves(awayGames), `${halves(meetings.home)} casa · ${halves(meetings.away)} fora`],
    [
      "Golos nas 2 partes",
      bothHalves(homeGames),
      bothHalves(awayGames),
      bothHalves(h2hGames),
    ],
    [
      "Marca nas 2 partes",
      scoresBoth(homeGames),
      scoresBoth(awayGames),
      `${scoresBoth(meetings.home)} casa · ${scoresBoth(meetings.away)} fora`,
    ],
  ];
  return (
    <div className={CARD}>
      <h3 className="mb-1 text-sm font-semibold text-neutral-300">Combinados</h3>
      <p className="mb-2 text-[11px] text-neutral-500">
        Últimos 10 jogos de cada uma; no confronto, todos os jogos. As 2 partes só contam com intervalo nos dados.
      </p>
      <div className="grid grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))] gap-x-2 text-xs tabular-nums">
        <span />
        {[home, away, "Direto"].map((label) => (
          <span key={label} className="truncate px-1 py-1 text-center text-[11px] font-semibold text-neutral-400">
            {label}
          </span>
        ))}
        {rows.map(([label, a, b, c]) => (
          <Fragment key={label}>
            <span className="py-1 pr-1 leading-tight text-neutral-400">{label}</span>
            {[a, b, c].map((v, i) => (
              <span key={i} className="px-1 py-1 text-center font-medium text-neutral-100">
                {v}
              </span>
            ))}
          </Fragment>
        ))}
      </div>
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
  notes,
  venueWeight,
}: {
  home: string;
  away: string;
  homeAdjust: TeamAdjust;
  awayAdjust: TeamAdjust;
  before: Prediction;
  after: Prediction;
  notes: string[];
  venueWeight: number;
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
        {venueWeight > 0 && (
          <p className="text-xs text-neutral-300">
            <span className="font-medium text-neutral-100">Forma em casa e fora:</span> peso de{" "}
            {Math.round(venueWeight * 100)}% (
            <span className="text-amber-400">nos testes piorou a previsão de quem ganha</span>)
          </p>
        )}
      </div>
      {notes.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {notes.map((note) => (
            <p key={note} className="text-[11px] text-neutral-500">
              {note}
            </p>
          ))}
        </div>
      )}
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

function SuggestedBet({
  picks,
  few,
  fragileGames,
  avg,
  realByKey,
  realOpenByKey,
  whyCtx,
}: {
  picks: Pick[];
  few: boolean;
  // "média da liga", or "média das seleções".
  avg: string;
  // The fewest games in the data among the two teams when that is too few for the
  // estimate to beat the league's own rates; null when it is not.
  fragileGames: number | null;
  // The bookmaker's real odds by model key, when the game is priced.
  realByKey?: Record<string, number>;
  // Opening odds by model key, for the line movement readout.
  realOpenByKey?: Record<string, number>;
  // What the "why" sentence is built from (same numbers, never invented).
  whyCtx?: { matches: PlayedMatch[]; home: string; away: string; prediction: Prediction };
}) {
  const [main, ...others] = picks;
  const steam = (key: string, current: number): string | null => {
    const open = realOpenByKey?.[key];
    if (open === undefined || open <= 1 || current <= 1) return null;
    const move = ((open - current) / open) * 100;
    if (Math.abs(move) < 3) return null;
    return `abriu ${formatOdd(open)} ${move > 0 ? "↘" : "↗"} ${Math.abs(Math.round(move))}%`;
  };
  const line = (pick: Pick) => {
    const real = realByKey?.[pick.key];
    const why = whyCtx ? pickWhy(pick, whyCtx) : "";
    const movement = real !== undefined ? steam(pick.key, real) : null;
    const pushText =
      pick.push !== undefined && pick.push >= 0.005
        ? ` · devolve ${Math.round(pick.push * 100)}%`
        : "";
    return (
      <p className="text-xs text-neutral-400">
        Chance estimada <span className="font-medium text-neutral-200">{pct(pick.p)}</span> · {avg}{" "}
        {pct(pick.base)} · odd justa {formatOdd(pick.fairOdd)}
        {pick.push !== undefined && pick.push >= 0.005 && (
          <span className="text-neutral-500"> · devolve {Math.round(pick.push * 100)}%</span>
        )}
        {pushText} ·{" "}
        <span className="font-medium text-emerald-400">compensa a partir de {formatOdd(pick.minOdd)}</span>
        {real !== undefined && (
          <>
            {" "}· na casa <span className="font-medium text-neutral-100">{formatOdd(real)}</span>{" "}
            <span className={`font-medium ${real >= pick.minOdd ? "text-emerald-400" : "text-red-400"}`}>
              {real >= pick.minOdd ? "compensa" : "não chega"}
            </span>
            {movement && <span className="text-neutral-500"> · {movement}</span>}
          </>
        )}
        {why && (
          <span className="mt-0.5 block text-[11px] leading-relaxed text-neutral-500">Porquê: {why}</span>
        )}
      </p>
    );
  };

  return (
    <div className="rounded-xl border border-amber-700/50 bg-amber-950/20 p-4">
      <h3 className="mb-2 text-sm font-semibold text-amber-300">Aposta sugerida</h3>

      {few ? (
        <p className="text-sm text-neutral-400">
          Há poucos jogos destas equipas nos dados (menos de {MIN_GAMES} numa delas) para sugerir uma aposta com alguma
          confiança.
        </p>
      ) : !main ? (
        <p className="text-sm text-neutral-400">
          Sem aposta clara: o modelo não vê nenhum mercado com vantagem suficiente sobre a {avg}. Não apostar
          também é uma decisão.
        </p>
      ) : (
        <>
          {fragileGames !== null && (
            <p className="mb-2 rounded-lg bg-amber-950 px-3 py-2 text-xs text-amber-300">
              Estimativa frágil: uma das equipas só tem {fragileGames} jogos nos dados. Abaixo de {SOLID_GAMES} o modelo
              ainda não ganha à {avg}, por isso vê esta sugestão como palpite, não como vantagem.
            </p>
          )}
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
        a indicada (a odd justa com margem: 3% no resultado, 8% nos golos e em ambas marcam). Compara no quadro em baixo. Acertar muitas vezes
        não é o mesmo que ganhar dinheiro, porque os favoritos pagam pouco. Nos golos e em ambas marcam a chance está
        puxada para a {avg}, porque o modelo exagera nesses mercados.
      </p>
    </div>
  );
}

// `withHalfTime` is false for leagues whose data has no half-time score: the
// half-time chances would then rest on a default share of goals in the first
// half, not on the league, so they are left out.
function buildMarkets(
  prediction: Prediction,
  withHalfTime: boolean,
  home: string,
  away: string
): { groups: { title: string; rows: Row[] }[]; odd: OddMarket[] } {
  const ft = prediction.fullTime;
  const ht = prediction.halfTime;
  const overRows = [0.5, 1.5, 2, 2.5, 3, 3.5, 4.5].flatMap((line) => {
    const over =
      prediction.over[String(line)] ?? matchTotalOver(prediction.lambdaHome, prediction.lambdaAway, line);
    const push = Number.isInteger(line) ? matchTotalPush(prediction.lambdaHome, prediction.lambdaAway, line) : 0;
    return [
      { label: `Mais de ${dot(line)} golos`, p: over, key: `over:${line}`, push },
      { label: `Menos de ${dot(line)} golos`, p: 1 - over - push, key: `under:${line}`, push },
    ];
  });
  const groups: { title: string; rows: Row[] }[] = [
    {
      title: "Resultado final",
      rows: [
        { label: "Casa vence", p: ft.home, key: "home" },
        { label: "Empate", p: ft.draw, key: "draw" },
        { label: "Fora vence", p: ft.away, key: "away" },
        { label: "Casa ou empate (1X)", p: ft.home + ft.draw, key: "1x" },
        { label: "Fora ou empate (X2)", p: ft.away + ft.draw, key: "x2" },
        { label: "Sem empate (12)", p: ft.home + ft.away, key: "12" },
        {
          label: "Empate anula: casa",
          p: ft.home / (ft.home + ft.away || 1),
          key: "dnb:home",
          push: ft.draw,
        },
        {
          label: "Empate anula: fora",
          p: ft.away / (ft.home + ft.away || 1),
          key: "dnb:away",
          push: ft.draw,
        },
      ],
    },
    { title: "Golos", rows: overRows },
    {
      title: "Handicap asiático",
      rows: [-1.5, -0.5, 0.5, 1.5].flatMap((line) =>
        (["home", "away"] as const).map((side) => {
          const { win, push } = ahWinPush(prediction.lambdaHome, prediction.lambdaAway, side, line);
          const team = side === "home" ? home : away;
          const sign = line > 0 ? "+" : "";
          return {
            label: `Handicap ${team} ${sign}${dot(line)}`,
            p: win,
            key: `ah:${side}:${line}`,
            push,
          };
        })
      ),
    },
    {
      title: "Totais por equipa",
      rows: [0.5, 1.5, 2.5].flatMap((line) =>
        (["home", "away"] as const).flatMap((side) => {
          const mu = side === "home" ? prediction.lambdaHome : prediction.lambdaAway;
          const team = side === "home" ? home : away;
          const overW = teamTotalWinPush(mu, line, "over").win;
          const underW = teamTotalWinPush(mu, line, "under").win;
          return [
            { label: `${team} mais de ${dot(line)}`, p: overW, key: `to:${side}:${line}` },
            { label: `${team} menos de ${dot(line)}`, p: underW, key: `tu:${side}:${line}` },
          ];
        })
      ),
    },
    {
      title: "Ambas marcam",
      rows: [
        { label: "Sim", p: prediction.bothScore, key: "btts:yes" },
        { label: "Não", p: 1 - prediction.bothScore, key: "btts:no" },
      ],
    },
    ...(withHalfTime
      ? [
          {
            title: "Ao intervalo",
            rows: [
              { label: "Casa ganha ao intervalo", p: ht.home, key: "ht:home" },
              { label: "Empate ao intervalo", p: ht.draw, key: "ht:draw" },
              { label: "Fora ganha ao intervalo", p: ht.away, key: "ht:away" },
              { label: "Mais de 0,5 golos na 1.ª parte", p: ht.over05 },
              { label: "Mais de 1,5 golos na 1.ª parte", p: ht.over15 },
            ],
          },
        ]
      : []),
    {
      title: "Resultados exatos mais prováveis",
      rows: prediction.topScores.map((s) => ({ label: `${s.home}-${s.away}`, p: s.p })),
    },
  ];
  const odd: OddMarket[] = groups.flatMap((g) =>
    g.rows.map((r) => ({ group: g.title, label: r.label, p: r.p, key: r.key, push: r.push }))
  );
  return { groups, odd };
}

export default function MatchupReport({
  matches,
  history,
  historyFrom,
  currentSeason,
  international = false,
  predictFn,
  home,
  away,
  leagueLabel,
  latest,
  swapHref,
  now,
  fixtures,
  adjust,
  extras,
  notes,
  venueWeight,
  timing,
  realByKey,
  realOpenByKey,
  tables,
}: {
  matches: PlayedMatch[];
  // Older seasons, for the head to head only.
  history: PlayedMatch[];
  // The oldest season the head to head can look at, "2018/19".
  historyFrom: string | null;
  // The season the league is in, which starts in July or in January.
  currentSeason: SeasonInfo;
  // National teams: no league, neutral venues, and their own model.
  international?: boolean;
  // How the model sees the game for a shift of the balance by hand (see
  // adjustments.ts); for the leagues it is the goals model of the league.
  predictFn?: (ratio: number) => Prediction;
  home: string;
  away: string;
  leagueLabel: string;
  latest: string | null;
  swapHref: string;
  now: Date;
  fixtures: Fixture[];
  adjust: { home: TeamAdjust; away: TeamAdjust };
  // Games of other competitions typed in by hand, for each team.
  extras: { home: ExtraGame[]; away: ExtraGame[] };
  // What was worked out for the adjustments, to be shown with them.
  notes: string[];
  // How much the home/away form counts in the model, 0 to 1.
  venueWeight: number;
  // Goal timing per 15' of each side (last games with incident data), or null.
  timing?: { home: GoalTiming | null; away: GoalTiming | null } | null;
  // The bookmaker's real odds by model key, when this exact game is priced.
  realByKey?: Record<string, number>;
  // Opening odds by model key, for the line movement readout.
  realOpenByKey?: Record<string, number>;
  // Official standings tables (overall first) for the mini-table: official
  // points with our ratings, instead of counting our own fixtures.
  tables?: { name: string; rows: OfficialStanding[] }[];
}) {
  const adjusted = isAdjusted(adjust.home, adjust.away) || venueWeight > 0;
  const ratio = strengthRatio(adjust.home, adjust.away);
  const prediction = predictFn ? predictFn(ratio) : predict(matches, home, away, now, ratio, venueWeight);
  const unadjusted = adjusted ? (predictFn ? predictFn(1) : predict(matches, home, away, now)) : prediction;
  const avg = international ? "média das seleções" : "média da liga";
  const period = international ? currentSeason.label : `época ${currentSeason.label}`;
  // The league table with each team's strength, the two teams standing out (not for
  // national teams, which have no league). Official tables win when the source
  // has them (overall table first): official points with our ratings, instead
  // of counting our own fixtures.
  const official = !international && tables && tables.length > 0 ? tables[0] : null;
  const table = international ? [] : buildStandings(fixtures);
  const strengths = new Map(
    ratings(matches, official ? official.rows.map((r) => r.team) : table.map((row) => row.team), now).rows.map(
      (row) => [row.team, row]
    )
  );
  const standingsLines: StandingsLine[] = official
    ? official.rows.flatMap((o) => {
        const rating = strengths.get(o.team);
        if (!rating) return [];
        return [
          {
            standing: {
              team: o.team,
              played: o.played,
              wins: o.wins,
              draws: o.draws,
              losses: o.losses,
              gf: o.gf,
              ga: o.ga,
              gd: o.gf - o.ga,
              points: o.points,
              form: formOf(fixtures, o.team),
            },
            rating,
          },
        ];
      })
    : table.flatMap((standing) => {
        const rating = strengths.get(standing.team);
        return rating ? [{ standing, rating }] : [];
      });

  // Some leagues come without the half-time score.
  const hasHalfTime = matches.some((m) => m.ht !== null);
  const { groups, odd } = buildMarkets(prediction, hasHalfTime, home, away);

  // The teams' own records count only this season (from 1 July); the estimate
  // above still leans on the earlier seasons, which it needs.
  const seasonStart = currentSeason.from;
  const thisSeason = (team: string) => gamesOf(matches, team).filter((g) => g.date >= seasonStart);
  // The league's games and the ones typed in, most recent first.
  const withExtras = (games: TeamGame[], typed: ExtraGame[]) =>
    [...games, ...typed.filter((g) => g.date >= seasonStart).map(extraToTeamGame)].sort((a, b) =>
      b.date.localeCompare(a.date)
    );
  const homeGames = withExtras(thisSeason(home), extras.home);
  const awayGames = withExtras(thisSeason(away), extras.away);
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  // Past games of the season with no result in the data yet, most recent first.
  const pendingOf = (team: string) =>
    seasonOf(fixtures, team)
      .filter((f) => !f.ft && f.date < today)
      .reverse();

  // Head to head looks at every season in the data.
  const meetings = headToHead([...history, ...matches], home, away);
  const h2h = { home: 0, draw: 0, away: 0 };
  for (const m of meetings) {
    const homeGoals = m.team1 === home ? m.ft[0] : m.ft[1];
    const awayGoals = m.team1 === home ? m.ft[1] : m.ft[0];
    if (homeGoals > awayGoals) h2h.home++;
    else if (homeGoals === awayGoals) h2h.draw++;
    else h2h.away++;
  }

  // Strength curve: blended attack (same maths as the ratings) after each of
  // the last 10 games of each side, oldest to newest.
  const CURVE_GAMES = 10;
  const strengthCurve = (team: string): { date: string; attack: number }[] => {
    const pool = [...history, ...matches].sort((a, b) => a.date.localeCompare(b.date));
    const dates = [
      ...new Set(pool.filter((m) => m.team1 === team || m.team2 === team).map((m) => m.date)),
    ].slice(-CURVE_GAMES);
    return dates.map((d) => {
      const before = pool.filter((m) => m.date <= d);
      const at = new Date(`${d}T12:00:00`);
      const rates = leagueRates(before, at);
      const shots = shotRates(before, at);
      const blended = blendedStrength(
        strengthOf(before, team, rates, at),
        shotStrengthOf(before, team, shots, at)
      );
      return { date: d, attack: blended.attack };
    });
  };
  const homeCurve = strengthCurve(home);
  const awayCurve = strengthCurve(away);

  // Combined markets need half times too: last 10 games per side plus the
  // meetings from each side's point of view.
  const toCombo = (m: PlayedMatch, team: string): ComboGame => {
    const isHome = m.team1 === team;
    return {
      gf: isHome ? m.ft[0] : m.ft[1],
      ga: isHome ? m.ft[1] : m.ft[0],
      htGF: m.ht ? (isHome ? m.ht[0] : m.ht[1]) : null,
      htGA: m.ht ? (isHome ? m.ht[1] : m.ht[0]) : null,
    };
  };
  const comboOf = (team: string): ComboGame[] =>
    [...history, ...matches]
      .filter((m) => m.team1 === team || m.team2 === team)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10)
      .map((m) => toCombo(m, team));

  const minGames = Math.min(prediction.gamesHome, prediction.gamesAway);
  const few = minGames < MIN_GAMES;
  const fragile = !few && minGames < SOLID_GAMES;
  const base = baseRates(matches);
  const fhs = leagueRates(matches, now).firstHalfShare;
  const picks = few ? [] : recommend(prediction, base, home, away, fhs, matches);
  // Value hunt input: every priced market with a real odd, ranked client-side.
  const priced: ValueItem[] = candidatesFor(prediction, base, home, away, fhs, matches).flatMap((c) => {
    const real = realByKey?.[c.key];
    if (real === undefined) return [];
    const push = c.push ?? 0;
    const fair = c.p > 0 ? (push > 0 ? (1 - push) / c.p : fairOdd(c.p)) : Infinity;
    if (!Number.isFinite(fair)) return [];
    return [
      {
        key: c.key,
        label: c.label,
        p: c.p,
        minOdd: fair * (1 + VALUE_MARGIN[c.group]),
        real,
        why: pickWhy({ key: c.key } as Pick, { matches, home, away, prediction }),
      },
    ];
  });
  // The suggestions first, priced with their own (pulled back) chance, so the
  // comparer opens on the suggested bet.
  const oddMarkets: OddMarket[] = [
    ...picks.map((p) => ({ group: "Aposta sugerida", label: p.label, p: p.p, key: p.key })),
    ...odd,
  ];

  return (
    <div className="mt-6 space-y-4 tabular-nums" data-wide>
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
        {(few || fragile) && (
          <p className="mt-2 rounded-lg bg-amber-950 px-3 py-2 text-xs text-amber-300">
            {few
              ? `Há poucos jogos destas equipas nos dados (${prediction.gamesHome} e ${prediction.gamesAway}), por isso a estimativa é frágil e não sugiro aposta.`
              : `Uma das equipas só tem ${minGames} jogos nos dados (${prediction.gamesHome} e ${prediction.gamesAway}). Abaixo de ${SOLID_GAMES}, o modelo ainda não ganha à ${avg}, por isso a estimativa é frágil.`}
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
          notes={notes}
          venueWeight={venueWeight}
        />
      )}

      <SuggestedBet picks={picks} few={few} fragileGames={fragile ? minGames : null} avg={avg} realByKey={realByKey} realOpenByKey={realOpenByKey} whyCtx={{ matches, home, away, prediction }} />

      {priced.length > 0 && <ValueHunt items={priced} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          {groups.map((g) => (
            <MarketTable key={g.title} title={g.title} rows={g.rows} />
          ))}
        </div>

        <div className="space-y-4">
          <TeamCard name={home} role="Casa" games={homeGames} venue="home" season={period} pending={pendingOf(home)} international={international} />
          <TeamCard name={away} role="Fora" games={awayGames} venue="away" season={period} pending={pendingOf(away)} international={international} />

          <div className={CARD}>
            <h3 className="mb-2 text-sm font-semibold text-neutral-300">Confrontos diretos</h3>
            {meetings.length === 0 ? (
              <p className="text-xs text-neutral-500">
                {international
                  ? `Sem jogos entre as duas seleções nos dados${historyFrom ? `, desde ${historyFrom}` : ""}.`
                  : `Sem jogos entre as duas equipas nesta liga${historyFrom ? `, desde a época ${historyFrom}` : ""}. Só contam os jogos deste campeonato: taças e jogos noutras divisões não estão nos dados.`}
              </p>
            ) : (
              <>
                <p className="mb-2 text-xs text-neutral-400">
                  {home}: {h2h.home} vitórias · {h2h.draw} empates · {away}: {h2h.away} vitórias
                  <span className="block text-[11px] text-neutral-500">
                    {meetings.length} {meetings.length === 1 ? "jogo" : "jogos"}{" "}
                    {international ? "entre seleções" : "nesta liga"}
                    {historyFrom ? `, desde ${international ? "" : "a época "}${historyFrom}` : ""}
                  </span>
                </p>
                <div className="space-y-1 text-xs">
                  {meetings.slice(0, 8).map((m) => (
                    <div key={`${m.date}-${m.team1}`} className="flex items-center justify-between gap-2 text-neutral-300">
                      <span className="text-neutral-500">
                        {shortDate(m.date)}
                        {m.competition && (
                          <span title={m.competition} className="block max-w-[6.5rem] truncate text-[9px] leading-tight text-amber-500/80">
                            {m.competition}
                            {m.neutral ? " · neutro" : ""}
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-right">
                        {m.team1} <span className="font-semibold text-neutral-100">{m.ft[0]}–{m.ft[1]}</span> {m.team2}
                      </span>
                    </div>
                  ))}
                  {meetings.length > 8 && (
                    <p className="pt-1 text-[11px] text-neutral-500">e mais {meetings.length - 8} anteriores</p>
                  )}
                </div>
              </>
            )}
          </div>

        </div>
      </div>

      <FormCurve home={home} away={away} homeCurve={homeCurve} awayCurve={awayCurve} />

      {timing && (timing.home || timing.away) && (
        <GoalTimingCard home={home} away={away} timing={timing} />
      )}

      <VenueGoalsCard
        home={home}
        away={away}
        homeGames={gamesOf(matches, home)}
        awayGames={gamesOf(matches, away)}
      />

      <ComboCard
        home={home}
        away={away}
        homeGames={comboOf(home)}
        awayGames={comboOf(away)}
        meetings={{ home: meetings.map((m) => toCombo(m, home)), away: meetings.map((m) => toCombo(m, away)) }}
      />

      {standingsLines.length > 0 && (
        <div>
          <h2 className="mb-1 text-sm font-semibold text-neutral-300">Classificação e força · {period}</h2>
          <p className="mb-3 text-xs text-neutral-500">
            A tabela soma os jogos desta época que a fonte já tem (até {latest ? shortDate(latest) : "?"}), por isso pode
            faltar um jogo; em ligas com fases finais ou grupos não é a oficial. <span className="text-neutral-400">Ataque</span> e{" "}
            <span className="text-neutral-400">defesa</span> comparam cada equipa com a média da liga (1,00): atacar acima
            de 1 e defender abaixo de 1 é bom. A <span className="text-neutral-400">força</span> é a diferença de golos
            esperada por jogo contra uma equipa média.
          </p>
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {([["home", home], ["away", away]] as const).map(([side, team]) => {
              const at = standingsLines.findIndex((l) => l.standing.team === team);
              const line = at >= 0 ? standingsLines[at] : null;
              return (
                <div
                  key={side}
                  className={`rounded-xl border p-3 ${
                    side === "home" ? "border-emerald-800/60 bg-emerald-950/20" : "border-sky-800/60 bg-sky-950/20"
                  }`}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    {side === "home" ? "Casa" : "Fora"}
                  </p>
                  <p className="text-sm font-semibold text-neutral-100">{team}</p>
                  {line ? (
                    <p className="mt-1 text-xs text-neutral-300">
                      {at + 1}.º lugar · {line.standing.points} pontos em {line.standing.played} jogos · ataque{" "}
                      <span className="font-medium text-neutral-100">{line.rating.attack.toFixed(2).replace(".", ",")}</span> · defesa{" "}
                      <span className="font-medium text-neutral-100">{line.rating.defense.toFixed(2).replace(".", ",")}</span> · força{" "}
                      <span className="font-medium text-neutral-100">
                        {line.rating.goalDiff > 0 ? "+" : ""}
                        {line.rating.goalDiff.toFixed(2).replace(".", ",")}
                      </span>
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-neutral-500">Ainda sem jogos nesta época na tabela.</p>
                  )}
                </div>
              );
            })}
          </div>
          <StandingsTable lines={standingsLines} highlight={{ home, away }} />
        </div>
      )}

      <H2HPatternCard
        pattern={h2hPattern(meetings, home, away)}
        home={home}
        away={away}
        from={historyFrom}
        homeChance={prediction.fullTime.home}
        international={international}
      />

      <div>
        <h2 className="mb-1 text-sm font-semibold text-neutral-300">Jogos · {period}</h2>
        <p className="mb-3 text-xs text-neutral-500">
          {international
            ? "São os jogos de seleções dos últimos 12 meses (amigáveis, qualificações e competições), com a competição a amarelo por baixo da data."
            : "Os jogos da liga vêm dos dados. Taças e provas europeias não estão nos dados gratuitos: só aparecem os que acrescentaste nos Ajustes (com a competição a amarelo)."}
        </p>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <TeamSeason team={home} fixtures={fixtures} extras={extras.home.filter((g) => g.date >= seasonStart)} today={today} international={international} />
          <TeamSeason team={away} fixtures={fixtures} extras={extras.away.filter((g) => g.date >= seasonStart)} today={today} international={international} />
        </div>
      </div>

      <OddChecker markets={oddMarkets} realByKey={realByKey} realOpenByKey={realOpenByKey} />

      <p className="text-xs leading-relaxed text-neutral-500">
        {international
          ? "Estimativa estatística a partir dos resultados dos últimos anos (modelo de Poisson que ajusta o ataque e a defesa de todas as seleções ao mesmo tempo, descontando a força de quem enfrentaram). Não sabe de convocatórias, lesões, castigos, onze inicial nem motivação, e nas seleções o plantel muda muito de jogo para jogo. Testado nos jogos entre julho de 2025 e agosto de 2026 (cerca de 1.040 jogos, cada um previsto só com os anteriores), acertou em quem ganha em 61% dos jogos, contra 48% se se apostasse sempre no resultado mais comum. Usa-o como referência, não como garantia."
          : "Estimativa estatística a partir dos golos das últimas épocas (modelo de Poisson). Não sabe de lesões, castigos, onze inicial nem motivação. Testado nos jogos de 2025/26 das 7 maiores ligas, previu bem quem ganha (acertou em cerca de 55% dos jogos, contra 46% se se apostasse sempre na média da liga), mas em mais/menos golos e ambas marcam ficou perto da média da liga, por isso nesses mercados vale pouco mais do que a média. Usa-o como referência, não como garantia."}
      </p>
    </div>
  );
}
