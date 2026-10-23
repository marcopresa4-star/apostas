// xG and L15 for a game in progress, from SofaScore's shotmap: every shot
// carries its minute, side and (where the competition has coverage) its xG.
//
//  - xG: what each side has created so far (goals included — a goal was a
//    shot too).
//  - L15: what each side created in the last 15 minutes of the clock — the
//    "quem está a carregar agora" reading. It is xG in that window when the
//    shotmap has xG values; otherwise it falls back to the number of shots
//    (same reading, without quality).
//  - L15': what each side is expected to create in the next 15 minutes. With
//    xG it comes from the live model (predictLive): the pre-match expectation
//    left, with the current score, red cards and the xG pace so far. Without
//    xG (or without pre-match data) it falls back to the recent rate shrunk
//    towards the game's own average with a 5-minute prior — the formula that
//    shipped before the model. Needs at least 5 minutes played.
//
// The model won the shotmap backtest at every minute (MAE 0.247 vs 0.314 for
// persistence and 0.294 for the old L15'; 918 samples / 72 games), so the
// best blend is 100% model. The backtest is scripts/backtest-l15.ts.
//
// This is OUR definition (documented here and shown in the UI), not
// CornerProBet's proprietary L15/L15' algorithm. Corners have no per-minute
// feed (incidents only carry cards/goals/subs; the live tracker is a
// Sportradar widget without a JSON feed), so they are not part of it — the
// pressure chart above the values carries SofaScore's own attack momentum.

import { predictLive } from "./liveModel";

export interface PressureShot {
  minute: number;
  home: boolean;
  xg: number | null;
  goal?: boolean;
}

export interface SidePressure {
  // Accumulated xG so far (null when the shotmap has no xG at all).
  xg: number | null;
  // Shots so far, and shots in the last-15 window.
  shots: number;
  shots15: number;
  // xG (or shots, without xG) in the last 15 minutes.
  l15: number | null;
  // Projection for the next 15 minutes (null before 5 minutes are played).
  l15p: number | null;
}

export interface PressureSummary {
  minute: number;
  // Minutes of the match actually covered by the last-15 window.
  window: number;
  hasXg: boolean;
  // Where the L15' number came from: the live model (xG competitions with
  // pre-match data) or the recent-rate fallback.
  l15pSource: "model" | "rate";
  home: SidePressure;
  away: SidePressure;
}

// Everything the live model needs besides the shotmap. The caller resolves
// the pre-match lambdas (prematchFor) and reads the score/reds from the event.
export interface LiveModelContext {
  lambdaHome: number;
  lambdaAway: number;
  firstHalfShare: number;
  homeGoals: number;
  awayGoals: number;
  redsHome: number;
  redsAway: number;
}

export interface Next15 {
  home: number;
  away: number;
}

// How the two L15' projections read together, in the terms the metric is used
// for: one-way game (one side high, the other low), open game (both high) or
// closed game (both low). Thresholds are in xG-per-15' terms: about 0.22 is
// the league-average side, so 0.30 is above average and 0.15 well below.
export function l15Reading(
  home: number | null,
  away: number | null,
  homeName: string,
  awayName: string
): string | null {
  if (home === null || away === null) return null;
  const hi = Math.max(home, away);
  const lo = Math.min(home, away);
  if (hi < 0.15) return "jogo fechado";
  if (lo >= 0.3) return "jogo aberto";
  if (hi >= 0.35 && (lo < 0.2 || hi >= 2.5 * lo)) {
    return `sentido único (${home > away ? homeName : awayName})`;
  }
  return "equilibrado";
}

const WINDOW = 15;
// Minutes of the game's average mixed into the recent rate (shrinks small
// samples; 5' of average keeps an early 15' burst honest).
const PRIOR_MIN = 5;
const MIN_FOR_PROJECTION = 5;

