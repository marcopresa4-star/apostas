// Looks up the real score of a bet's game in the data we already have, and, for
// the plainest kinds of selection ("Vitória do Benfica", "Mais de 2,5 golos",
// "Ambas marcam: sim"...), works out whether it was a green or a red, or which
// market it was (for comparing it with what the model would have said). Anything
// worded another way is left alone: a missed match only means no suggestion, a
// wrong guess would be worse.

import type { PlayedMatch } from "./footballModel";
import { tokens } from "./teamNames";

// Whether `name` is one of the ways this club is written (its tokens are a
// subset of the candidate's, or the other way round: "Sporting" fits "Sporting
// Clube de Portugal").
function fits(name: string, candidates: string[]): boolean {
  const a = tokens(name);
  if (a.length === 0) return false;
  return candidates.some((c) => {
    const b = tokens(c);
    if (b.length === 0) return false;
    const [small, big] = a.length <= b.length ? [a, b] : [b, a];
    return small.every((t) => big.includes(t));
  });
}

export interface GameRef {
  date: string;
  homeNames: string[]; // the team's name plus its known aliases
  awayNames: string[];
}

export interface FoundMatch {
  match: PlayedMatch;
  // Whether this bet's home side is the game's team1 (false: they are swapped,
  // e.g. the fixture's real home side is not who the bet calls "home").
  homeIsTeam1: boolean;
}

// The game among `matches` that fits this date and these two teams (in either
// order), or null.
export function findMatch(game: GameRef, matches: PlayedMatch[]): FoundMatch | null {
  for (const m of matches) {
    if (m.date !== game.date) continue;
    if (fits(m.team1, game.homeNames) && fits(m.team2, game.awayNames)) return { match: m, homeIsTeam1: true };
    if (fits(m.team2, game.homeNames) && fits(m.team1, game.awayNames)) return { match: m, homeIsTeam1: false };
  }
  return null;
}

// The final score of this game, oriented to `homeNames`/`awayNames` (so the
// first number is always this bet's home side), or null if no game of that
// date fits both teams.
export function findFinalScore(game: GameRef, matches: PlayedMatch[]): [number, number] | null {
  const found = findMatch(game, matches);
  if (!found) return null;
  return found.homeIsTeam1 ? found.match.ft : [found.match.ft[1], found.match.ft[0]];
}

export type Outcome = "green" | "red";

const norm = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// Whether `text` names this side of the game (its own name/aliases) together
// with one of `words` ("vence", "vitória"...), so "Vitória do Benfica" matches
// the home side but plain "Benfica" alone does not (too easy to mean something
// else entirely).
function sideWord(text: string, names: string[], words: string[]): boolean {
  return fits(text, names) && words.some((w) => text.includes(w));
}

// "2,5" / "2.50" -> "2.5": the same spelling `over:${line}` uses elsewhere, so
// the key can be looked up among the model's own candidates.
const normLine = (s: string): string => String(Number(s.replace(",", ".")));

export interface Market {
  // "home" | "away" | "draw" | "1x" | "x2" | "12" | "over:2.5" | "under:2.5" |
  // "btts:yes" | "btts:no" - the same shape recommendation.ts's candidates use.
  key: string;
}

// Reads the plainest kinds of selection ("Vitória de X", "X ou empate", "Mais de
// 2,5 golos", "Ambas marcam: sim"...) and says which market it is. null when the
// wording is not one of these, on purpose: a bet worded another way is never
// guessed at.
export function parseMarket(selectionRaw: string, homeNames: string[], awayNames: string[]): Market | null {
  const text = norm(selectionRaw);
  const WIN_WORDS = ["vence", "vitoria", "ganha", "ganhou"];

  const homeWin = sideWord(text, homeNames, WIN_WORDS);
  const awayWin = sideWord(text, awayNames, WIN_WORDS);
  if (homeWin && !awayWin) return { key: "home" };
  if (awayWin && !homeWin) return { key: "away" };

  const drawWord = text.includes("empate");
  const homeMentioned = fits(text, homeNames);
  const awayMentioned = fits(text, awayNames);
  if (drawWord && homeMentioned && !awayMentioned) return { key: "1x" }; // "<home> ou empate"
  if (drawWord && awayMentioned && !homeMentioned) return { key: "x2" }; // "<away> ou empate"
  if (drawWord && !homeMentioned && !awayMentioned) {
    if (text.includes("sem empate") || /(^|\D)12(\D|$)/.test(text)) return { key: "12" };
    return { key: "draw" }; // "empate" alone
  }

  const overLine = /mais de\s*([\d.,]+)\s*golos?/.exec(text);
  if (overLine) return { key: `over:${normLine(overLine[1])}` };
  const underLine = /menos de\s*([\d.,]+)\s*golos?/.exec(text);
  if (underLine) return { key: `under:${normLine(underLine[1])}` };

  if (text.includes("ambas marcam") || text.includes("btts")) {
    const no = /(n[aã]o|:\s*n)/.test(text.replace("ambas marcam", ""));
    return { key: no ? "btts:no" : "btts:yes" };
  }

  return null;
}

// Whether `key` won, given the final score (already oriented home-first).
export function outcomeFor(key: string, score: [number, number]): Outcome {
  const [hg, ag] = score;
  const win = (ok: boolean) => (ok ? "green" : "red");
  switch (key) {
    case "home":
      return win(hg > ag);
    case "away":
      return win(ag > hg);
    case "draw":
      return win(hg === ag);
    case "1x":
      return win(hg >= ag);
    case "x2":
      return win(ag >= hg);
    case "12":
      return win(hg !== ag);
    case "btts:yes":
      return win(hg > 0 && ag > 0);
    case "btts:no":
      return win(!(hg > 0 && ag > 0));
  }
  const over = /^over:([\d.]+)$/.exec(key);
  if (over) return win(hg + ag > Number(over[1]));
  const under = /^under:([\d.]+)$/.exec(key);
  if (under) return win(hg + ag < Number(under[1]));
  return win(false);
}

// Reads the plainest kinds of selection and says whether it won, given the
// final score (already oriented home-first). null when the wording is not one
// of these, on purpose: a bet worded another way is never guessed at.
export function parseOutcome(
  selectionRaw: string,
  homeNames: string[],
  awayNames: string[],
  score: [number, number]
): Outcome | null {
  const market = parseMarket(selectionRaw, homeNames, awayNames);
  return market ? outcomeFor(market.key, score) : null;
}
