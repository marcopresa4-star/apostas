import {
  gamesOf,
  leagueRates,
  strengthOf,
  summarize,
  type PlayedMatch,
  type Prediction,
  type TeamGame,
} from "./footballModel";
import type { PickGroup } from "./recommendation";

// A written reason for a bet, made only of figures worked out from the data:
// nothing here is said that the numbers do not show.

const one = (n: number) => n.toFixed(1).replace(".", ",");
const two = (n: number) => n.toFixed(2).replace(".", ",");
const pct = (p: number) => `${Math.round(p * 100)}%`;
const pct1 = (p: number) => `${(p * 100).toFixed(1).replace(".", ",")}%`;
const last = (games: TeamGame[], n: number) => games.slice(0, n);
const share = (games: TeamGame[], test: (g: TeamGame) => boolean) =>
  games.length === 0 ? null : games.filter(test).length / games.length;
const chips = (games: TeamGame[]) => games.map((g) => g.result).join(" ");

export interface ReasonInput {
  matches: PlayedMatch[];
  now: Date;
  home: string;
  away: string;
  prediction: Prediction;
  group: PickGroup;
  key: string;
  label: string;
  p: number; // the chance shown for the bet
  base: number; // how often it happens in the league
}

export function betReasons(input: ReasonInput): string[] {
  const { matches, now, home, away, prediction: pr, key, p, base } = input;
  const reasons: string[] = [];

  const rates = leagueRates(matches, now);
  const h = strengthOf(matches, home, rates, now);
  const a = strengthOf(matches, away, rates, now);
  const homeGames = gamesOf(matches, home);
  const awayGames = gamesOf(matches, away);
  const homeLast = last(homeGames, 10);
  const awayLast = last(awayGames, 10);
  const expectedTotal = pr.lambdaHome + pr.lambdaAway;

  // 1. What the model expects of the game.
  reasons.push(
    `O modelo espera ${one(pr.lambdaHome)} golos de ${home} e ${one(pr.lambdaAway)} de ${away} (${one(expectedTotal)} no total; a média da liga é ${one(rates.home + rates.away)}).`
  );

  // 2. The figures behind that kind of bet.
  if (key === "home" || key === "away" || key === "1x" || key === "x2") {
    const ft = pr.fullTime;
    reasons.push(
      `Chance de ${home} ganhar ${pct(ft.home)}, de empate ${pct(ft.draw)} e de ${away} ganhar ${pct(ft.away)}.`
    );
    reasons.push(
      `Ataque e defesa (1,00 é a média da liga, e em defesa menos é melhor): ${home} ${two(h.attack)} e ${two(h.defense)}; ${away} ${two(a.attack)} e ${two(a.defense)}.`
    );
    const homeAtHome = last(homeGames.filter((g) => g.home), 5);
    const awayAway = last(awayGames.filter((g) => !g.home), 5);
    if (homeAtHome.length > 0 && awayAway.length > 0) {
      reasons.push(
        `Últimos jogos: ${home} em casa ${chips(homeAtHome)}; ${away} fora ${chips(awayAway)} (o mais recente primeiro).`
      );
    }
  } else if (key.startsWith("btts")) {
    const yes = key === "btts:yes";
    const homeBoth = share(homeLast, (g) => g.gf > 0 && g.ga > 0);
    const awayBoth = share(awayLast, (g) => g.gf > 0 && g.ga > 0);
    if (homeBoth !== null && awayBoth !== null) {
      reasons.push(
        `Ambas marcaram em ${pct(homeBoth)} dos últimos ${homeLast.length} jogos de ${home} e em ${pct(awayBoth)} dos últimos ${awayLast.length} de ${away}.`
      );
    }
    const homeSummary = summarize(homeLast);
    const awaySummary = summarize(awayLast);
    if (homeSummary && awaySummary) {
      reasons.push(
        yes
          ? `${home} marca ${one(homeSummary.gfPerGame)} e sofre ${one(homeSummary.gaPerGame)} por jogo; ${away} marca ${one(awaySummary.gfPerGame)} e sofre ${one(awaySummary.gaPerGame)}.`
          : `${home} não sofreu golos em ${pct(homeSummary.cleanSheetPct / 100)} dos últimos jogos e ${away} em ${pct(awaySummary.cleanSheetPct / 100)}.`
      );
    }
  } else if (key.startsWith("over:") || key.startsWith("under:")) {
    const over = key.startsWith("over:");
    const line = Number(key.split(":")[1]);
    const homeOver = share(homeLast, (g) => g.gf + g.ga > line);
    const awayOver = share(awayLast, (g) => g.gf + g.ga > line);
    if (homeOver !== null && awayOver !== null) {
      reasons.push(
        over
          ? `Passaram de ${one(line)} golos em ${pct(homeOver)} dos últimos ${homeLast.length} jogos de ${home} e em ${pct(awayOver)} dos de ${away}.`
          : `Ficaram abaixo de ${one(line)} golos em ${pct(1 - homeOver)} dos últimos ${homeLast.length} jogos de ${home} e em ${pct(1 - awayOver)} dos de ${away}.`
      );
    }
    reasons.push(
      `Com ${one(expectedTotal)} golos esperados no jogo, a previsão inclina-se para ${over ? "mais" : "menos"} de ${one(line)}.`
    );
  }

  // 3. Where the number stands against the league, and why the bet is on the list.
  // Whole percentages can look equal when they are not: then show a decimal.
  const tie = pct(p) === pct(base);
  const shownP = tie ? pct1(p) : pct(p);
  const shownBase = tie ? pct1(base) : pct(base);
  if (p < base) {
    reasons.push(
      `Atenção: o modelo dá ${shownP}, abaixo dos ${shownBase} que esta aposta costuma ter nesta liga. Está na lista só porque a odd mínima corta as apostas mais prováveis.`
    );
  } else {
    reasons.push(`Compara com ${shownBase} de vezes que esta aposta acontece na liga, e o modelo dá-lhe ${shownP}.`);
  }
  if (key.startsWith("btts") || key.startsWith("over") || key.startsWith("under")) {
    reasons.push("Em golos e em ambas marcam o modelo é pouco melhor do que a média da liga: dá menos garantias do que em quem ganha.");
  }
  return reasons;
}
