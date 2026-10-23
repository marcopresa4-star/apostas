// xG and L15 for a game in progress, from SofaScore's shotmap: every shot
// carries its minute, side and (where the competition has coverage) its xG.
//
//  - xG: what each side has created so far (goals included — a goal was a
//    shot too).
//  - L15: what each side created in the last 15 minutes of the clock — the
//    "quem está a carregar agora" reading. It is xG in that window when the
//    shotmap has xG values; otherwise it falls back to the number of shots
//    (same reading, without quality).
//  - L15': the same recent rate projected onto the next 15 minutes. The recent
//    window is shrunk towards the game's own average with a 5-minute prior:
//    an early burst does not become a forecast, a side that has been pressing
//    all game keeps a sensible projection. Needs at least 5 minutes played.
//
// This is OUR definition (documented here and shown in the UI), not
// CornerProBet's proprietary L15/L15' algorithm. Corners have no per-minute
// feed, so they are not part of it — the pressure chart above the values
// carries SofaScore's own attack momentum.

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
  home: SidePressure;
  away: SidePressure;
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

// `minute` is the live clock; without one (poller between updates, finished
// game) the last shot's minute stands in. Empty shotmap -> null (silence, not
// zeros).
export function pressureSummary(shots: PressureShot[], minute: number | null): PressureSummary | null {
  if (shots.length === 0) return null;
  const lastShot = Math.max(...shots.map((s) => s.minute));
  const played = Math.max(0, Math.min(130, minute ?? lastShot));
  const inPlay = shots.filter((s) => s.minute <= played);
  if (inPlay.length === 0) return null;
  const hasXg = inPlay.some((s) => s.xg !== null);
  const from = Math.max(0, played - WINDOW);
  return {
    minute: played,
    window: played - from,
    hasXg,
    home: side(inPlay, true, hasXg, played),
    away: side(inPlay, false, hasXg, played),
  };
}
