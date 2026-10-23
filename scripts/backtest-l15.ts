// Backtest for the L15' projection: at minute M, predict the xG a side will
// create in the next 15 minutes and compare three candidates against what
// actually happened (shotmap):
//
//   1. persistence  — the xG of the last 15 minutes (what the current L15
//                     shows), assumed to repeat;
//   2. current L15' — persistence shrunk towards the game's average (the
//                     formula that shipped before the model blend);
//   3. model        — predictLive's remaining xG (pre-match prior, score, red
//                     cards, live xG form), scaled to the next 15 minutes.
//
// Two priors feed the model:
//   - odds: closing 1X2 de-margined and fitted to a Poisson (the proxy used
//     in the first run, kept so the whole set stays comparable);
//   - real: the app's own prematchFromMatches (the maths behind prematchFor),
//     replayed point-in-time — only matches dated before kick-off and `now` at
//     kick-off, so the event itself and anything after it cannot leak in.
// The real prior needs the local Supabase + the league data the app already
// loads; when it is unavailable the odds run still works.
//
// Plus a blend `w * model + (1 - w) * persistence` for w in 0..1. The weight
// is picked on a train split and reported on the held-out events — weights
// are chosen by data, not intuition.
//
// Run: npx tsx --conditions=react-server scripts/backtest-l15.ts
// (`react-server` is what lets server-only modules load outside Next.)
// Needs the local SofaScore scraper on 127.0.0.1:9323 and, for the real
// prior, SUPABASE_SERVICE_ROLE_KEY (local: `npx supabase status -o env`).
// Raw responses are cached in the OS temp dir so re-runs are instant.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { predictLive } from "../src/lib/liveModel";
import { pressureSummary, type PressureShot } from "../src/lib/livePressure";
import { loadSofaLeague, type SofaLeague } from "../src/lib/sofaLeague";
import { loadMaps } from "../src/lib/sofaHistory";
import { prematchFromMatches } from "../src/lib/sofaPrematch";

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
  // Point-in-time replay needs the kick-off clock and the league the event
  // belongs to (unique tournament id -> app league code via sofascore_maps).
  kickoff: number | null;
  tournamentId: number | null;
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
    const kickoff = typeof e.startTimestamp === "number" ? e.startTimestamp : null;
    const tournament = (e.tournament ?? {}) as Record<string, unknown>;
    const unique = (tournament.uniqueTournament ?? {}) as Record<string, unknown>;
    const tournamentId = typeof unique.id === "number" ? unique.id : null;
    events.push({
      id: e.id,
      home: home.name,
      away: away.name,
      finished: true,
      homeGoals: hg,
      awayGoals: ag,
      kickoff,
      tournamentId,
    });
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

// --- Real pre-match prior: the app's own model, replayed point-in-time ------

interface Prior {
  home: number;
  away: number;
  firstHalfShare: number;
}

interface PriorPair {
  eventId: number;
  oddsHome: number;
  oddsAway: number;
  realHome: number;
  realAway: number;
}

interface PriorContext {
  forEvent(event: TeamEvent): Promise<Prior | null>;
}

// Match dates in the app are Lisbon calendar days; use the same calendar so
// the "< kick-off day" cutoff cannot include the event itself.
const LISBON_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Lisbon",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const lisbonDate = (ts: number): string => LISBON_DATE.format(new Date(ts * 1000));

async function firstUserId(sb: SupabaseClient): Promise<string | null> {
  const { data, error } = await sb.from("sofascore_maps").select("user_id").limit(1);
  if (error || !data || data.length === 0) return null;
  const id = (data[0] as { user_id?: unknown }).user_id;
  return typeof id === "string" ? id : null;
}

// Loads the same league data prematchFor loads (results only: history/shots/
// fixtures add nothing to a goals prior) and replays the model as of kick-off.
// Unmapped leagues or unknown teams return null: production would use TYPICAL
// and the UI would keep L15' on the rate fallback, so there is nothing to test.
async function priorContext(): Promise<PriorContext | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log("Sem NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY: só o prior das odds.");
    return null;
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const userId = process.env.SUPABASE_USER_ID ?? (await firstUserId(sb));
  if (!userId) {
    console.log("Sem utilizador em sofascore_maps: só o prior das odds.");
    return null;
  }
  const [tournaments, teams] = await Promise.all([
    loadMaps(sb, userId, "tournament"),
    loadMaps(sb, userId, "team"),
  ]);
  const toLocal = new Map(teams.filter((m) => m.local_name).map((m) => [m.name, m.local_name]));
  const leagues = new Map<string, Promise<SofaLeague | null>>();
  const league = (code: string): Promise<SofaLeague | null> => {
    let pending = leagues.get(code);
    if (!pending) {
      pending = loadSofaLeague(sb, userId, code, { history: false, shots: false, fixtures: false }).catch(
        () => null
      );
      leagues.set(code, pending);
    }
    return pending;
  };
  return {
    async forEvent(event) {
      if (event.kickoff === null || event.tournamentId === null) return null;
      const code = tournaments.find((m) => m.sofascore_id === event.tournamentId)?.name_key;
      if (!code) return null;
      const loaded = await league(code);
      if (!loaded) return null;
      const casa = toLocal.get(event.home) ?? event.home;
      const fora = toLocal.get(event.away) ?? event.away;
      if (!loaded.data.teams.includes(casa) || !loaded.data.teams.includes(fora)) return null;
      // Only days strictly before kick-off: a same-day earlier result is left
      // out (conservative) and the event itself can never enter its own prior.
      const before = loaded.data.matches.filter((m) => m.date < lisbonDate(event.kickoff!));
      if (before.length < 20) return null;
      const p = prematchFromMatches(before, casa, fora, new Date(event.kickoff * 1000), code);
      if (!Number.isFinite(p.home) || !Number.isFinite(p.away) || p.home <= 0 || p.away <= 0) return null;
      return { home: p.home, away: p.away, firstHalfShare: p.firstHalfShare };
    },
  };
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
  // Same scale, but with the real prematchFor prior. Null when that prior is
  // unavailable for the event.
  modelReal: number | null;
  // Model remaining xG at M minus remaining xG at M+15: the model's own
  // time weighting over the window, stoppage included.
  modelDiff: number;
}

