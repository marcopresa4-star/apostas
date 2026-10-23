// Backtest for the L15' projection: at minute M, predict the xG a side will
// create in the next 15 minutes and compare three candidates against what
// actually happened (shotmap):
//
//   1. persistence  — the xG of the last 15 minutes (what the current L15
//                     shows), assumed to repeat;
//   2. current L15' — persistence shrunk towards the game's average (the
//                     formula that shipped before the model blend);
//   3. model        — predictLive's remaining xG (pre-match prior from the
//                     closing 1X2 odds, score, red cards, live xG form),
//                     scaled to the next 15 minutes.
//
// Plus a blend `w * model + (1 - w) * persistence` for w in 0..1. The weight
// is picked on a train split and reported on the held-out events — weights
// are chosen by data, not intuition.
//
// The production UI feeds prematchFor's lambdas; this backtest uses the
// closing 1X2 odds de-margined and fitted to a Poisson as a proxy, because
// the app model's historical pre-match snapshot is not available for these
// events. The comparison is still model vs persistence on the same target.
//
// Run: npx tsx scripts/backtest-l15.ts
// Needs the local SofaScore scraper on 127.0.0.1:9323. Raw responses are
// cached in the OS temp dir so re-runs are instant.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { predictLive } from "../src/lib/liveModel";
import { pressureSummary, type PressureShot } from "../src/lib/livePressure";

const SCRAPER = process.env.SOFASCORE_SCRAPER_URL ?? "http://127.0.0.1:9323";
const CACHE = join(tmpdir(), "apostas-l15-backtest");
const TEAMS = [
  { id: 3006, name: "Benfica" },
  { id: 3002, name: "FC Porto" },
  { id: 3001, name: "Sporting CP" },
  { id: 17, name: "Manchester City" },
  { id: 44, name: "Liverpool" },
  { id: 42, name: "Arsenal" },
  { id: 2829, name: "Real Madrid" },
  { id: 2817, name: "Barcelona" },
  { id: 2672, name: "Bayern" },
  { id: 1644, name: "PSG" },
  { id: 2697, name: "Inter" },
  { id: 2692, name: "Milan" },
  { id: 2687, name: "Juventus" },
];
const GAMES_PER_TEAM = 6;
const FIRST_HALF_SHARE = 0.44;
const MINUTES = [15, 25, 35, 45, 55, 65, 75];
const WINDOW = 15;

