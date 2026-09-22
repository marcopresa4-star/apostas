// For your own settled bets, what the model would have said at the time (using
// only results from before that game), for the plainest kinds of selection. Lets
// you compare your own picks with the model's, instead of only the model's
// picks with what happened (that is what the Fiabilidade page already does).

import { predict, type PlayedMatch, type Prediction } from "./footballModel";
import { baseRates, MIN_GAMES, SOLID_GAMES, TRUST, type BaseRates, type PickGroup } from "./recommendation";
import { findMatch, parseMarket } from "./betOutcome";
import { greenWeight, redWeight } from "./betResult";
import type { BetStatus } from "./database.types";

export interface ReliabilityBet {
  id: string;
  kind: "pick" | "leg";
  date: string;
  homeNames: string[];
  awayNames: string[];
  home: string;
  away: string;
  selection: string;
  status: BetStatus;
}

export interface ReliabilityRow extends ReliabilityBet {
  leagueLabel: string | null; // null: no game of this date/teams found in the data
  key: string | null; // the market recognised in the selection, null if not one of the plain kinds
  modelP: number | null; // the model's chance for it, at the time
  base: number | null; // how often that market happens in that league
  fragile: boolean; // one of the teams had few games in the data at the time
}

const swapKey = (key: string): string => (key === "home" ? "away" : key === "away" ? "home" : key === "1x" ? "x2" : key === "x2" ? "1x" : key);

const groupOf = (key: string): PickGroup => (key.startsWith("over:") || key.startsWith("under:") ? "goals" : key.startsWith("btts:") ? "btts" : "result");

// The model's raw chance and the league's rate for `key`, straight from a
// prediction (not the pulled-back one `recommendation.ts` shows): `over`/`under`
// only exist for the lines the model actually computes (0.5, 1.5, 2.5, 3.5, 4.5).
function rawFor(key: string, prediction: Prediction, base: BaseRates): { p: number; base: number } | null {
  const ft = prediction.fullTime;
  if (key === "home") return { p: ft.home, base: base.home };
  if (key === "away") return { p: ft.away, base: base.away };
  if (key === "draw") return { p: ft.draw, base: base.draw };
  if (key === "1x") return { p: ft.home + ft.draw, base: base.home + base.draw };
  if (key === "x2") return { p: ft.away + ft.draw, base: base.away + base.draw };
  if (key === "12") return { p: ft.home + ft.away, base: base.home + base.away };
  if (key === "btts:yes") return { p: prediction.bothScore, base: base.btts };
  if (key === "btts:no") return { p: 1 - prediction.bothScore, base: 1 - base.btts };
  const over = /^over:([\d.]+)$/.exec(key);
  if (over) {
    const p = prediction.over[over[1]];
    const b = base.over[over[1]];
    return p !== undefined && b !== undefined ? { p, base: b } : null;
  }
  const under = /^under:([\d.]+)$/.exec(key);
  if (under) {
    const p = prediction.over[under[1]];
    const b = base.over[under[1]];
    return p !== undefined && b !== undefined ? { p: 1 - p, base: 1 - b } : null;
  }
  return null;
}

// `leagues` is every league's own matches (each league's array on its own, not
// merged, so a game can be predicted from only that league's history).
export function computeReliability(
  bets: ReliabilityBet[],
  leagues: { label: string; matches: PlayedMatch[] }[]
): ReliabilityRow[] {
  return bets.map((bet): ReliabilityRow => {
    let found: { label: string; match: PlayedMatch; homeIsTeam1: boolean; matches: PlayedMatch[] } | null = null;
    for (const league of leagues) {
      const f = findMatch({ date: bet.date, homeNames: bet.homeNames, awayNames: bet.awayNames }, league.matches);
      if (f) {
        found = { label: league.label, match: f.match, homeIsTeam1: f.homeIsTeam1, matches: league.matches };
        break;
      }
    }
    if (!found) return { ...bet, leagueLabel: null, key: null, modelP: null, base: null, fragile: false };

    const market = parseMarket(bet.selection, bet.homeNames, bet.awayNames);
    if (!market) return { ...bet, leagueLabel: found.label, key: null, modelP: null, base: null, fragile: false };

    const past = found.matches.filter((m) => m.date < bet.date);
    const at = new Date(`${bet.date}T12:00:00`);
    const prediction = predict(past, found.match.team1, found.match.team2, at);
    const games = Math.min(prediction.gamesHome, prediction.gamesAway);
    if (games < MIN_GAMES) {
      return { ...bet, leagueLabel: found.label, key: market.key, modelP: null, base: null, fragile: true };
    }

    const key = found.homeIsTeam1 ? market.key : swapKey(market.key);
    const raw = rawFor(key, prediction, baseRates(past));
    if (!raw) return { ...bet, leagueLabel: found.label, key: market.key, modelP: null, base: null, fragile: games < SOLID_GAMES };

    const group = groupOf(key);
    const p = raw.base + TRUST[group] * (raw.p - raw.base);
    return { ...bet, leagueLabel: found.label, key: market.key, modelP: p, base: raw.base, fragile: games < SOLID_GAMES };
  });
}

export interface ReliabilitySummary {
  matched: number; // rows with a model chance
  unmatched: number; // settled bets whose game or wording could not be read
  hitRate: number | null; // your own green/red rate, over the matched rows
  claimed: number | null; // average model chance of what you picked
  leagueRate: number | null; // average of how often that market happens in the league
  // Split by whether the model rated your pick above or below the league's own
  // rate for that market ("valor" in the app's own words elsewhere).
  aboveAverage: { count: number; hitRate: number | null };
  belowAverage: { count: number; hitRate: number | null };
}

export function summarize(rows: ReliabilityRow[]): ReliabilitySummary {
  const matched = rows.filter((r) => r.modelP !== null && (r.status === "green" || r.status === "red" || r.status === "half_green" || r.status === "half_red"));
  const weight = (test: (r: ReliabilityRow) => boolean) => {
    const subset = matched.filter(test);
    const green = subset.reduce((s, r) => s + greenWeight(r.status), 0);
    const red = subset.reduce((s, r) => s + redWeight(r.status), 0);
    const decided = green + red;
    return { count: subset.length, hitRate: decided > 0 ? green / decided : null };
  };
  const all = weight(() => true);
  const above = weight((r) => r.modelP! >= r.base!);
  const below = weight((r) => r.modelP! < r.base!);
  return {
    matched: matched.length,
    unmatched: rows.length - matched.length,
    hitRate: all.hitRate,
    claimed: matched.length > 0 ? matched.reduce((s, r) => s + r.modelP!, 0) / matched.length : null,
    leagueRate: matched.length > 0 ? matched.reduce((s, r) => s + r.base!, 0) / matched.length : null,
    aboveAverage: above,
    belowAverage: below,
  };
}
