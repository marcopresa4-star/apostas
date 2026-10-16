// Planeamento Live scan engine (server only): for one pattern table, walk the
// mapped leagues' upcoming games (today + tomorrow) and keep the ones whose
// teams' recent games hit every criterion. Counts are GAME TOTALS in the
// interval (both sides), pooled across the two teams' samples — the number a
// live trader actually waits for.
//
// Reads piggyback the 30-day incident/statistics caches (same as the goal
// timing), so only the first scan of a game is slow. Bounded: leagues go 4 at
// a time, at most MAX_JOGOS fixtures evaluated per scan.
import type { SupabaseClient } from "@supabase/supabase-js";
import { LEAGUES } from "./footballData";
import type { Fixture } from "./footballModel";
import { fixtureEventId, loadSofaLeague } from "./sofaLeague";
import {
  eventCardMinutes,
  eventCorners,
  eventGoalMinutes,
  type StaleTracker,
} from "./sofaHistory";
import {
  countIn,
  evaluateCriterion,
  type CriterionEval,
  type LiveTableDef,
} from "./planeamento";

const MAX_JOGOS = 40;
const LAST_N = 10;

// Finished league games usable as sample, newest first. `team` is the local
// spelling (fixtures are already converted); venue-split keeps only the
// team's own side.
function sampleGames(
  fixtures: Fixture[],
  team: string,
  isHome: boolean,
  today: string,
  sample: LiveTableDef["sample"],
  venueSplit: boolean
): { id: number; team1: string; team2: string }[] {
  const list = fixtures
    .filter(
      (f) =>
        f.ft &&
        f.date < today &&
        (f.team1 === team || f.team2 === team) &&
        (!venueSplit || (isHome ? f.team1 === team : f.team2 === team))
    )
    .sort((a, b) => `${b.date}`.localeCompare(`${a.date}`));
  const wanted = sample === "season" ? list : list.slice(0, LAST_N);
  const out: { id: number; team1: string; team2: string }[] = [];
  const seen = new Set<number>();
  for (const f of wanted) {
    const id = fixtureEventId(f);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, team1: f.team1, team2: f.team2 });
  }
  return out;
}

interface GameData {
  goals: { minute: number }[] | null;
  cards: { minute: number }[] | null;
  corners: { all: [number, number]; first: [number, number]; second: [number, number] } | null;
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface PlaneamentoJogo {
  league: string;
  leagueCode: string;
  home: string;
  away: string;
  date: string;
  time: string | null;
  eventId: number;
  evals: CriterionEval[];
  target: number; // first criterion's threshold, for the "% N+" sub-line
  href: string;
}

export interface ScanOutput {
  jogos: PlaneamentoJogo[];
  semDados: number;
  truncated: boolean;
  stale: boolean;
}

// Game-total count of one sampled game in one interval: orientation-free
// (both sides summed), so SofaScore-vs-local spellings never matter.
function countGame(
  data: GameData,
  metric: "cantos" | "golos" | "amarelos",
  from: number,
  to: number
): number | null {
  if (metric === "golos") {
    if (!data.goals) return null;
    return countIn(
      data.goals.map((g) => g.minute),
      from,
      to
    );
  }
  if (metric === "amarelos") {
    if (!data.cards) return null;
    return countIn(
      data.cards.map((c) => c.minute),
      from,
      to
    );
  }
  if (!data.corners) return null;
  const half = from >= 45 ? data.corners.second : to <= 45 ? data.corners.first : data.corners.all;
  return half[0] + half[1];
}

export async function scanTable(
  supabase: SupabaseClient,
  userId: string,
  table: LiveTableDef,
  leagueCodes: string[],
  today: string,
  tomorrow: string
): Promise<ScanOutput> {
  const tracker: StaleTracker = { stale: false };
  const needGoals = table.criteria.some((c) => c.metric === "golos");
  const needCards = table.criteria.some((c) => c.metric === "amarelos");
  const needCorners = table.criteria.some((c) => c.metric === "cantos");
  let semDados = 0;
  let truncated = false;
  const jogos: (PlaneamentoJogo & { sort: number })[] = [];

  await pool(leagueCodes, 4, async (code) => {
    if (truncated) return;
    // One season is enough: samples and upcoming games both come from the
    // current season's fixtures (older seasons only slow the scan down).
    const loaded = await loadSofaLeague(supabase, userId, code, { history: false, shots: false, seasons: 1 }).catch(
      () => null
    );
    if (!loaded) return;
    const label = LEAGUES.find((l) => l.code === code)?.label ?? code;
    const upcoming = loaded.data.fixtures
      .filter((f) => !f.ft && (f.date === today || f.date === tomorrow))
      .sort((a, b) => `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`));
    for (const f of upcoming) {
      if (jogos.length >= MAX_JOGOS) {
        truncated = true;
        return;
      }
      const eventId = fixtureEventId(f);
      if (eventId === null) {
        semDados++;
        continue;
      }
      const homeSample = sampleGames(loaded.data.fixtures, f.team1, true, today, table.sample, table.venueSplit);
      const awaySample = sampleGames(loaded.data.fixtures, f.team2, false, today, table.sample, table.venueSplit);
      const ids = [...new Set([...homeSample, ...awaySample].map((g) => g.id))];
      const data = new Map<number, GameData>();
      await pool(ids, 8, async (id) => {
        const [goals, cards, corners] = await Promise.all([
          needGoals ? eventGoalMinutes(supabase, userId, id, tracker).catch(() => null) : Promise.resolve(null),
          needCards ? eventCardMinutes(supabase, userId, id, tracker).catch(() => null) : Promise.resolve(null),
          needCorners ? eventCorners(supabase, userId, id, tracker).catch(() => null) : Promise.resolve(null),
        ]);
        data.set(id, { goals, cards, corners });
      });
      const countsOf = (sample: { id: number }[], metric: "cantos" | "golos" | "amarelos", from: number, to: number): number[] => {
        const out: number[] = [];
        for (const g of sample) {
          const d = data.get(g.id);
          if (!d) continue;
          const n = countGame(d, metric, from, to);
          if (n !== null) out.push(n);
        }
        return out;
      };
      const evals = table.criteria.map((c) =>
        evaluateCriterion(
          [...countsOf(homeSample, c.metric, c.from, c.to), ...countsOf(awaySample, c.metric, c.from, c.to)],
          c
        )
      );
      if (evals.some((e) => e.games === 0) || !evals.every((e) => e.pass)) {
        if (evals.some((e) => e.games === 0)) semDados++;
        continue;
      }
      const first = evals[0];
      jogos.push({
        league: label,
        leagueCode: code,
        home: f.team1,
        away: f.team2,
        date: f.date,
        time: f.time ?? null,
        eventId,
        evals,
        target: table.criteria[0].target,
        href: `/estatisticas?${new URLSearchParams({ liga: code, casa: f.team1, fora: f.team2 })}`,
        sort: table.criteria[0].agg === "avg" ? first.avg : first.pct,
      });
    }
  });

  jogos.sort((a, b) => b.sort - a.sort);
  return { jogos, semDados, truncated, stale: tracker.stale };
}
