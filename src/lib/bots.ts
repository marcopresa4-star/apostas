// Live-monitoring bots: pure condition evaluators (vitest-covered) plus the
// small history helpers the server check route and the backtest share.
// Client-safe: no server imports. Numbers only — never invented.
import type { PlayedMatch } from "./footballModel";

export type BotMode = "and" | "or";
export type BotPeriod = "any" | "first" | "second" | "half";
export type BotMarket = "mais1" | "home" | "draw" | "away" | "over25" | "btts" | "sh_over15" | "fh_over05";

export interface BotStat {
  k: string;
  v: number;
}

export type PregameSide = "home" | "away" | "either";
export type PregameMetric = "total_over15" | "total_over25" | "btts" | "sh_over05" | "sh_over15" | "fh_over05" | "fh_over15";

export interface PregameRule {
  kind?: "hist";
  side: PregameSide;
  metric: PregameMetric;
  n: number;
  pct: number;
}

// Section «Antes do jogo» (form) — three criteria kinds. Old rows (from
// before the redesign) come without `kind` and stay hist. All rules must
// pass (AND) before the bot watches a game live.
export type PregameAvgStat = "corners_total" | "corners_fh" | "corners_sh" | "goals_total" | "goals_fh" | "goals_sh";
export type PregameOddWhich = "fav" | "home" | "away";
export type PregameFavState = "any" | "winning" | "drawing" | "losing" | "not_winning";

export interface AvgRule {
  kind: "avg";
  side: PregameSide;
  metric: PregameAvgStat;
  n: number; // fixed 10 in the form
  cmp: "gte" | "lte"; // ≥ no mínimo / ≤ no máximo
  v: number;
}

export interface OddRule {
  kind: "odd";
  which: PregameOddWhich; // side whose pre-match odd the check uses
  cmp: "gte" | "lte";
  v: number; // pre-match 1X2 odd
  favState: PregameFavState; // live state of the pre-match favourite
}

export type PregameRow = (PregameRule & { kind?: "hist" }) | AvgRule | OddRule;

export const isAvgRow = (r: PregameRow): r is AvgRule => r.kind === "avg";
export const isOddRow = (r: PregameRow): r is OddRule => r.kind === "odd";

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
  pregame: PregameRow[];
  refire: boolean;
  goals: GoalRules;
}

// Fire-time goal filters ("Onde e quando" section): total goals on the
// pitch, score difference (any side, absolute) and goals per half. "any" is
// neutral. First/second-half comparisons only know their values from the
// interval on: before that the filter holds the alert back (fail closed).
export type GoalCmp = "any" | "exact" | "lt" | "gte";

export interface GoalRules {
  total: GoalCmp;
  totalV: number;
  diff: GoalCmp;
  diffV: number;
  fh: GoalCmp;
  fhV: number;
  sh: GoalCmp;
  shV: number;
}

export const GOALS_NEUTRAL: GoalRules = {
  total: "any",
  totalV: 0,
  diff: "any",
  diffV: 0,
  fh: "any",
  fhV: 0,
  sh: "any",
  shV: 0,
};

export const goalsNeutral = (g: unknown): GoalRules =>
  typeof g === "object" && g !== null
    ? { ...GOALS_NEUTRAL, ...(g as Partial<GoalRules>) }
    : { ...GOALS_NEUTRAL };

// One comparison against a measured value; null measured = fail (except the
// neutral "any", which never looks at the value).
const cmpOk = (cmp: GoalCmp, want: number, got: number | null): boolean => {
  if (cmp === "any" || got === null) return cmp === "any";
  return cmp === "exact" ? got === want : cmp === "lt" ? got < want : got >= want;
};

export function goalRulesOk(
  rules: GoalRules,
  vals: { total: number; diff: number; fh: number | null; sh: number | null }
): boolean {
  return (
    cmpOk(rules.total, rules.totalV, vals.total) &&
    cmpOk(rules.diff, rules.diffV, vals.diff) &&
    cmpOk(rules.fh, rules.fhV, vals.fh) &&
    cmpOk(rules.sh, rules.shV, vals.sh)
  );
}

