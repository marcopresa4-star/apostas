// A small goals model for "what if these two teams played each other".
// Everything here is plain maths on past results, so it can be tested on its
// own: the data comes from footballData.ts.
//
// The idea is the classic Poisson one: each team scores a number of goals that
// follows a Poisson law, whose average depends on how well that team attacks,
// how well the other one defends, and on playing at home. The two averages give
// the chance of every possible score, and every market (win/draw/loss, over
// 2.5, both teams score...) is a sum over those scores.

export interface PlayedMatch {
  date: string; // YYYY-MM-DD
  team1: string; // home
  team2: string; // away
  ft: [number, number];
  ht: [number, number] | null;
  // Shots on target [home, away], when the source has them (SofaScore does).
  // Feeds the shot-based half of team strength; missing counts as no data.
  sot?: [number, number] | null;
  // Only where the data mixes competitions (national teams).
  competition?: string;
  // Played at a neutral venue: nobody was really at home (national teams).
  neutral?: boolean;
}

// A result counts half as much every this many days, so this season weighs more
// than last one. Both numbers below come from testing the model on the games of
// 2025/26 (each predicted from earlier games only): a long memory and some
// caution predicted results best, and shorter memories did worse.
const HALF_LIFE_DAYS = 365;
// A team's numbers are pulled towards the league average as if it had already
// played this many average games, so a few matches cannot make it look
// unbeatable or hopeless.
const PRIOR_GAMES = 8;
// Dixon-Coles: plain Poisson gives too few 0-0 and 1-1 and too many 1-0 / 0-1.
const RHO = -0.08;
const MAX_GOALS = 10;

const DAY_MS = 86_400_000;

function weightOf(date: string, now: Date): number {
  const age = (now.getTime() - new Date(`${date}T12:00:00`).getTime()) / DAY_MS;
  return 0.5 ** (Math.max(0, age) / HALF_LIFE_DAYS);
}

export interface LeagueRates {
  home: number; // average goals by the home side
  away: number; // average goals by the away side
  perTeam: number; // average goals per team per game
  // Share of a game's goals that come before half time.
  firstHalfShare: number;
}

export function leagueRates(matches: PlayedMatch[], now: Date): LeagueRates {
  let w = 0;
  let home = 0;
  let away = 0;
  let htGoals = 0;
  let ftGoalsWithHt = 0;
  for (const m of matches) {
    const weight = weightOf(m.date, now);
    w += weight;
    home += weight * m.ft[0];
    away += weight * m.ft[1];
    if (m.ht) {
      htGoals += weight * (m.ht[0] + m.ht[1]);
      ftGoalsWithHt += weight * (m.ft[0] + m.ft[1]);
    }
  }
  if (w === 0) return { home: 1.4, away: 1.1, perTeam: 1.25, firstHalfShare: 0.44 };
  return {
    home: home / w,
    away: away / w,
    perTeam: (home + away) / (2 * w),
    firstHalfShare: ftGoalsWithHt > 0 ? htGoals / ftGoalsWithHt : 0.44,
  };
}

export interface Strength {
  attack: number; // 1 = league average
  defense: number; // 1 = league average, above 1 concedes more
  games: number;
}

export function strengthOf(
  matches: PlayedMatch[],
  team: string,
  rates: LeagueRates,
  now: Date
): Strength {
  let w = 0;
  let scored = 0;
  let conceded = 0;
  let games = 0;
  for (const m of matches) {
    const isHome = m.team1 === team;
    if (!isHome && m.team2 !== team) continue;
    const weight = weightOf(m.date, now);
    w += weight;
    scored += weight * (isHome ? m.ft[0] : m.ft[1]);
    conceded += weight * (isHome ? m.ft[1] : m.ft[0]);
    games++;
  }
  const g = rates.perTeam;
  return {
    attack: (scored + PRIOR_GAMES * g) / (w + PRIOR_GAMES) / g,
    defense: (conceded + PRIOR_GAMES * g) / (w + PRIOR_GAMES) / g,
    games,
  };
}

// How much of team strength comes from shots rather than goals (0 = goals
// only, as before). Shots converge faster than goals: a side creating a lot
// but finishing badly reads as unlucky, not weak.
export const SHOT_WEIGHT = 0.5;

// League shot averages, over the games that carry shot data.
export function shotRates(matches: PlayedMatch[], now: Date): { home: number; away: number; perTeam: number } {
  let w = 0;
  let home = 0;
  let away = 0;
  for (const m of matches) {
    if (!m.sot) continue;
    const weight = weightOf(m.date, now);
    w += weight;
    home += weight * m.sot[0];
    away += weight * m.sot[1];
  }
  if (w === 0) return { home: 0, away: 0, perTeam: 0 };
  return { home: home / w, away: away / w, perTeam: (home + away) / (2 * w) };
}

