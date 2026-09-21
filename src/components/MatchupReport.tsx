import Link from "next/link";
import OddChecker, { type OddMarket } from "./OddChecker";
import { formatOdd } from "@/lib/multiples";
import { VALUE_MARGIN, baseRates, recommend, type Pick } from "@/lib/recommendation";
import { seasonLabel, seasonStartDate, seasonsFor } from "@/lib/footballData";
import {
  OVER_LINES,
  fairOdd,
  gamesOf,
  headToHead,
  predict,
  summarize,
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
          <span
            key={`${g.date}-${g.opponent}`}
            title={`${shortDate(g.date)} · ${g.home ? "casa" : "fora"} vs ${g.opponent}: ${g.gf}-${g.ga}`}
            className={`flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs font-bold ${CHIP[g.result]}`}
          >
            {g.result}
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
}: {
  matches: PlayedMatch[];
  home: string;
  away: string;
  leagueLabel: string;
  latest: string | null;
  swapHref: string;
  now: Date;
}) {
  const prediction = predict(matches, home, away, now);
  const { groups, odd } = buildMarkets(prediction);

  // The teams' own records count only this season (from 1 July); the estimate
  // above still leans on the earlier seasons, which it needs.
  const seasonStart = seasonStartDate(now);
  const thisSeason = (team: string) => gamesOf(matches, team).filter((g) => g.date >= seasonStart);
  const homeGames = thisSeason(home);
  const awayGames = thisSeason(away);
  const season = seasonLabel(seasonsFor(now, 1)[0]);

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
