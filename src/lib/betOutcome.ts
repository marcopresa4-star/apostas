// Looks up the real score of a bet's game in the data we already have, and, for
// the plainest kinds of selection ("Vitória do Benfica", "Mais de 2,5 golos",
// "Ambas marcam: sim"...), works out whether it was a green or a red. Anything
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

// The final score of this game among `matches`, oriented to `homeNames`/
// `awayNames` (so the first number is always this bet's home side), or null if
// no game of that date fits both teams.
export function findFinalScore(game: GameRef, matches: PlayedMatch[]): [number, number] | null {
  for (const m of matches) {
    if (m.date !== game.date) continue;
    if (fits(m.team1, game.homeNames) && fits(m.team2, game.awayNames)) return m.ft;
    if (fits(m.team2, game.homeNames) && fits(m.team1, game.awayNames)) return [m.ft[1], m.ft[0]];
  }
  return null;
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

// Reads the plainest kinds of selection ("Vitória de X", "X ou empate", "Mais de
// 2,5 golos", "Ambas marcam: sim"...) and says whether it won, given the final
// score (already oriented home-first). null when the wording is not one of
// these, on purpose: a bet worded another way is never guessed at.
export function parseOutcome(
  selectionRaw: string,
  homeNames: string[],
  awayNames: string[],
  score: [number, number]
): Outcome | null {
  const text = norm(selectionRaw);
  const [hg, ag] = score;
  const win = (ok: boolean) => (ok ? "green" : "red");
  const WIN_WORDS = ["vence", "vitoria", "ganha", "ganhou"];

  const homeWin = sideWord(text, homeNames, WIN_WORDS);
  const awayWin = sideWord(text, awayNames, WIN_WORDS);
  if (homeWin && !awayWin) return win(hg > ag);
  if (awayWin && !homeWin) return win(ag > hg);

  const drawWord = text.includes("empate");
  const homeMentioned = fits(text, homeNames);
  const awayMentioned = fits(text, awayNames);
  if (drawWord && homeMentioned && !awayMentioned) return win(hg >= ag); // "<home> ou empate", 1X
  if (drawWord && awayMentioned && !homeMentioned) return win(ag >= hg); // "<away> ou empate", X2
  if (drawWord && !homeMentioned && !awayMentioned) {
    if (text.includes("sem empate") || /(^|\D)12(\D|$)/.test(text)) return win(hg !== ag);
    return win(hg === ag); // "empate" alone
  }

  const overLine = /mais de\s*([\d.,]+)\s*golos?/.exec(text);
  if (overLine) return win(hg + ag > Number(overLine[1].replace(",", ".")));
  const underLine = /menos de\s*([\d.,]+)\s*golos?/.exec(text);
  if (underLine) return win(hg + ag < Number(underLine[1].replace(",", ".")));

  if (text.includes("ambas marcam") || text.includes("btts")) {
    const bothScored = hg > 0 && ag > 0;
    const no = /(n[aã]o|:\s*n)/.test(text.replace("ambas marcam", ""));
    return win(no ? !bothScored : bothScored);
  }

  return null;
}