// Same maths as strengthOf, on shots on target. Teams (or whole datasets)
// without shot data come back neutral (1.0): goals alone decide for them.
export function shotStrengthOf(
  matches: PlayedMatch[],
  team: string,
  rates: { home: number; away: number; perTeam: number },
  now: Date
): Strength {
  let w = 0;
  let scored = 0;
  let conceded = 0;
  let games = 0;
  for (const m of matches) {
    if (!m.sot) continue;
    const isHome = m.team1 === team;
    if (!isHome && m.team2 !== team) continue;
    const weight = weightOf(m.date, now);
    w += weight;
    scored += weight * (isHome ? m.sot[0] : m.sot[1]);
    conceded += weight * (isHome ? m.sot[1] : m.sot[0]);
    games++;
  }
  if (rates.perTeam === 0) return { attack: 1, defense: 1, games };
  const g = rates.perTeam;
  return {
    attack: (scored + PRIOR_GAMES * g) / (w + PRIOR_GAMES) / g,
    defense: (conceded + PRIOR_GAMES * g) / (w + PRIOR_GAMES) / g,
    games,
  };
}

// Goals and shots are both centered on 1.0 (team vs league average), so they
// blend directly: half the evidence from finishing, half from creating.
export function blendedStrength(goals: Strength, shots: Strength, weight = SHOT_WEIGHT): Strength {
  return {
    attack: (1 - weight) * goals.attack + weight * shots.attack,
    defense: (1 - weight) * goals.defense + weight * shots.defense,
    games: goals.games,
  };
}

export type Venue = "home" | "away";

// How a team does on one side of the pitch only: what it scores and concedes in
// its home games, or in its away games, against what the league scores there.
// Fewer games than the overall figure, so it is pulled towards the league
// average just the same.
export function venueStrengthOf(
  matches: PlayedMatch[],
  team: string,
  venue: Venue,
  rates: LeagueRates,
  now: Date
): Strength {
  let w = 0;
  let scored = 0;
  let conceded = 0;
  let games = 0;
  for (const m of matches) {
    if ((venue === "home" ? m.team1 : m.team2) !== team) continue;
    const weight = weightOf(m.date, now);
    w += weight;
    scored += weight * (venue === "home" ? m.ft[0] : m.ft[1]);
    conceded += weight * (venue === "home" ? m.ft[1] : m.ft[0]);
    games++;
  }
  // What the league scores where the team plays, and what it concedes there.
  const scoredRef = venue === "home" ? rates.home : rates.away;
  const concededRef = venue === "home" ? rates.away : rates.home;
  return {
    attack: (scored + PRIOR_GAMES * scoredRef) / (w + PRIOR_GAMES) / scoredRef,
    defense: (conceded + PRIOR_GAMES * concededRef) / (w + PRIOR_GAMES) / concededRef,
    games,
  };
}

function poisson(k: number, lambda: number): number {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

function tau(x: number, y: number, lh: number, la: number): number {
  if (x === 0 && y === 0) return 1 - lh * la * RHO;
  if (x === 0 && y === 1) return 1 + lh * RHO;
  if (x === 1 && y === 0) return 1 + la * RHO;
  if (x === 1 && y === 1) return 1 - RHO;
  return 1;
}

// grid[h][a] = chance the home side scores h and the away side a.
function scoreGrid(lh: number, la: number, correct: boolean): number[][] {
  const grid: number[][] = [];
  let total = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    grid[h] = [];
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = poisson(h, lh) * poisson(a, la) * (correct ? tau(h, a, lh, la) : 1);
      grid[h][a] = p;
      total += p;
    }
  }
  // Goals beyond MAX_GOALS are negligible; this only removes the rounding.
  return grid.map((row) => row.map((p) => p / total));
}

interface Outcome {
  home: number;
  draw: number;
  away: number;
}

function outcomes(grid: number[][]): Outcome {
  let home = 0;
  let draw = 0;
  let away = 0;
  grid.forEach((row, h) =>
    row.forEach((p, a) => {
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
    })
  );
  return { home, draw, away };
}

function overLine(grid: number[][], line: number): number {
  let p = 0;
  grid.forEach((row, h) => row.forEach((q, a) => (h + a > line ? (p += q) : 0)));
  return p;
}

export const OVER_LINES = [0.5, 1.5, 2.5, 3.5, 4.5] as const;

