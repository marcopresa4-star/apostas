import { sideKind, sideTokensIn, slugCandidates } from "./sportscoreSlug";
import { slugify } from "./slugify";
import { tokens } from "./teamNames";

// Finds, among the teams of the leagues, the game a Sportscore link is about:
// the link only has the two team slugs ("galatasaray-vs-fenerbahce"), and the
// names in the data are written differently ("Man United", "Sporting Clube de
// Braga"), so a name fits a slug when the slug is one of the ways that name is
// known to be written there, or when one is contained in the other once the
// FC/CF... decoration is dropped (the scores are in `fit`). A team that fits more
// than one name equally is not guessed.

export interface LeagueTeams {
  code: string;
  label: string;
  teams: string[];
}

export interface FoundGame {
  code: string;
  label: string;
  home: string;
  away: string;
}

// Words written differently by Sportscore and by the data.
const SWAPS: Record<string, string> = { munich: "munchen", man: "manchester", utd: "united", st: "saint" };

// Slugs whose club is not found by their words ("inter" is "Internazionale").
const SLUG_TOKENS: Record<string, string[]> = {
  inter: ["internazionale"],
  "inter-milan": ["internazionale"],
  "sporting-cp": ["sporting", "portugal"],
  psg: ["paris", "germain"],
  wolves: ["wolverhampton"],
  spurs: ["tottenham"],
  "olympique-lyon": ["olympique", "lyonnais"],
};

const words = (list: string[]) => list.map((t) => SWAPS[t] ?? t);

// 4: the same words; 3: the slug is one of the known ways of writing the name;
// 2: one contains the other; 0: no fit.
function fit(slug: string, name: string): number {
  // A women's, reserve or youth side is not the club's first team: the slug must
  // not be taken for the men's team whose name it merely contains.
  const own = slugify(name).split("-");
  if (sideTokensIn(slug).some((t) => !own.includes(t))) return 0;
  const a = SLUG_TOKENS[slug] ?? words(tokens(slug.replace(/-/g, " ")));
  const b = words(tokens(name));
  if (a.length > 0 && b.length > 0 && a.length === b.length && a.every((t) => b.includes(t))) return 4;
  if (slugCandidates([name]).includes(slug)) return 3;
  if (a.length === 0 || b.length === 0) return 0;
  const inside = (small: string[], big: string[]) => small.every((t) => big.includes(t));
  return inside(a, b) || inside(b, a) ? 2 : 0;
}

function best(slug: string, teams: string[]): { name: string; score: number } | null {
  let top = 0;
  let winners: string[] = [];
  for (const team of teams) {
    const score = fit(slug, team);
    if (score > top) {
      top = score;
      winners = [team];
    } else if (score === top && score > 0) winners.push(team);
  }
  return winners.length === 1 ? { name: winners[0], score: top } : null;
}

// Both teams have to be in the same league; the league where they fit best wins.
export function findGame(slugs: [string, string], leagues: LeagueTeams[]): FoundGame | null {
  let pick: { game: FoundGame; score: number } | null = null;
  for (const league of leagues) {
    const home = best(slugs[0], league.teams);
    const away = best(slugs[1], league.teams);
    if (!home || !away || home.name === away.name) continue;
    const score = home.score + away.score;
    if (!pick || score > pick.score) {
      pick = { game: { code: league.code, label: league.label, home: home.name, away: away.name }, score };
    }
  }
  return pick?.game ?? null;
}

// The same for a game whose clubs are known by name (the games added to the
// Dashboard), each with the other names it goes by: the first pair that fits.
export function findGameByNames(home: string[], away: string[], leagues: LeagueTeams[]): FoundGame | null {
  for (const h of home) {
    for (const a of away) {
      const slugs: [string, string] = [slugify(h), slugify(a)];
      if (!slugs[0] || !slugs[1]) continue;
      const found = findGame(slugs, leagues);
      if (found) return found;
    }
  }
  return null;
}

// What kind of game the link is about when it is not a club's first team
// ("feminino", "equipa B"...), or null.
export function sideOfGame(slugs: [string, string]): string | null {
  const token = [...sideTokensIn(slugs[0]), ...sideTokensIn(slugs[1])][0];
  return token ? sideKind(token) : null;
}

// "atletico-madrid" -> "Atletico Madrid", for a game the data does not have.
export function prettySlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}
