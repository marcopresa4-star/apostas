import { seasonOf, type Fixture, type TeamGame } from "./footballModel";

// Games of a team that the free data does not have (cups, European
// competitions, friendlies), typed in by hand. They travel in the address of the
// Estatísticas page, one parameter per game, so they are read defensively: the
// address can be edited or cut by anyone.
export interface ExtraGame {
  date: string; // YYYY-MM-DD
  competition: string;
  opponent: string;
  home: boolean; // the team played at home
  gf: number; // goals of the team
  ga: number; // goals of the opponent
}

export const MAX_EXTRAS = 10;
const MAX_TEXT = 40;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

// The separator cannot appear in the text: it would split one game in two.
export const cleanText = (text: string | undefined): string => (text ?? "").replace(/[|\r\n]/g, " ").trim().slice(0, MAX_TEXT);

export function encodeExtra(game: ExtraGame): string {
  return [
    game.date,
    cleanText(game.competition),
    cleanText(game.opponent),
    game.home ? "1" : "0",
    game.gf,
    game.ga,
  ].join("|");
}

function goals(value: string | undefined): number | null {
  return value !== undefined && /^\d{1,2}$/.test(value) ? Number(value) : null;
}

// null for anything that is not a complete, sensible game.
export function decodeExtra(text: string): ExtraGame | null {
  const parts = text.split("|");
  if (parts.length !== 6) return null;
  const [date, competition, opponent, home, gf, ga] = parts;
  if (!DATE.test(date) || Number.isNaN(new Date(`${date}T12:00:00`).getTime())) return null;
  // "2026-02-31" parses in some engines by rolling over: keep only real dates.
  if (new Date(`${date}T12:00:00`).toISOString().slice(0, 10) !== date) return null;
  if (home !== "0" && home !== "1") return null;
  const ownGoals = goals(gf);
  const otherGoals = goals(ga);
  const name = cleanText(opponent);
  if (ownGoals === null || otherGoals === null || !name) return null;
  return { date, competition: cleanText(competition), opponent: name, home: home === "1", gf: ownGoals, ga: otherGoals };
}

export function parseExtras(values: string | string[] | undefined): ExtraGame[] {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  return list
    .map(decodeExtra)
    .filter((game): game is ExtraGame => game !== null)
    .slice(0, MAX_EXTRAS);
}

// As a row of the season table.
export function extraToFixture(game: ExtraGame, team: string): Fixture {
  return {
    date: game.date,
    team1: game.home ? team : game.opponent,
    team2: game.home ? game.opponent : team,
    ft: game.home ? [game.gf, game.ga] : [game.ga, game.gf],
    competition: game.competition || undefined,
  };
}

// As one of the games behind the form chips and the season numbers.
export function extraToTeamGame(game: ExtraGame): TeamGame {
  return {
    date: game.date,
    opponent: game.opponent,
    home: game.home,
    gf: game.gf,
    ga: game.ga,
    result: game.gf > game.ga ? "V" : game.gf === game.ga ? "E" : "D",
    competition: game.competition || undefined,
  };
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / DAY_MS
  );
}

export interface LastGame {
  date: string;
  competition: string; // "" for the league
  days: number; // days until the game being analysed
}

// The team's last game before `matchDate`, whatever the competition: league
// dates from the calendar and the games typed in by hand.
export function lastGameBefore(
  matchDate: string,
  leagueDates: string[],
  extras: ExtraGame[]
): LastGame | null {
  const candidates = [
    ...leagueDates.map((date) => ({ date, competition: "" })),
    ...extras.map((g) => ({ date: g.date, competition: g.competition })),
  ].filter((c) => c.date < matchDate);
  if (candidates.length === 0) return null;
  const last = candidates.reduce((a, b) => (b.date > a.date ? b : a));
  return { ...last, days: daysBetween(last.date, matchDate) };
}

// The team's last game before `matchDate` from the league calendar plus the
// games typed in, and the days of rest that leaves.
export function restFor(
  matchDate: string,
  fixtures: Fixture[],
  team: string,
  extras: ExtraGame[]
): LastGame | null {
  return lastGameBefore(
    matchDate,
    seasonOf(fixtures, team).map((f) => f.date),
    extras
  );
}