export const GOAL_CMP_LABELS: Record<GoalCmp, string> = {
  any: "Qualquer",
  exact: "Exatamente",
  lt: "Menos de",
  gte: "Pelo menos",
};

export interface LiveSnapshot {
  minute: number;
  phase: "live" | "halftime";
  hg: number;
  ag: number;
  // Full-time... no: current half-time totals straight from the event's
  // period1 (null until the interval). The goal-per-half filters read them.
  hth?: number | null;
  hta?: number | null;
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
  bot: Pick<Bot, "minute_from" | "minute_to" | "period" | "score" | "goals">,
  snap: LiveSnapshot
): boolean {
  if (snap.minute < bot.minute_from || snap.minute > bot.minute_to) return false;
  if (bot.period === "first" && !(snap.phase === "live" && snap.minute < 45)) return false;
  if (bot.period === "second" && !(snap.phase === "live" && snap.minute >= 45)) return false;
  if (bot.period === "half" && snap.phase !== "halftime") return false;
  if (!scoreOk(bot.score, snap.hg, snap.ag)) return false;
  const goals = goalsNeutral(bot.goals);
  const fh = snap.hth != null && snap.hta != null ? snap.hth + snap.hta : null;
  const sh = fh !== null ? Math.max(0, snap.hg + snap.ag - fh) : null;
  return goalRulesOk(goals, { total: snap.hg + snap.ag, diff: Math.abs(snap.hg - snap.ag), fh, sh });
}

