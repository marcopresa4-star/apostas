// Live-monitoring bots: pure condition evaluators (vitest-covered) plus the
// small history helpers the server check route and the backtest share.
// Client-safe: no server imports. Numbers only — never invented.
import type { PlayedMatch } from "./footballModel";

export type BotMode = "and" | "or";
export type BotPeriod = "any" | "first" | "second" | "half";
export type BotMarket = "mais1" | "home" | "draw" | "away" | "over25" | "btts";

export interface BotStat {
  k: string;
  v: number;
}

export type PregameSide = "home" | "away" | "either";
export type PregameMetric = "total_over15" | "total_over25" | "btts" | "sh_over05" | "sh_over15";

export interface PregameRule {
  side: PregameSide;
  metric: PregameMetric;
  n: number;
  pct: number;
}

export interface Bot {
  id: string;
  name: string;
  enabled: boolean;
  silent: boolean;
  mode: BotMode;
  leagues: string[];
  minute_from: number;
  minute_to: number;
  period: BotPeriod;
  score: string;
  market: BotMarket;
  min_prob: number | null;
  min_odd: number | null;
  stats: BotStat[];
  pregame: PregameRule[];
  refire: boolean;
}

export interface LiveSnapshot {
  minute: number;
  phase: "live" | "halftime";
  hg: number;
  ag: number;
}

// Minute from a status description ("63'", "45+2'"): ordinals ("2nd half")
// carry no minute — reading the ordinal (2nd -> 2) fabricates the minute.
// Falls back to the live-list minute when there is no tick mark.
export function snapMinute(desc: string, phase: "live" | "halftime", fallback: number): number {
  if (phase === "halftime") return 45;
  const m = desc.includes("'") ? /(\d{1,3})(?:\s*\+\s*(\d{1,2}))?/.exec(desc) : null;
  return m ? Math.min(130, Number(m[1]) + (m[2] ? Number(m[2]) : 0)) : fallback;
}

// Score conditions on the current score (home perspective).
export function scoreOk(score: string, hg: number, ag: number): boolean {
  switch (score) {
    case "any":
      return true;
    case "0-0":
      return hg === 0 && ag === 0;
    case "draw":
      return hg === ag;
    case "home_ahead":
      return hg > ag;
    case "away_ahead":
      return ag > hg;
    case "total0":
      return hg + ag === 0;
    case "total1":
      return hg + ag === 1;
    case "total2plus":
      return hg + ag >= 2;
    default:
      return true;
  }
}

// Required gates: minute window + period + score. Always all mandatory,
// whatever the E/OU mode (which only governs the stat triggers).
export function gatesOk(
  bot: Pick<Bot, "minute_from" | "minute_to" | "period" | "score">,
  snap: LiveSnapshot
): boolean {
  if (snap.minute < bot.minute_from || snap.minute > bot.minute_to) return false;
  if (bot.period === "first" && !(snap.phase === "live" && snap.minute < 45)) return false;
  if (bot.period === "second" && !(snap.phase === "live" && snap.minute >= 45)) return false;
  if (bot.period === "half" && snap.phase !== "halftime") return false;
  return scoreOk(bot.score, snap.hg, snap.ag);
}

export interface StatValues {
  shots_total: number;
  shots_home: number;
  shots_away: number;
  sot_total: number;
  corners_total: number;
  corners_home: number;
  corners_away: number;
  poss_home: number;
  poss_away: number;
  fouls_total: number;
  saves_total: number;
  yellows_total: number;
  reds_total: number;
  pressure_recent: number;
}

// One trigger against the values (missing stat = trigger fails closed).
export function statOk(k: string, v: number, vals: Partial<StatValues>): boolean {
  const got = vals[k as keyof StatValues];
  if (got === undefined || !Number.isFinite(got)) return false;
  return got >= v;
}

// E/OU over the SELECTED stat triggers only.
export function statsOk(mode: BotMode, stats: BotStat[], vals: Partial<StatValues>): boolean {
  if (stats.length === 0) return true;
  const hits = stats.map((s) => statOk(s.k, s.v, vals));
  return mode === "and" ? hits.every(Boolean) : hits.some(Boolean);
}

// Last-n history shares for one side's games (most recent first in `games`).
export function historyShares(games: PlayedMatch[], team: string, n: number): {
  total_over15: number;
  total_over25: number;
  btts: number;
} | null {
  const mine = games.filter((m) => m.team1 === team || m.team2 === team).slice(-n);
  if (mine.length === 0) return null;
  const total = (m: PlayedMatch): number => m.ft[0] + m.ft[1];
  const mineBtts = (m: PlayedMatch): boolean => m.ft[0] > 0 && m.ft[1] > 0;
  const share = (test: (m: PlayedMatch) => boolean): number => mine.filter(test).length / mine.length;
  return {
    total_over15: share((m) => total(m) > 1.5),
    total_over25: share((m) => total(m) > 2.5),
    btts: share(mineBtts),
  };
}

