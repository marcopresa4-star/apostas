// Planeamento Live: user-defined pattern tables over upcoming games.
// Pure part (client-safe, unit-tested): table/criterion shapes, labels and the
// pass evaluation over per-game counts. The data reads + scan live in the API
// route (server only).
//
// One criterion = one metric in one interval of the game, evaluated over the
// pooled recent games of both teams: the combined average ("Esperados") and
// the share of those games hitting at least `target` ("% de jogos"). Pass
// rule depends on `agg`: average >= target for "avg", share >= minPct for
// "pct". A table matches when EVERY criterion passes.

export type LiveMetric = "cantos" | "golos" | "amarelos";
export type LiveAgg = "avg" | "pct";

export interface LiveCriterion {
  id: string;
  metric: LiveMetric;
  from: number; // minute (inclusive)
  to: number; // minute (exclusive)
  agg: LiveAgg;
  target: number; // "at least N" count; decimals allowed for expected averages
  minPct: number; // pass bar for agg "pct" (percentage points)
}

export type LiveSample = "last10" | "season";
export type LiveLeaguesMode = "favs" | "all" | "custom";

export interface LiveTableDef {
  id: string;
  name: string;
  leaguesMode: LiveLeaguesMode;
  leagues: string[]; // league codes, only for "custom"
  sample: LiveSample;
  venueSplit: boolean; // home team: home games only, away: away games only
  criteria: LiveCriterion[];
}

export const METRIC_LABEL: Record<LiveMetric, string> = {
  cantos: "Cantos",
  golos: "Golos",
  amarelos: "Amarelos",
};

// Corners only exist as game/half totals (no 15' slices on the source).
export const isHalvesOnly = (metric: LiveMetric): boolean => metric === "cantos";

export function intervalLabel(from: number, to: number): string {
  if (from <= 0 && to >= 90) return "Jogo";
  if (from <= 0 && to <= 45) return "1ª parte";
  if (from === 45 && to >= 90) return "2ª parte";
  return `${from}–${to}′`;
}

// "Cantos 30–45′: ≥ 2 esperados" / "Amarelos 1ª parte: 70%+ com 1+".
const fmtTarget = (n: number): string => String(n).replace(".", ",");

export function criterionLabel(c: LiveCriterion): string {
  const what = `${METRIC_LABEL[c.metric]} ${intervalLabel(c.from, c.to)}`;
  return c.agg === "avg" ? `${what}: ≥ ${fmtTarget(c.target)} esperados` : `${what}: ${c.minPct}%+ com ${fmtTarget(c.target)}+`;
}

// The same fixture can be reached through two league loads (or repeated in
// a cached scan); the event id is the identity, so keep the first one.
export function uniqueByEventId<T extends { eventId: number }>(games: T[]): T[] {
  const seen = new Set<number>();
  return games.filter((g) => {
    if (seen.has(g.eventId)) return false;
    seen.add(g.eventId);
    return true;
  });
}

export interface CriterionEval {
  avg: number;
  pct: number; // 0-100 share of games with count >= target
  games: number;
  pass: boolean;
}

// Counts inside [from, to]: plain ranges, like the goal-timing buckets
// (a 45+3' mark reads 48 and falls in the 46-60 slice, same as elsewhere).
// Boundary minutes count (45' belongs to the 1st half) and anything past 90'
// belongs to the 2nd half / game.
export function countIn(minutes: number[], from: number, to: number): number {
  return minutes.filter((m) => m >= from && (m < to || m === to || (to >= 90 && m <= 130))).length;
}

export function evaluateCriterion(counts: number[], c: LiveCriterion): CriterionEval {
  const games = counts.length;
  if (games === 0) return { avg: 0, pct: 0, games: 0, pass: false };
  const avg = counts.reduce((s, n) => s + n, 0) / games;
  const pct = (counts.filter((n) => n >= c.target).length / games) * 100;
  const pass = c.agg === "avg" ? avg >= c.target : pct >= c.minPct;
  return { avg, pct, games, pass };
}

// Sanitizes a table coming from the client/DB before storing or scanning:
// drops empty/invalid criteria, clamps numbers, caps the count.
export function sanitizeTable(t: LiveTableDef): LiveTableDef | null {
  const name = (t.name ?? "").trim().slice(0, 40);
  if (!name) return null;
  const num = (v: unknown, lo: number, hi: number, fb: number): number => {
    const n = typeof v === "number" && Number.isFinite(v) ? v : fb;
    return Math.min(hi, Math.max(lo, n));
  };
  const criteria = (Array.isArray(t.criteria) ? t.criteria : [])
    .flatMap((c): LiveCriterion[] => {
      if (!c || typeof c !== "object") return [];
      const metric: LiveMetric = c.metric === "golos" || c.metric === "amarelos" ? c.metric : "cantos";
      let from = num(c.from, 0, 75, 0);
      let to = num(c.to, 15, 120, 90);
      if (to <= from) to = from + 15;
      // Corners have no 15' data: snap to halves/game.
      if (metric === "cantos") {
        if (from >= 45) {
          from = 45;
          to = 90;
        } else if (to <= 45) {
          from = 0;
          to = 45;
        } else {
          from = 0;
          to = 90;
        }
      }
      const agg: LiveAgg = c.agg === "pct" ? "pct" : "avg";
      // Expected averages can be decimals (1,5 golos); a % threshold is a
      // count, so it stays an integer.
      const target =
        agg === "avg"
          ? Math.round(num(c.target, 0.1, 20, 2) * 10) / 10
          : Math.round(num(c.target, 1, 20, 2));
      return [
        {
          id: typeof c.id === "string" && c.id ? c.id.slice(0, 24) : Math.random().toString(36).slice(2, 10),
          metric,
          from,
          to,
          agg,
          target,
          minPct: num(c.minPct, 1, 100, 70),
        },
      ];
    })
    .slice(0, 6);
  if (criteria.length === 0) return null;
  return {
    id: typeof t.id === "string" ? t.id.slice(0, 40) : "",
    name,
    leaguesMode: t.leaguesMode === "favs" || t.leaguesMode === "custom" ? t.leaguesMode : "all",
    leagues: Array.isArray(t.leagues) ? t.leagues.filter((l): l is string => typeof l === "string").slice(0, 45) : [],
    sample: t.sample === "season" ? "season" : "last10",
    venueSplit: t.venueSplit === true,
    criteria,
  };
}