export interface StatValues {
  shots_total: number;
  shots_home: number;
  shots_away: number;
  sot_total: number;
  shots_off_total: number;
  shots_blocked_total: number;
  corners_total: number;
  corners_home: number;
  corners_away: number;
  poss_home: number;
  poss_away: number;
  goals_home: number;
  goals_away: number;
  offsides_total: number;
  fouls_total: number;
  saves_total: number;
  big_total: number;
  yellows_total: number;
  reds_total: number;
  pressure_recent: number;
  pressure_recent5: number;
  pressure_recent10: number;
  pressure_recent15: number;
  pressure_total: number;
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

// First-half shares need the raw totals, computed apart (kept explicit so a
// thin history without half-time scores fails the rule instead of guessing).
export function firstHalfShares(games: PlayedMatch[], team: string, n: number): { over05: number; over15: number; games: number } {
  const totals = games
    .filter((m) => m.team1 === team || m.team2 === team)
    .slice(-n)
    .flatMap((m) => (m.ht ? [m.ht[0] + m.ht[1]] : []));
  return {
    over05: totals.length > 0 ? totals.filter((t) => t > 0.5).length / totals.length : 0,
    over15: totals.length > 0 ? totals.filter((t) => t > 1.5).length / totals.length : 0,
    games: totals.length,
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
export function pregameOk(  rule: PregameRule,
  pool: PlayedMatch[],
  home: string,
  away: string
): boolean {
  const sides = rule.side === "home" ? [home] : rule.side === "away" ? [away] : [home, away];
  const test = (team: string): boolean | null => {
    if (rule.metric === "fh_over05" || rule.metric === "fh_over15") {
      const s = firstHalfShares(pool, team, rule.n);
      if (s.games < 5) return null;
      return ((rule.metric === "fh_over05" ? s.over05 : s.over15) * 100 >= rule.pct);
    }
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

// Mean goals a team scored in its last n games of the pool — `total` from
// the final score; the halves need half-time scores (fewer than 5 games with
// HT = no data, fails closed). Real history only, like the rest of the model.
export function goalAvg(pool: PlayedMatch[], team: string, part: "total" | "fh" | "sh", n = 10): number | null {
  const last = pool
    .filter((m) => m.team1 === team || m.team2 === team)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, Math.max(1, n));
  const vals: number[] = [];
  for (const m of last) {
    const i = m.team1 === team ? 0 : 1;
    if (part === "total") vals.push(m.ft[i]);
    else if (m.ht) vals.push(part === "fh" ? m.ht[i] : m.ft[i] - m.ht[i]);
  }
  if (vals.length < 5) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export const cmpGteLte = (cmp: "gte" | "lte", want: number, got: number): boolean =>
  cmp === "gte" ? got >= want : got <= want;

// «Média estatística» rule over the history pool (goals only — corners need
// the event reads, which the check route performs).
export function goalAvgOk(rule: AvgRule, pool: PlayedMatch[], home: string, away: string): boolean {
  const part: "total" | "fh" | "sh" = rule.metric === "goals_total" ? "total" : rule.metric === "goals_fh" ? "fh" : "sh";
  const sides = rule.side === "home" ? [home] : rule.side === "away" ? [away] : [home, away];
  const results = sides.map((team) => {
    const avg = goalAvg(pool, team, part, rule.n);
    return avg !== null && cmpGteLte(rule.cmp, rule.v, avg);
  });
  // missing data on any chosen side fails closed (either = any side passing)
  return rule.side === "either" ? results.some(Boolean) : results.every(Boolean);
}

export interface Pre1x2 {
  home: number;
  away: number;
}

// Live state of the pre-match favourite against the current score.
export function favStateOk(state: PregameFavState, fav: "home" | "away", hg: number, ag: number): boolean {
  const favAhead = fav === "home" ? hg > ag : ag > hg;
  const favBehind = fav === "home" ? hg < ag : ag < hg;
  switch (state) {
    case "any":
      return true;
    case "winning":
      return favAhead;
    case "losing":
      return favBehind;
    case "drawing":
      return hg === ag;
    case "not_winning":
      return !favAhead;
  }
}

// «Odd pré-jogo» rule: pre-match 1X2 prices pick the favourite; the threshold
// applies to the chosen side's odd, the state to the favourite's live score.
// No pre-match 1X2 available = the game sits out (fail closed), per the form.
export function oddPregameOk(rule: OddRule, pre: Pre1x2 | null, hg: number, ag: number): boolean {
  if (!pre) return false;
  const fav: "home" | "away" = pre.home <= pre.away ? "home" : "away";
  const odd = rule.which === "home" ? pre.home : rule.which === "away" ? pre.away : fav === "home" ? pre.home : pre.away;
  if (!cmpGteLte(rule.cmp, rule.v, odd)) return false;
  return favStateOk(rule.favState, fav, hg, ag);
}

export const PREGAME_AVG_STATS: { key: PregameAvgStat; label: string }[] = [
  { key: "corners_total", label: "Média de cantos no jogo" },
  { key: "corners_fh", label: "Média de cantos na 1.ª parte" },
  { key: "corners_sh", label: "Média de cantos na 2.ª parte" },
  { key: "goals_total", label: "Média de golos no jogo" },
  { key: "goals_fh", label: "Média de golos na 1.ª parte" },
  { key: "goals_sh", label: "Média de golos na 2.ª parte" },
];

export const PREGAME_AVG_CMP: { key: "gte" | "lte"; label: string }[] = [
  { key: "gte", label: "≥ no mínimo" },
  { key: "lte", label: "≤ no máximo" },
];

export const PREGAME_ODD_CMP: { key: "gte" | "lte"; label: string }[] = [
  { key: "lte", label: "≤ no máximo" },
  { key: "gte", label: "≥ no mínimo" },
];

export const PREGAME_ODD_WHICH: { key: PregameOddWhich; label: string }[] = [
  { key: "fav", label: "Favorito" },
  { key: "home", label: "Casa" },
  { key: "away", label: "Fora" },
];

export const PREGAME_FAV_STATES: { key: PregameFavState; label: string }[] = [
  { key: "any", label: "Qualquer" },
  { key: "losing", label: "A perder" },
  { key: "drawing", label: "A empatar" },
  { key: "not_winning", label: "Sem ganhar" },
  { key: "winning", label: "A ganhar" },
];

// Settles a fired alert once the game finishes. Second-half markets need to
// know when the alert fired: before the break the 2nd-half score is
// unknowable from (alert, final) alone, so they stay undecided (null). The
// 1st-half market needs the half-time score instead: pass it when known,
// else undecided too. `horizonFirst` narrows a total-goals market (mais1) to
// the FIRST HALF: a bot scoped to "period first" promises a goal before the
// break — goals after it are irrelevant, so the HT score decides, not the
// final one. (Final-only markets like home/draw/away/over25/btts ignore it.)
export function settleAlert(
  market: BotMarket,
  alertHg: number,
  alertAg: number,
  finalHg: number,
  finalAg: number,
  alertMinute: number | null = null,
  htHg: number | null = null,
  htAg: number | null = null,
  horizonFirst = false
): boolean | null {
  // markets whose horizon is the interval when the bot lives in the 1st half
  if (horizonFirst && market === "mais1") {
    if (htHg === null || htAg === null) return null;
    return htHg + htAg > alertHg + alertAg;
  }
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
    case "sh_over15":
      if (alertMinute === null || alertMinute < 45) return null;
      return finalHg + finalAg - (alertHg + alertAg) > 1.5;
    case "fh_over05":
      if (htHg === null || htAg === null) return null;
      return htHg + htAg > 0.5;
  }
}

export const BOT_MARKETS: { key: BotMarket; label: string }[] = [
  { key: "mais1", label: "Mais 1 golo" },
  { key: "home", label: "Vitória casa" },
  { key: "draw", label: "Empate" },
  { key: "away", label: "Vitória fora" },
  { key: "over25", label: "Over 2.5 final" },
  { key: "btts", label: "BTTS sim" },
  { key: "sh_over15", label: "Over 1.5 — 2ª parte" },
  { key: "fh_over05", label: "Over 0.5 — 1ª parte" },
];

export const BOT_STATS: { k: string; label: string; unit: string; hidden?: boolean }[] = [
  // Legacy per-side keys: still valid for old bots (validated + evaluated) but
  // the «Ao vivo» form covers them under «equipa» rows with Casa/Fora pills.
  { k: "shots_home", label: "Remates casa ≥", unit: "", hidden: true },
  { k: "shots_away", label: "Remates fora ≥", unit: "", hidden: true },
  { k: "corners_home", label: "Cantos casa ≥", unit: "", hidden: true },
  { k: "corners_away", label: "Cantos fora ≥", unit: "", hidden: true },
  { k: "poss_home", label: "Posse casa ≥", unit: "%", hidden: true },
  { k: "poss_away", label: "Posse fora ≥", unit: "%", hidden: true },
  { k: "pressure_recent", label: "Pressão recente (remates últ. 10′) ≥", unit: "", hidden: true },
  { k: "big_total", label: "Grandes oportunidades ≥", unit: "", hidden: true },
  // team-goals keys feed «Golos de uma equipa»; validation only (the form
  // shows them under that row's Casa/Fora pills).
  { k: "goals_home", label: "Golos casa ≥", unit: "", hidden: true },
  { k: "goals_away", label: "Golos fora ≥", unit: "", hidden: true },
  // «Ao vivo» (secção 4) — the mock's rows.
  { k: "shots_total", label: "Remates totais ≥", unit: "" },
  { k: "sot_total", label: "Remates à baliza ≥", unit: "" },
  { k: "shots_off_total", label: "Remates para fora ≥", unit: "" },
  { k: "shots_blocked_total", label: "Remates bloqueados ≥", unit: "" },
  { k: "corners_total", label: "Cantos (total) ≥", unit: "" },
  { k: "offsides_total", label: "Foras de jogo ≥", unit: "" },
  { k: "pressure_total", label: "Pressão no jogo todo ≥", unit: "" },
  { k: "pressure_recent5", label: "Pressão recente (últ. 5′) ≥", unit: "" },
  { k: "pressure_recent15", label: "Pressão recente (últ. 15′) ≥", unit: "" },
  { k: "yellows_total", label: "Amarelos (total) ≥", unit: "" },
  { k: "reds_total", label: "Vermelhos (total) ≥", unit: "" },
  { k: "fouls_total", label: "Faltas (total) ≥", unit: "" },
  { k: "saves_total", label: "Defesas dos GR ≥", unit: "" },
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
  { key: "fh_over05", label: "mais de 0,5 na 1.ª parte" },
  { key: "fh_over15", label: "mais de 1,5 na 1.ª parte" },
];