export interface Prediction {
  lambdaHome: number; // expected goals
  lambdaAway: number;
  fullTime: Outcome;
  over: Record<string, number>; // "2.5" -> chance of MORE than 2.5 goals
  bothScore: number;
  topScores: { home: number; away: number; p: number }[];
  halfTime: Outcome & { over05: number; over15: number };
  gamesHome: number;
  gamesAway: number;
}

// `ratio` (default 1) shifts the balance between the teams by hand: the home
// side's expected goals are multiplied by it and the away side's divided by it
// (see adjustments.ts).
//
// `venueWeight` (0 to 1, default 0) is how much of each team's strength comes
// from how it does on the side it plays on now (the home team at home, the away
// team away) instead of from all its games.
export function predict(
  matches: PlayedMatch[],
  home: string,
  away: string,
  now: Date,
  ratio = 1,
  venueWeight = 0
): Prediction {
  const rates = leagueRates(matches, now);
  let h = strengthOf(matches, home, rates, now);
  let a = strengthOf(matches, away, rates, now);

  if (venueWeight > 0) {
    const hv = venueStrengthOf(matches, home, "home", rates, now);
    const av = venueStrengthOf(matches, away, "away", rates, now);
    const mix = (overall: number, venue: number) => (1 - venueWeight) * overall + venueWeight * venue;
    h = { ...h, attack: mix(h.attack, hv.attack), defense: mix(h.defense, hv.defense) };
    a = { ...a, attack: mix(a.attack, av.attack), defense: mix(a.defense, av.defense) };
  }

  // Shot evidence blends in where it exists (stays goals-only otherwise).
  const shots = shotRates(matches, now);
  if (shots.perTeam > 0) {
    h = blendedStrength(h, shotStrengthOf(matches, home, shots, now));
    a = blendedStrength(a, shotStrengthOf(matches, away, shots, now));
  }

  const lambdaHome = rates.home * h.attack * a.defense * ratio;
  const lambdaAway = (rates.away * a.attack * h.defense) / ratio;

  return predictionFromLambdas(lambdaHome, lambdaAway, rates.firstHalfShare, h.games, a.games);
}

// Everything the model says about a game, from the goals each side is expected
// to score: the chances of every score and of the markets that come from them.
// `firstHalfShare` is the share of goals seen before the break, for the first-half
// estimate (a rougher one than the full-time figures).
export function predictionFromLambdas(
  lambdaHome: number,
  lambdaAway: number,
  firstHalfShare: number,
  gamesHome: number,
  gamesAway: number
): Prediction {
  const grid = scoreGrid(lambdaHome, lambdaAway, true);

  const over: Record<string, number> = {};
  for (const line of OVER_LINES) over[String(line)] = overLine(grid, line);

  let bothScore = 0;
  const scores: { home: number; away: number; p: number }[] = [];
  grid.forEach((row, hg) =>
    row.forEach((p, ag) => {
      if (hg > 0 && ag > 0) bothScore += p;
      scores.push({ home: hg, away: ag, p });
    })
  );
  scores.sort((x, y) => y.p - x.p);

  const htGrid = scoreGrid(lambdaHome * firstHalfShare, lambdaAway * firstHalfShare, false);

  return {
    lambdaHome,
    lambdaAway,
    fullTime: outcomes(grid),
    over,
    bothScore,
    topScores: scores.slice(0, 6),
    halfTime: {
      ...outcomes(htGrid),
      over05: overLine(htGrid, 0.5),
      over15: overLine(htGrid, 1.5),
    },
    gamesHome,
    gamesAway,
  };
}

// The odd at which a bet on something with chance p would break even.
export function fairOdd(p: number): number {
  return p > 0 ? 1 / p : Infinity;
}

// ---------------------------------------------------------------------------
// Plain records: form, averages and head to head.
// ---------------------------------------------------------------------------

export interface TeamGame {
  date: string;
  opponent: string;
  home: boolean;
  gf: number;
  ga: number;
  result: "V" | "E" | "D";
  // Only for games added by hand (cups, Europe...); the league is the default.
  competition?: string;
  // Played at a neutral venue: `home` is then only the side listed first.
  neutral?: boolean;
}