const side = (shots: PressureShot[], isHome: boolean, hasXg: boolean, played: number): SidePressure => {
  const own = shots.filter((s) => s.home === isHome);
  const from = Math.max(0, played - WINDOW);
  const recent = own.filter((s) => s.minute > from);
  const total = hasXg ? own.reduce((n, s) => n + (s.xg ?? 0), 0) : own.length;
  const recentValue = hasXg ? recent.reduce((n, s) => n + (s.xg ?? 0), 0) : recent.length;
  const window = played - from;
  const gameRate = total / Math.max(1, played);
  const rate = window > 0 ? (recentValue + gameRate * PRIOR_MIN) / (window + PRIOR_MIN) : gameRate;
  return {
    xg: hasXg ? total : null,
    shots: own.length,
    shots15: recent.length,
    l15: window > 0 ? recentValue : null,
    l15p: window >= MIN_FOR_PROJECTION ? rate * WINDOW : null,
  };
};

// Expected xG for each side in the next 15 minutes, from the live model.
// Null without shotmap xG (the fallback stays in shot units) and before the
// projection gate. The remaining expectation is split by the clock left: with
// less than 15 minutes to play, the window is the rest of the game.
export function modelNext15(shots: PressureShot[], minute: number, ctx: LiveModelContext): Next15 | null {
  if (!Number.isFinite(minute) || minute < MIN_FOR_PROJECTION) return null;
  const played = Math.max(0, Math.min(130, minute));
  const inPlay = shots.filter((s) => s.minute <= played);
  if (inPlay.length === 0) return null;
  if (!inPlay.some((s) => s.xg !== null)) return null;
  const xg = (isHome: boolean): number =>
    inPlay.filter((s) => s.home === isHome).reduce((n, s) => n + (s.xg ?? 0), 0);
  const pred = predictLive({
    lambdaHome: ctx.lambdaHome,
    lambdaAway: ctx.lambdaAway,
    firstHalfShare: ctx.firstHalfShare,
    minute: played,
    homeGoals: ctx.homeGoals,
    awayGoals: ctx.awayGoals,
    redsHome: ctx.redsHome,
    redsAway: ctx.redsAway,
    homeXg: xg(true),
    awayXg: xg(false),
  });
  const left = Math.max(1, 90 - played);
  const factor = Math.min(WINDOW, left) / left;
  return {
    home: Math.max(0, pred.remainingHome * factor),
    away: Math.max(0, pred.remainingAway * factor),
  };
}

// `minute` is the live clock; without one (poller between updates, finished
// game) the last shot's minute stands in. Empty shotmap -> null (silence, not
// zeros). `model` is the optional next-15 projection from modelNext15: when
// present (and the shotmap has xG) it replaces the rate-based L15'.
export function pressureSummary(
  shots: PressureShot[],
  minute: number | null,
  model?: Next15 | null
): PressureSummary | null {
  if (shots.length === 0) return null;
  const lastShot = Math.max(...shots.map((s) => s.minute));
  const played = Math.max(0, Math.min(130, minute ?? lastShot));
  const inPlay = shots.filter((s) => s.minute <= played);
  if (inPlay.length === 0) return null;
  const hasXg = inPlay.some((s) => s.xg !== null);
  const from = Math.max(0, played - WINDOW);
  const useModel =
    hasXg &&
    played >= MIN_FOR_PROJECTION &&
    model !== null &&
    model !== undefined &&
    Number.isFinite(model.home) &&
    Number.isFinite(model.away)
      ? model
      : null;
  const home = side(inPlay, true, hasXg, played);
  const away = side(inPlay, false, hasXg, played);
  return {
    minute: played,
    window: played - from,
    hasXg,
    l15pSource: useModel ? "model" : "rate",
    home: useModel ? { ...home, l15p: Math.max(0, useModel.home) } : home,
    away: useModel ? { ...away, l15p: Math.max(0, useModel.away) } : away,
  };
}