// Second-half shares need the raw totals, computed apart (kept explicit so a
// thin history without half-time scores fails the rule instead of guessing).
export function secondHalfShares(games: PlayedMatch[], team: string, n: number): { over05: number; over15: number; games: number } {
  const totals = games
    .filter((m) => m.team1 === team || m.team2 === team)
    .slice(-n)
    .flatMap((m) => (m.ht ? [m.ft[0] + m.ft[1] - (m.ht[0] + m.ht[1])] : []));
  return {
    over05: totals.length > 0 ? totals.filter((t) => t > 0.5).length / totals.length : 0,
    over15: totals.length > 0 ? totals.filter((t) => t > 1.5).length / totals.length : 0,
    games: totals.length,
  };
}

// One pre-game rule over league history (home/away = that side's last n;
// either = at least one side passes). No history, or too few games with
// half-time scores for a second-half metric, fails closed.
export function pregameOk(
  rule: PregameRule,
  pool: PlayedMatch[],
  home: string,
  away: string
): boolean {
  const sides = rule.side === "home" ? [home] : rule.side === "away" ? [away] : [home, away];
  const test = (team: string): boolean | null => {
    if (rule.metric === "sh_over05" || rule.metric === "sh_over15") {
      const s = secondHalfShares(pool, team, rule.n);
      if (s.games < 5) return null;
      return ((rule.metric === "sh_over05" ? s.over05 : s.over15) * 100 >= rule.pct);
    }
    const s = historyShares(pool, team, rule.n);
    if (!s) return null;
    const share = s[rule.metric];
    return share * 100 >= rule.pct;
  };
  const results = sides.map(test);
  if (results.some((r) => r === null)) return false;
  return rule.side === "either" ? results.some((r) => r === true) : results.every((r) => r === true);
}

// Settles a fired alert once the game finishes.
export function settleAlert(
  market: BotMarket,
  alertHg: number,
  alertAg: number,
  finalHg: number,
  finalAg: number
): boolean {
  switch (market) {
    case "mais1":
      return finalHg + finalAg > alertHg + alertAg;
    case "home":
      return finalHg > finalAg;
    case "draw":
      return finalHg === finalAg;
    case "away":
      return finalAg > finalHg;
    case "over25":
      return finalHg + finalAg > 2.5;
    case "btts":
      return finalHg > 0 && finalAg > 0;
  }
}

export const BOT_MARKETS: { key: BotMarket; label: string }[] = [
  { key: "mais1", label: "Mais 1 golo" },
  { key: "home", label: "Vitória casa" },
  { key: "draw", label: "Empate" },
  { key: "away", label: "Vitória fora" },
  { key: "over25", label: "Over 2.5 final" },
  { key: "btts", label: "BTTS sim" },
];

export const BOT_STATS: { k: string; label: string; unit: string }[] = [
  { k: "shots_total", label: "Remates totais ≥", unit: "" },
  { k: "shots_home", label: "Remates casa ≥", unit: "" },
  { k: "shots_away", label: "Remates fora ≥", unit: "" },
  { k: "sot_total", label: "Remates à baliza (total) ≥", unit: "" },
  { k: "corners_total", label: "Cantos ≥", unit: "" },
  { k: "corners_home", label: "Cantos casa ≥", unit: "" },
  { k: "corners_away", label: "Cantos fora ≥", unit: "" },
  { k: "poss_home", label: "Posse casa ≥", unit: "%" },
  { k: "poss_away", label: "Posse fora ≥", unit: "%" },
  { k: "pressure_recent", label: "Pressão recente (remates últ. 10′) ≥", unit: "" },
  { k: "yellows_total", label: "Amarelos (total) ≥", unit: "" },
  { k: "reds_total", label: "Vermelhos (total) ≥", unit: "" },
  { k: "fouls_total", label: "Faltas (total) ≥", unit: "" },
  { k: "saves_total", label: "Defesas (total) ≥", unit: "" },
];

export const BOT_SCORES: { key: string; label: string }[] = [
  { key: "any", label: "Qualquer marcador" },
  { key: "0-0", label: "0–0" },
  { key: "draw", label: "Empate" },
  { key: "home_ahead", label: "Casa a ganhar" },
  { key: "away_ahead", label: "Fora a ganhar" },
  { key: "total0", label: "0 golos totais" },
  { key: "total1", label: "1 golo total" },
  { key: "total2plus", label: "2+ golos totais" },
];

export const PREGAME_METRICS: { key: PregameMetric; label: string }[] = [
  { key: "total_over15", label: "mais de 1,5 no jogo" },
  { key: "total_over25", label: "mais de 2,5 no jogo" },
  { key: "btts", label: "ambas marcam" },
  { key: "sh_over05", label: "mais de 0,5 na 2.ª parte" },
  { key: "sh_over15", label: "mais de 1,5 na 2.ª parte" },
];