function sideShots(shots: PressureShot[], home: boolean, from: number, to: number): number {
  return shots
    .filter((s) => s.home === home && s.minute > from && s.minute <= to)
    .reduce((n, s) => n + (s.xg ?? 0), 0);
}

async function eventSamples(
  event: TeamEvent,
  priors: PriorContext | null
): Promise<{ samples: Sample[]; prior: PriorPair | null }> {
  if (event.homeGoals === null || event.awayGoals === null) return { samples: [], prior: null };
  const [shots, inc, odds, real] = await Promise.all([
    shotsOf(event.id),
    incidents(event.id),
    lambdasFromOdds(event.id),
    priors ? priors.forEvent(event) : Promise.resolve(null),
  ]);
  if (shots.length < 8 || !odds) return { samples: [], prior: null };
  const goals = inc.filter(isGoal);
  // The score context must agree with the incident timeline, otherwise the
  // red/goal state at minute M is unknown and the sample is useless.
  if (goals.length !== event.homeGoals + event.awayGoals) return { samples: [], prior: null };
  const oddsPrior: Prior = { ...odds, firstHalfShare: FIRST_HALF_SHARE };
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
    const predictWith = (prior: Prior) =>
      predictLive({
        lambdaHome: prior.home,
        lambdaAway: prior.away,
        firstHalfShare: prior.firstHalfShare,
        minute,
        homeGoals,
        awayGoals,
        redsHome,
        redsAway,
        homeXg,
        awayXg,
      });
    const pred = predictWith(oddsPrior);
    const realPred = real ? predictWith(real) : null;
    const left = Math.max(1, 90 - minute);
    const scale = Math.min(WINDOW, left) / left;
    const modelHome = pred.remainingHome * scale;
    const modelAway = pred.remainingAway * scale;
    const realHome = realPred ? realPred.remainingHome * scale : null;
    const realAway = realPred ? realPred.remainingAway * scale : null;
    // Same live state, clock 15 minutes later: the difference between the
    // two remaining expectations is what the model thinks falls in the
    // window (its own half/stoppage weights, not a flat division).
    const later = predictLive({
      lambdaHome: oddsPrior.home,
      lambdaAway: oddsPrior.away,
      firstHalfShare: oddsPrior.firstHalfShare,
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
        modelReal: home ? realHome : realAway,
        modelDiff: home ? diffHome : diffAway,
      });
    }
  }
  const prior = real
    ? {
        eventId: event.id,
        oddsHome: odds.home,
        oddsAway: odds.away,
        realHome: real.home,
        realAway: real.away,
      }
    : null;
  return { samples, prior };
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