// The team's games, most recent first.
export function gamesOf(matches: PlayedMatch[], team: string): TeamGame[] {
  const out: TeamGame[] = [];
  for (const m of matches) {
    const isHome = m.team1 === team;
    if (!isHome && m.team2 !== team) continue;
    const gf = isHome ? m.ft[0] : m.ft[1];
    const ga = isHome ? m.ft[1] : m.ft[0];
    out.push({
      date: m.date,
      opponent: isHome ? m.team2 : m.team1,
      home: isHome,
      gf,
      ga,
      result: gf > ga ? "V" : gf === ga ? "E" : "D",
      ...(m.neutral ? { neutral: true } : {}),
    });
  }
  return out.sort((x, y) => y.date.localeCompare(x.date));
}

export interface Summary {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  gfPerGame: number;
  gaPerGame: number;
  bothScorePct: number;
  over25Pct: number;
  cleanSheetPct: number;
}

export function summarize(games: TeamGame[]): Summary | null {
  const n = games.length;
  if (n === 0) return null;
  const count = (test: (g: TeamGame) => boolean) => games.filter(test).length;
  return {
    games: n,
    wins: count((g) => g.result === "V"),
    draws: count((g) => g.result === "E"),
    losses: count((g) => g.result === "D"),
    gfPerGame: games.reduce((s, g) => s + g.gf, 0) / n,
    gaPerGame: games.reduce((s, g) => s + g.ga, 0) / n,
    bothScorePct: (count((g) => g.gf > 0 && g.ga > 0) / n) * 100,
    over25Pct: (count((g) => g.gf + g.ga > 2) / n) * 100,
    cleanSheetPct: (count((g) => g.ga === 0) / n) * 100,
  };
}

// Meetings between the two teams, in either order, most recent first.
export function headToHead(matches: PlayedMatch[], a: string, b: string): PlayedMatch[] {
  return matches
    .filter((m) => (m.team1 === a && m.team2 === b) || (m.team1 === b && m.team2 === a))
    .sort((x, y) => y.date.localeCompare(x.date));
}

// ---------------------------------------------------------------------------
// A team's season, game by game (played or still to come).
// ---------------------------------------------------------------------------

export interface Fixture {
  date: string;
  team1: string;
  team2: string;
  ft: [number, number] | null; // null while not played (or not in the data yet)
  // Only for games added by hand (cups, Europe...); the league is the default.
  competition?: string;
  round?: string; // "Matchday 7"
  time?: string; // kickoff, "20:15"
}

// The team's games of the season in date order.
export function seasonOf(fixtures: Fixture[], team: string): Fixture[] {
  return fixtures
    .filter((f) => f.team1 === team || f.team2 === team)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function resultFor(fixture: Fixture, team: string): "V" | "E" | "D" | null {
  if (!fixture.ft) return null;
  const mine = fixture.team1 === team ? fixture.ft[0] : fixture.ft[1];
  const theirs = fixture.team1 === team ? fixture.ft[1] : fixture.ft[0];
  return mine > theirs ? "V" : mine === theirs ? "E" : "D";
}

// ---------------------------------------------------------------------------
// When a team scores and concedes: the free data has no goal minutes, only the
// score at half time and at the end, so this is by half.
// ---------------------------------------------------------------------------

export interface GoalsByHalf {
  games: number; // games with a half time score
  firstFor: number;
  firstAgainst: number;
  secondFor: number;
  secondAgainst: number;
}

export function goalsByHalf(matches: PlayedMatch[], team: string, since: string): GoalsByHalf {
  const out: GoalsByHalf = { games: 0, firstFor: 0, firstAgainst: 0, secondFor: 0, secondAgainst: 0 };
  for (const m of matches) {
    if (m.date < since || !m.ht) continue;
    const isHome = m.team1 === team;
    if (!isHome && m.team2 !== team) continue;
    const [htFor, htAgainst] = isHome ? m.ht : [m.ht[1], m.ht[0]];
    const [ftFor, ftAgainst] = isHome ? m.ft : [m.ft[1], m.ft[0]];
    out.games++;
    out.firstFor += htFor;
    out.firstAgainst += htAgainst;
    out.secondFor += ftFor - htFor;
    out.secondAgainst += ftAgainst - htAgainst;
  }
  return out;
}

// The date of the team's most recent league game on the calendar, played or
// not in the data yet: a game whose date has passed most likely happened even
// if its result has not arrived. Cups and European games are not in this data.
export function lastLeagueGameDate(fixtures: Fixture[], team: string, today: string): string | null {
  const past = seasonOf(fixtures, team).filter((f) => f.date <= today);
  return past.length > 0 ? past[past.length - 1].date : null;
}

// The date of its next league game on the calendar, if any.
export function nextLeagueGameDate(fixtures: Fixture[], team: string, today: string): string | null {
  return seasonOf(fixtures, team).find((f) => f.date > today)?.date ?? null;
}