interface Json {
  [key: string]: unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T = Json>(path: string): Promise<T> {
  const file = join(CACHE, `${path.replace(/[^a-z0-9]+/gi, "_")}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as T;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${SCRAPER}/raw?path=${encodeURIComponent(path)}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) {
      const body = (await res.json()) as T;
      writeFileSync(file, JSON.stringify(body));
      return body;
    }
    if (res.status === 404) throw new Error(`notfound ${path}`);
    await sleep(500 * (attempt + 1));
  }
  throw new Error(`upstream ${path}`);
}

interface TeamEvent {
  id: number;
  home: string;
  away: string;
  finished: boolean;
  homeGoals: number | null;
  awayGoals: number | null;
}

async function teamEvents(teamId: number): Promise<TeamEvent[]> {
  const body = await getJson<{ events?: unknown[] }>(`/team/${teamId}/events/last/0`).catch(() => ({ events: [] }));
  const events: TeamEvent[] = [];
  for (const raw of body.events ?? []) {
    if (typeof raw !== "object" || raw === null) continue;
    const e = raw as Record<string, unknown>;
    const status = (e.status ?? {}) as Record<string, unknown>;
    if (String(status.type ?? "") !== "finished") continue;
    const home = (e.homeTeam ?? {}) as Record<string, unknown>;
    const away = (e.awayTeam ?? {}) as Record<string, unknown>;
    const homeScore = (e.homeScore ?? {}) as Record<string, unknown>;
    const awayScore = (e.awayScore ?? {}) as Record<string, unknown>;
    const hg = typeof homeScore.current === "number" ? homeScore.current : null;
    const ag = typeof awayScore.current === "number" ? awayScore.current : null;
    if (typeof e.id !== "number" || typeof home.name !== "string" || typeof away.name !== "string") continue;
    events.push({ id: e.id, home: home.name, away: away.name, finished: true, homeGoals: hg, awayGoals: ag });
  }
  return events.slice(-GAMES_PER_TEAM);
}

interface Incident {
  minute: number;
  type: string;
  cls: string;
  home: boolean;
}

async function incidents(eventId: number): Promise<Incident[]> {
  const body = await getJson<{ incidents?: unknown[] }>(`/event/${eventId}/incidents`).catch(() => ({ incidents: [] }));
  return (body.incidents ?? []).flatMap((raw): Incident[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const i = raw as Record<string, unknown>;
    const minute = typeof i.time === "number" ? i.time : null;
    if (minute === null) return [];
    return [
      {
        minute,
        type: String(i.incidentType ?? "").toLowerCase(),
        cls: String(i.incidentClass ?? "").toLowerCase(),
        home: i.isHome === true,
      },
    ];
  });
}

const isGoal = (i: Incident): boolean => {
  if (!i.type.includes("goal") && !i.type.includes("penalt")) return false;
  if (/own/.test(i.cls)) return true;
  if (/miss|saved|post|blocked|off|disallowed/.test(i.cls)) return false;
  return true;
};

async function shotsOf(eventId: number): Promise<PressureShot[]> {
  const body = await getJson<{ shotmap?: unknown[] }>(`/event/${eventId}/shotmap`).catch(() => ({ shotmap: [] }));
  return (body.shotmap ?? []).flatMap((raw): PressureShot[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const s = raw as Record<string, unknown>;
    if (typeof s.time !== "number" || typeof s.xg !== "number" || !(s.xg >= 0)) return [];
    return [{ minute: s.time, home: s.isHome === true, xg: s.xg, goal: s.shotType === "goal" }];
  });
}

// Decimal odds from the fractional value ("15/2" -> 8.5), same as the app.
function decimal(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const text = String(value).trim().toUpperCase();
  if (text === "EVS" || text === "EVEN") return 2;
  const [n, d] = text.split("/");
  const num = Number(n);
  const den = Number(d);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
  const odd = 1 + num / den;
  return odd > 1 ? odd : null;
}

interface Lambdas {
  home: number;
  away: number;
}

// Pre-match 1X2 from the closing odds, de-margined, fitted to an independent
// Poisson. Grid search is plenty for a prior.
async function lambdasFromOdds(eventId: number): Promise<Lambdas | null> {
  const body = await getJson<{ markets?: unknown[] }>(`/event/${eventId}/odds/1/all`).catch(() => ({ markets: [] }));
  const market = (body.markets ?? []).find((raw) => {
    if (typeof raw !== "object" || raw === null) return false;
    const m = raw as Record<string, unknown>;
    return (
      String(m.marketGroup ?? "").toLowerCase() === "1x2" &&
      String(m.marketPeriod ?? "").toLowerCase() === "full-time" &&
      m.isLive !== true &&
      m.suspended !== true
    );
  });
  if (!market) return null;
  const choices = ((market as Record<string, unknown>).choices ?? []) as unknown[];
  const odd = (name: string): number | null => {
    const c = choices.find((raw) => typeof raw === "object" && raw !== null && (raw as Record<string, unknown>).name === name);
    return c ? decimal((c as Record<string, unknown>).fractionalValue) : null;
  };
  const h = odd("1");
  const d = odd("X");
  const a = odd("2");
  if (h === null || d === null || a === null) return null;
  const inv = [1 / h, 1 / d, 1 / a];
  const sum = inv.reduce((s, x) => s + x, 0);
  const [ph, pd, pa] = inv.map((x) => x / sum);

  const grid: number[] = [];
  for (let l = 0.2; l <= 3.6 + 1e-9; l += 0.05) grid.push(Math.round(l * 100) / 100);
  const pmf = (lambda: number): number[] => {
    const out = [Math.exp(-lambda)];
    for (let k = 1; k <= 10; k++) out[k] = (out[k - 1] * lambda) / k;
    return out;
  };
  const pmfs = grid.map(pmf);
  let best: { home: number; away: number; err: number } | null = null;
  for (let i = 0; i < grid.length; i++) {
    for (let j = 0; j < grid.length; j++) {
      let home = 0;
      let draw = 0;
      let away = 0;
      const hp = pmfs[i];
      const ap = pmfs[j];
      for (let x = 0; x <= 10; x++) {
        for (let y = 0; y <= 10; y++) {
          const p = hp[x] * ap[y];
          if (x > y) home += p;
          else if (x === y) draw += p;
          else away += p;
        }
      }
      const err = (home - ph) ** 2 + (draw - pd) ** 2 + (away - pa) ** 2;
      if (!best || err < best.err) best = { home: grid[i], away: grid[j], err };
    }
  }
  return best ? { home: best.home, away: best.away } : null;
}

interface Sample {
  eventId: number;
  minute: number;
  side: "home" | "away";
  target: number;
  persistence: number;
  current: number;
  // Model remaining xG scaled to 15' by the clock left (90 - minute).
  model: number;
  // Model remaining xG at M minus remaining xG at M+15: the model's own
  // time weighting over the window, stoppage included.
  modelDiff: number;
}

function sideShots(shots: PressureShot[], home: boolean, from: number, to: number): number {
  return shots
    .filter((s) => s.home === home && s.minute > from && s.minute <= to)
    .reduce((n, s) => n + (s.xg ?? 0), 0);
}

async function eventSamples(event: TeamEvent): Promise<Sample[]> {
  if (event.homeGoals === null || event.awayGoals === null) return [];
  const [shots, inc, lambdas] = await Promise.all([shotsOf(event.id), incidents(event.id), lambdasFromOdds(event.id)]);
  if (shots.length < 8 || !lambdas) return [];
  const goals = inc.filter(isGoal);
  // The score context must agree with the incident timeline, otherwise the
  // red/goal state at minute M is unknown and the sample is useless.
  if (goals.length !== event.homeGoals + event.awayGoals) return [];
  const samples: Sample[] = [];
  for (const minute of MINUTES) {
    const inPlay = shots.filter((s) => s.minute <= minute);
    if (inPlay.length === 0) continue;
    const p = pressureSummary(shots, minute);
    if (!p || p.home.l15p === null || p.away.l15p === null) continue;
    const homeGoals = goals.filter((g) => g.minute <= minute && g.home).length;
    const awayGoals = goals.filter((g) => g.minute <= minute && !g.home).length;
    const redsHome = inc.filter((i) => i.minute <= minute && i.home && /red/.test(i.cls)).length;
    const redsAway = inc.filter((i) => i.minute <= minute && !i.home && /red/.test(i.cls)).length;
    const homeXg = sideShots(shots, true, -1, minute);
    const awayXg = sideShots(shots, false, -1, minute);
    const pred = predictLive({
      lambdaHome: lambdas.home,
      lambdaAway: lambdas.away,
      firstHalfShare: FIRST_HALF_SHARE,
      minute,
      homeGoals,
      awayGoals,
      redsHome,
      redsAway,
      homeXg,
      awayXg,
    });
    const left = Math.max(1, 90 - minute);
    const modelHome = (pred.remainingHome * Math.min(WINDOW, left)) / left;
    const modelAway = (pred.remainingAway * Math.min(WINDOW, left)) / left;
    // Same live state, clock 15 minutes later: the difference between the
    // two remaining expectations is what the model thinks falls in the
    // window (its own half/stoppage weights, not a flat division).
    const later = predictLive({
      lambdaHome: lambdas.home,
      lambdaAway: lambdas.away,
      firstHalfShare: FIRST_HALF_SHARE,
      minute: minute + WINDOW,
      homeGoals,
      awayGoals,
      redsHome,
      redsAway,
      homeXg,
      awayXg,
    });
    const diffHome = Math.max(0, pred.remainingHome - later.remainingHome);
    const diffAway = Math.max(0, pred.remainingAway - later.remainingAway);
    for (const home of [true, false]) {
      samples.push({
        eventId: event.id,
        minute,
        side: home ? "home" : "away",
        target: sideShots(shots, home, minute, minute + WINDOW),
        persistence: home ? p.home.l15! : p.away.l15!,
        current: home ? p.home.l15p : p.away.l15p!,
        model: home ? modelHome : modelAway,
        modelDiff: home ? diffHome : diffAway,
      });
    }
  }
  return samples;
}

interface Metrics {
  n: number;
  mae: number;
  rmse: number;
}

function metrics(rows: { pred: number; target: number }[]): Metrics {
  const n = rows.length;
  const mae = rows.reduce((s, r) => s + Math.abs(r.pred - r.target), 0) / n;
  const rmse = Math.sqrt(rows.reduce((s, r) => s + (r.pred - r.target) ** 2, 0) / n);
  return { n, mae, rmse };
}

const fmt = (v: number) => v.toFixed(3).replace(".", ",");

async function main(): Promise<void> {
  mkdirSync(CACHE, { recursive: true });
  console.log(`Cache: ${CACHE}`);
  const events: TeamEvent[] = [];
  const seen = new Set<number>();
  for (const team of TEAMS) {
    const list = await teamEvents(team.id);
    for (const e of list) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      events.push(e);
    }
    console.log(`${team.name}: ${list.length} jogos terminados`);
  }
  console.log(`\n${events.length} jogos únicos; a ler shotmaps/odds/incidentes...\n`);

  const samples: Sample[] = [];
  let skipped = 0;
  for (let i = 0; i < events.length; i += 2) {
    const chunk = events.slice(i, i + 2);
    const results = await Promise.all(chunk.map((e) => eventSamples(e).catch(() => [] as Sample[])));
    for (const r of results) {
      if (r.length === 0) skipped++;
      samples.push(...r);
    }
    process.stdout.write(`\r${Math.min(i + 2, events.length)}/${events.length} jogos · ${samples.length} amostras`);
  }
  console.log(`\n\nAmostras: ${samples.length} (jogos sem xG/odds/score coerente: ${skipped})`);

  // Deterministic split: even-indexed events train, odd-indexed test.
  const eventIds = [...new Set(samples.map((s) => s.eventId))].sort((a, b) => a - b);
  const trainIds = new Set(eventIds.filter((_, i) => i % 2 === 0));
  const train = samples.filter((s) => trainIds.has(s.eventId));
  const test = samples.filter((s) => !trainIds.has(s.eventId));
  console.log(`Treino: ${train.length} amostras · teste: ${test.length} amostras\n`);

  const method = (rows: Sample[], fn: (s: Sample) => number) => metrics(rows.map((s) => ({ pred: fn(s), target: s.target })));
  const persistence = method(train, (s) => s.persistence);
  const current = method(train, (s) => s.current);
  const model = method(train, (s) => s.model);
  const modelDiff = method(train, (s) => s.modelDiff);
  const zero = method(train, () => 0);

  console.log("Treino (MAE / RMSE):");
  console.log(`  zero              ${fmt(zero.mae)} / ${fmt(zero.rmse)}`);
  console.log(`  persistência      ${fmt(persistence.mae)} / ${fmt(persistence.rmse)}`);
  console.log(`  L15' atual        ${fmt(current.mae)} / ${fmt(current.rmse)}`);
  console.log(`  modelo (escala)   ${fmt(model.mae)} / ${fmt(model.rmse)}`);
  console.log(`  modelo (diferença)${fmt(modelDiff.mae)} / ${fmt(modelDiff.rmse)}`);

  // Best base model (flat scale vs its own clock), then its best blend with
  // persistence. Both chosen on train only.
  const baseName = modelDiff.mae < model.mae ? "diferença" : "escala";
  const base = baseName === "diferença" ? (s: Sample) => s.modelDiff : (s: Sample) => s.model;
  let bestW = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let w = 0; w <= 1.0001; w += 0.05) {
    const m = method(train, (s) => w * base(s) + (1 - w) * s.persistence);
    if (m.mae < best) {
      best = m.mae;
      bestW = Math.round(w * 100) / 100;
    }
  }
  console.log(
    `\nMelhor base no treino: modelo (${baseName}); melhor mistura: ${Math.round(bestW * 100)}% modelo + ${Math.round((1 - bestW) * 100)}% persistência (MAE ${fmt(best)})`
  );

  // Same grid against the old L15' formula, in case shrinking towards the
  // game average is a better recent component than raw persistence.
  let bestCurrentW = 0;
  let bestCurrent = Number.POSITIVE_INFINITY;
  for (let w = 0; w <= 1.0001; w += 0.05) {
    const m = method(train, (s) => w * base(s) + (1 - w) * s.current);
    if (m.mae < bestCurrent) {
      bestCurrent = m.mae;
      bestCurrentW = Math.round(w * 100) / 100;
    }
  }
  console.log(
    `Melhor mistura com o L15' antigo: ${Math.round(bestCurrentW * 100)}% modelo + ${Math.round((1 - bestCurrentW) * 100)}% L15' antigo (MAE ${fmt(bestCurrent)})`
  );

  const testRows = (fn: (s: Sample) => number) => metrics(test.map((s) => ({ pred: fn(s), target: s.target })));
  console.log("\nTeste (holdout):");
  for (const [name, fn] of [
    ["persistência", (s: Sample) => s.persistence],
    ["L15' atual", (s: Sample) => s.current],
    ["modelo escala", (s: Sample) => s.model],
    ["modelo diferença", (s: Sample) => s.modelDiff],
    [`${Math.round(bestW * 100)}/${Math.round((1 - bestW) * 100)}`, (s: Sample) => bestW * base(s) + (1 - bestW) * s.persistence],
    [`${Math.round(bestCurrentW * 100)}/${Math.round((1 - bestCurrentW) * 100)} c`, (s: Sample) => bestCurrentW * base(s) + (1 - bestCurrentW) * s.current],
    ["zero", () => 0],
  ] as const) {
    const m = testRows(fn);
    console.log(`  ${name.padEnd(16)} ${fmt(m.mae)} / ${fmt(m.rmse)}  (n=${m.n})`);
  }

  // Per-minute MAE, to see where each candidate struggles (early game,
  // halftime, late game). Means alone hide compensating errors.
  console.log("\nPor minuto (teste, MAE): persistência · L15' atual · modelo escala · modelo diferença · alvo médio");
  for (const minute of MINUTES) {
    const rows = test.filter((s) => s.minute === minute);
    if (rows.length === 0) continue;
    const err = (fn: (s: Sample) => number) => rows.reduce((s, r) => s + Math.abs(fn(r) - r.target), 0) / rows.length;
    const mean = rows.reduce((s, r) => s + r.target, 0) / rows.length;
    console.log(
      `  ${String(minute).padStart(2)}'  ${fmt(err((s) => s.persistence))} · ${fmt(err((s) => s.current))} · ${fmt(err((s) => s.model))} · ${fmt(err((s) => s.modelDiff))} · ${fmt(mean)}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