// .env.local is Next's file; a plain script does not get it for free. Existing
// environment variables win (so CI/one-off overrides still work).
function loadEnv(): void {
  const file = join(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const text = line.trim();
    if (!text || text.startsWith("#")) continue;
    const eq = text.indexOf("=");
    if (eq <= 0) continue;
    const key = text.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = text.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function main(): Promise<void> {
  loadEnv();
  mkdirSync(CACHE, { recursive: true });
  console.log(`Cache: ${CACHE}`);
  const priors = await priorContext();
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
  const priorPairs: PriorPair[] = [];
  let skipped = 0;
  for (let i = 0; i < events.length; i += 2) {
    const chunk = events.slice(i, i + 2);
    const results = await Promise.all(
      chunk.map((e) => eventSamples(e, priors).catch(() => ({ samples: [] as Sample[], prior: null })))
    );
    for (const r of results) {
      if (r.samples.length === 0) skipped++;
      samples.push(...r.samples);
      if (r.prior) priorPairs.push(r.prior);
    }
    process.stdout.write(`\r${Math.min(i + 2, events.length)}/${events.length} jogos · ${samples.length} amostras`);
  }
  console.log(`\n\nAmostras: ${samples.length} (jogos sem xG/odds/score coerente: ${skipped})`);
  console.log(`Prior real disponível: ${priorPairs.length} jogos`);

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

  // --- Real prematchFor prior, on the games where it exists ----------------
  // Same split as above, but every candidate is scored on the same subset, so
  // the comparison is apples to apples: does the prior production actually
  // uses beat the odds proxy and persistence?
  if (priorPairs.length === 0) {
    console.log("\nSem prior real: nada a comparar (ver SUPABASE_SERVICE_ROLE_KEY).");
    return;
  }
  const meanAbs = (fn: (p: PriorPair) => number): number =>
    priorPairs.reduce((n, p) => n + Math.abs(fn(p)), 0) / priorPairs.length;
  const corr = (a: (p: PriorPair) => number, b: (p: PriorPair) => number): number => {
    const ma = priorPairs.reduce((n, p) => n + a(p), 0) / priorPairs.length;
    const mb = priorPairs.reduce((n, p) => n + b(p), 0) / priorPairs.length;
    let num = 0;
    let va = 0;
    let vb = 0;
    for (const p of priorPairs) {
      const x = a(p) - ma;
      const y = b(p) - mb;
      num += x * y;
      va += x * x;
      vb += y * y;
    }
    return va > 0 && vb > 0 ? num / Math.sqrt(va * vb) : 0;
  };
  console.log(
    `\nPrior real vs odds (${priorPairs.length} jogos): |Δ| casa ${fmt(meanAbs((p) => p.realHome - p.oddsHome))} · fora ${fmt(
      meanAbs((p) => p.realAway - p.oddsAway)
    )} golos · corr casa ${corr((p) => p.oddsHome, (p) => p.realHome).toFixed(2)} · fora ${corr(
      (p) => p.oddsAway,
      (p) => p.realAway
    ).toFixed(2)}`
  );

  const realTrain = train.filter((s) => s.modelReal !== null);
  const realTest = test.filter((s) => s.modelReal !== null);
  if (realTrain.length === 0 || realTest.length === 0) {
    console.log("Prior real só num dos lados do split: amostra insuficiente para holdout.");
    return;
  }
  const realMethod = (rows: Sample[], fn: (s: Sample) => number) =>
    metrics(rows.map((s) => ({ pred: fn(s), target: s.target })));
  const count = (rows: Sample[]) => new Set(rows.map((s) => s.eventId)).size;
  console.log(
    `\nPrior real — treino ${realTrain.length} amostras / ${count(realTrain)} jogos · teste ${realTest.length} amostras / ${count(
      realTest
    )} jogos (MAE / RMSE):`
  );
  for (const [name, fn] of [
    ["persistência", (s: Sample) => s.persistence],
    ["L15' atual", (s: Sample) => s.current],
    ["modelo odds", (s: Sample) => s.model],
    ["modelo real", (s: Sample) => s.modelReal!],
  ] as const) {
    const tr = realMethod(realTrain, fn);
    const te = realMethod(realTest, fn);
    console.log(
      `  ${name.padEnd(14)} treino ${fmt(tr.mae)} / ${fmt(tr.rmse)} · teste ${fmt(te.mae)} / ${fmt(te.rmse)}  (n=${te.n})`
    );
  }

  let bestRealW = 0;
  let bestReal = Number.POSITIVE_INFINITY;
  for (let w = 0; w <= 1.0001; w += 0.05) {
    const m = realMethod(realTrain, (s) => w * s.modelReal! + (1 - w) * s.persistence);
    if (m.mae < bestReal) {
      bestReal = m.mae;
      bestRealW = Math.round(w * 100) / 100;
    }
  }
  const realBlend = realMethod(realTest, (s) => bestRealW * s.modelReal! + (1 - bestRealW) * s.persistence);
  console.log(
    `  melhor mistura real no treino: ${Math.round(bestRealW * 100)}% modelo + ${Math.round(
      (1 - bestRealW) * 100
    )}% persistência (MAE ${fmt(bestReal)}) · no teste ${fmt(realBlend.mae)} / ${fmt(realBlend.rmse)}`
  );

  console.log("\nPrior real, por minuto (teste, MAE): persistência · L15' atual · modelo odds · modelo real · alvo médio");
  for (const minute of MINUTES) {
    const rows = realTest.filter((s) => s.minute === minute);
    if (rows.length === 0) continue;
    const err = (fn: (s: Sample) => number) => rows.reduce((s, r) => s + Math.abs(fn(r) - r.target), 0) / rows.length;
    const mean = rows.reduce((s, r) => s + r.target, 0) / rows.length;
    console.log(
      `  ${String(minute).padStart(2)}'  ${fmt(err((s) => s.persistence))} · ${fmt(err((s) => s.current))} · ${fmt(
        err((s) => s.model)
      )} · ${fmt(err((s) => s.modelReal!))} · ${fmt(mean)}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
