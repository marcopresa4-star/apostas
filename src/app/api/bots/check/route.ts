// One monitoring pass over the enabled bots: live games in, fired alerts
// out. Called by the browser every minute while the Bots page watches (there
// is no always-on worker: with the page closed nothing runs). Bounds everything:
// at most MAX_GAMES live games per run, odds only read when a bot needs them.
import { createClient } from "@/lib/supabase/server";
import { fetchSofaLiveNow } from "@/lib/sofaBoard";
import { sofaRaw, ScraperOffline } from "@/lib/sofaRaw";

const obj = (x: unknown): Record<string, unknown> | null =>
  typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
import { loadSofaLeague } from "@/lib/sofaLeague";
import { loadMaps } from "@/lib/sofaHistory";
import { resolveSofaLink } from "@/lib/sofaLeague";
import { prematchFor } from "@/lib/sofaPrematch";
import { eventOdds } from "@/lib/sofaOdds";
import { findRealOdd, preMatch1x2 } from "@/lib/oddsParse";
import { predictLive } from "@/lib/liveModel";
import { leagueRates } from "@/lib/footballModel";
import {
  BOT_MARKETS,
  BOT_SCORES,
  cmpGteLte,
  goalAvgOk,
  goalRulesOk,
  goalsNeutral,
  oddPregameOk,
  pregameOk,
  scoreOk,
  settleAlert,
  snapMinute,
  statsOk,
  type Bot,
  type PregameAvgStat,
  type StatValues,
} from "@/lib/bots";
import { eventCorners, cachedRead, sofaTeamIdFor, teamEvents } from "@/lib/sofaHistory";

const MAX_GAMES = 12;
const MAX_SETTLE = 20;

// Mean corners a team kept in its last n finished games («Média estatística»).
// Team's last-events read is cached 1 h; per-event statistics 30 days.
async function teamCornerAvg(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  teamId: number,
  stat: PregameAvgStat,
  n: number
): Promise<number | null> {
  const rows = await cachedRead<{ id: number; homeId: number }[]>(
    supabase,
    userId,
    `teamlast:${teamId}`,
    3_600_000,
    async () => {
      const { events } = await teamEvents(teamId, "last", 0);
      return events.flatMap((e): { id: number; homeId: number }[] => {
        const status = e.status as { type?: unknown } | null | undefined;
        if (status?.type !== "finished") return [];
        const id = num(e.id);
        const homeId = num((e.homeTeam as { id?: unknown } | undefined)?.id);
        return id !== null && homeId !== null ? [{ id, homeId }] : [];
      });
    },
    undefined,
    (v: unknown): boolean => Array.isArray(v)
  );  if (!Array.isArray(rows)) return null;
  const side = stat === "corners_total" ? "all" : stat === "corners_fh" ? "first" : "second";
  const vals: number[] = [];
  for (const r of rows) {
    if (vals.length >= n) break;
    const c = await eventCorners(supabase, userId, r.id);
    if (!c) continue;
    vals.push(r.homeId === teamId ? c[side][0] : c[side][1]);
  }
  if (vals.length < 5) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

interface Shot {
  minute: number;
  home: boolean;
}

function parseShots(body: unknown): Shot[] {
  const list = (body as { shotmap?: unknown } | null)?.shotmap;
  if (!Array.isArray(list)) return [];
  return list.flatMap((s) => {
    if (typeof s !== "object" || s === null) return [];
    const shot = s as Record<string, unknown>;
    const minute = typeof shot.time === "number" ? shot.time : null;
    if (minute === null || minute < 0 || minute > 130) return [];
    return [{ minute, home: shot.isHome === true }];
  });
}

// Cumulative ALL-period stats by English name, across every group.
function parseStats(body: unknown): Partial<StatValues> {
  const out: Partial<StatValues> = {};
  const periods = (body as { statistics?: unknown } | null)?.statistics;
  if (!Array.isArray(periods)) return out;
  const all = periods.map((p) => (typeof p === "object" && p !== null ? (p as Record<string, unknown>) : null)).find((p) => p?.period === "ALL") ?? null;
  if (!all) return out;
  const groups = Array.isArray(all.groups) ? (all.groups as unknown[]) : [];
  const items: Record<string, unknown>[] = [];
  for (const g of groups) {
    const gg = typeof g === "object" && g !== null ? (g as Record<string, unknown>) : null;
    const list = gg?.statisticsItems;
    if (Array.isArray(list)) for (const i of list) if (typeof i === "object" && i !== null) items.push(i as Record<string, unknown>);
  }
  const get = (name: string): { home: number; away: number } | null => {
    const row = items.find((i) => i.name === name);
    const h = typeof row?.home === "string" ? Number(String(row.home).replace("%", "")) : typeof row?.home === "number" ? row.home : NaN;
    const a = typeof row?.away === "string" ? Number(String(row.away).replace("%", "")) : typeof row?.away === "number" ? row.away : NaN;
    return Number.isFinite(h) && Number.isFinite(a) ? { home: h, away: a } : null;
  };
  const put = (name: string, set: (v: { home: number; away: number }) => void): void => {
    const v = get(name);
    if (v) set(v);
  };
  put("Total shots", (v) => {
    out.shots_home = v.home;
    out.shots_away = v.away;
    out.shots_total = v.home + v.away;
  });
  put("Shots on target", (v) => {
    out.sot_total = v.home + v.away;
  });
  put("Shots off target", (v) => {
    out.shots_off_total = v.home + v.away;
  });
  put("Blocked shots", (v) => {
    out.shots_blocked_total = v.home + v.away;
  });
  put("Offsides", (v) => {
    out.offsides_total = v.home + v.away;
  });
  put("Corner kicks", (v) => {
    out.corners_home = v.home;
    out.corners_away = v.away;
    out.corners_total = v.home + v.away;
  });
  put("Ball possession", (v) => {
    out.poss_home = v.home;
    out.poss_away = v.away;
  });
  put("Fouls", (v) => {
    out.fouls_total = v.home + v.away;
  });
  put("Goalkeeper saves", (v) => {
    out.saves_total = v.home + v.away;
  });
  put("Big chances", (v) => {
    out.big_total = v.home + v.away;
  });
  return out;
}

const ODD_KEY: Record<string, string | null> = {
  mais1: null, // no bookmaker equivalent: the odd condition never applies
  home: "home",
  draw: "draw",
  away: "away",
  over25: "over:2.5",
  btts: "btts:yes",
  sh_over15: null, // 2nd-half totals have no live price: the odd condition never applies
  fh_over05: null, // 1st-half totals have no live price either: the odd condition never applies
};

// Bounded parallelism: the local scraper answers one read at a time, so
// unbounded Promise.all just queues dozens of chains behind each other.
async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let k = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (k < items.length) {
      const n = k++;
      out[n] = await fn(items[n]);
    }
  });
  await Promise.all(workers);
  return out;
}

interface Fired {
  id: string;
  bot_id: string;
  bot_name: string;
  silent: boolean;
  market: string;
  text: string;
  minute: number;
  home: string;
  away: string;
  hg: number;
  ag: number;
  created_at: string;
}

// One process serves all open tabs, so this module flag serializes their
// per-minute polls (see POST below).
let checkRunning = false;

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  // One run at a time per process: a pass can take minutes when the scraper
  // is loaded, and every open tab polls each minute — without this the runs
  // stack and starve every other scraper read. Losers answer empty instantly.
  if (checkRunning) return Response.json({ fired: [], stats: {}, games: 0, busy: true });
  checkRunning = true;
  try {

  const { data: bots } = await supabase
    .from("bots")
    .select("*")
    .eq("user_id", user.id)
    .eq("enabled", true)
    .order("created_at", { ascending: true })
    .returns<(Bot & { goal_rules?: unknown })[]>();
  // DB column is goal_rules; the Bot type calls it goals.
  const active = (bots ?? []).map((b) => ({ ...b, goals: goalsNeutral(b.goal_rules) }));
  if (active.length === 0) return Response.json({ fired: [], stats: {}, games: 0 });

  // Settle open alerts first (bounded): finished games get their hit.
  const { data: open } = await supabase
    .from("bot_alerts")
    .select("id, bot_id, event_id, hg, ag, minute, market")
    .eq("user_id", user.id)
    .is("hit", null)
    .order("created_at", { ascending: false })
    .limit(MAX_SETTLE);
  await pool(open ?? [], 6, async (a) => {
    try {
      const body = await sofaRaw<unknown>(`/event/${a.event_id}`, {}, { low: true });
      const event = obj((body as Record<string, unknown> | null)?.event ?? body);
      const finished = String(obj(event?.status)?.type ?? "").toLowerCase() === "finished";
      if (!finished) return;
      const hs = obj(event?.homeScore);
      const as = obj(event?.awayScore);
      const fhg = num(hs?.current) ?? num(hs?.display);
      const fag = num(as?.current) ?? num(as?.display);
      if (fhg === null || fag === null) return;
      const hthg = num(hs?.period1);
      const htag = num(as?.period1);
      // A bot scoped to the first half promises a goal BEFORE the break:
      // judge mais1 against HT, not the final score.
      const settleBot = active.find((b) => b.id === a.bot_id);
      const hit = settleAlert(
        a.market as Bot["market"],
        a.hg,
        a.ag,
        fhg,
        fag,
        typeof (a as { minute?: unknown }).minute === "number" ? (a as { minute: number }).minute : null,
        hthg,
        htag,
        settleBot?.period === "first"
      );
      if (hit === null) return;
      await supabase.from("bot_alerts").update({ hit }).eq("id", a.id);
    } catch {
      // Next run.
    }
  });

  let live;
  try {
    live = await fetchSofaLiveNow(Date.now());
  } catch {
    return Response.json({ error: "scraper-offline" }, { status: 503 });
  }
  if (live.offline) return Response.json({ error: "scraper-offline" }, { status: 503 });
  // Watched tournaments first: with dozens of live games worldwide, the 12
  // oldest kickoffs would otherwise all be obscure unmapped games and no
  // watched league would ever be checked. No event reads needed for this —
  // the live list already carries the unique tournament id. Scoped to the
  // union of leagues the enabled bots selected (empty selection = all mapped).
  const wanted = new Set<string>();
  let wantAll = false;
  for (const b of active) {
    if (b.leagues.length === 0) {
      wantAll = true;
      break;
    }
    for (const c of b.leagues) wanted.add(c);
  }
  const tourMaps = await loadMaps(supabase, user.id, "tournament").catch(() => []);
  const wantedIds = new Set(
    tourMaps.filter((m) => m.sofascore_id > 0 && (wantAll || wanted.has(m.name_key))).map((m) => m.sofascore_id)
  );
  const mapped = live.games.filter((g) => g.uniqueId !== null && wantedIds.has(g.uniqueId));
  const games = mapped.slice(0, MAX_GAMES);

  const leagueData = new Map<string, Awaited<ReturnType<typeof loadSofaLeague>>>();
  const leagueOf = async (code: string) => {
    let l = leagueData.get(code);
    if (!l) {
      l = await loadSofaLeague(supabase, user.id, code, { history: false, shots: false }).catch(() => null);
      if (l) leagueData.set(code, l);
    }
    return l ?? null;
  };

  const fired: Fired[] = [];
  const stats: Record<string, { checked: number; passing: number }> = {};
  // Why each game failed each bot (first failing gate): powers the "why not"
  // view. Small by construction (≤ MAX_GAMES per bot).
  interface DiagRow {
    eventId: number;
    home: string;
    away: string;
    minute: number;
    hg: number;
    ag: number;
    fail: string;
  }
  const diag: Record<string, DiagRow[]> = {};
  for (const b of active) {
    stats[b.id] = { checked: 0, passing: 0 };
    diag[b.id] = [];
  }

  await pool(games, 4, async (g) => {
    // One event read per game per run: this same body serves resolve
    // (league/team mapping), the minute/cards snapshot and the pre-match
    // model below. The resolve and prematch calls skip their own reads.
    let read: unknown = null;
    try {
      read = await sofaRaw<unknown>(`/event/${g.id}`, {}, { low: true });
    } catch (err) {
      if (err instanceof ScraperOffline) return; // transient: next minute retries
      return;
    }
    if (!read) return;
    let resolved: Awaited<ReturnType<typeof resolveSofaLink>> | null = null;
    try {
      resolved = await resolveSofaLink(supabase, user.id, `id:${g.id}`, { body: read, low: true });
    } catch {
      return;
    }
    if (!resolved || "error" in resolved || !resolved.leagueCode || !resolved.casa || !resolved.fora) return;
    const leagueCode = resolved.leagueCode;
    const casa = resolved.casa;
    const fora = resolved.fora;
    const mine = active.filter((b) => b.leagues.length === 0 || b.leagues.includes(leagueCode));
    if (mine.length === 0) return;

    // One event read serves score, minute, phase and cards for every bot.
    let snap: {
      minute: number;
      phase: "live" | "halftime";
      hg: number;
      ag: number;
      rh: number;
      ra: number;
      yh: number;
      hth: number | null;
      hta: number | null;
    } | null = null;
    try {
      const body = read;
      const event = obj((body as Record<string, unknown> | null)?.event ?? body) ?? {};
      const st = obj(event.status);
      const phase = String(st?.type ?? "").toLowerCase() === "halftime" || /halftime|break/i.test(String(st?.description ?? "")) ? "halftime" : "live";
      const hs = obj(event.homeScore);
      const as = obj(event.awayScore);
      const hg = num(hs?.current) ?? num(hs?.display) ?? g.homeGoals;
      const ag = num(as?.current) ?? num(as?.display) ?? g.awayGoals;
      const desc = String(st?.description ?? "");
      const minute = snapMinute(desc, phase, g.minute ?? 0);
      if (hg === null || ag === null) return;
      // Cards from incidents (goals carry minute order with them too).
      const inc = obj(body as Record<string, unknown>)?.incidents;
      let yh = 0;
      let ya = 0;
      let rh = 0;
      let ra = 0;
      if (Array.isArray((event as Record<string, unknown>).incidents) || Array.isArray(inc)) {
        const list = (Array.isArray((event as Record<string, unknown>).incidents) ? (event as Record<string, unknown>).incidents : inc) as unknown[];
        for (const item of list) {
          if (typeof item !== "object" || item === null) continue;
          const r = item as Record<string, unknown>;
          const type = String(r.incidentType ?? r.type ?? "").toLowerCase();
          const home = r.isHome === true;
          if (type.includes("red")) home ? rh++ : ra++;
          else if (type.includes("yellow")) home ? yh++ : ya++;
        }
      }
      snap = { minute, phase, hg, ag, rh, ra, yh: yh + ya, hth: num(hs?.period1), hta: num(as?.period1) };
    } catch (err) {
      if (err instanceof ScraperOffline) return; // transient: next minute retries
      return;
    }
    if (!snap) return;

    // Shared per-game reads, once: stats, shots, pre-match expectation, odds.
    // Independent of each other, so they go together (Supabase cache hits
    // resolve without touching the serial scraper).
    const PRESSURE_KEYS = ["pressure_recent", "pressure_recent5", "pressure_recent10", "pressure_recent15"];
    const needStats = mine.some((b) => b.stats.some((s) => !["yellows_total", "reds_total"].includes(s.k)));
    // The shot timeline feeds the moving pressure windows; everything else
    // comes from the statistics packet.
    const needShots = mine.some((b) => b.stats.some((s) => PRESSURE_KEYS.includes(s.k)));
    const needModel = mine.some((b) => b.min_prob !== null && b.min_prob !== undefined);
    const needOdds = mine.some((b) => b.min_odd !== null && b.min_odd !== undefined);
    // The prematch league is the same loader the pregame rules use below:
    // load it once here and hand it to prematchFor instead of a second walk.
    const needLeague = needModel || mine.some((b) => b.pregame.length > 0);
    const [statRes, shotRes, preRes, oddRes] = await Promise.all([
      needStats
        ? sofaRaw<unknown>(`/event/${g.id}/statistics`, {}, { low: true }).then(
            (b) => ({ ok: true as const, v: parseStats(b) }),
            () => ({ ok: false as const, v: {} as Partial<StatValues> })
          )
        : Promise.resolve(null),
      needShots
        ? sofaRaw<unknown>(`/event/${g.id}/shotmap`, {}, { low: true }).then(
            (b) => ({ ok: true as const, v: parseShots(b) }),
            () => ({ ok: false as const, v: [] as Shot[] })
          )
        : Promise.resolve(null),
      needModel ? (async () => {
        const league = needLeague ? await leagueOf(leagueCode) : null;
        return prematchFor(supabase, user.id, g.id, { body: read, league, low: true }).then(
          (v) => ({ ok: true as const, v }),
          () => ({ ok: false as const, v: null })
        );
      })() : Promise.resolve(null),
      needOdds
        ? eventOdds(supabase, user.id, g.id, 60_000, true)
            .catch(() => null)
            .then((parsed) => {
              if (!parsed) return { ok: false as const, v: null as Record<string, number> | null };
              const byKey: Record<string, number> = {};
              for (const m of parsed.markets) for (const c of m.choices) byKey[c.key] = c.odd;
              return { ok: true as const, v: byKey };
            })
        : Promise.resolve(null),
    ]);
    const statVals = statRes?.v ?? null;
    const shots = shotRes?.v ?? null;
    const vals: Partial<StatValues> = { ...(statVals ?? {}) };
    if (shots) {
      vals.shots_home = shots.filter((s) => s.home).length;
      vals.shots_away = shots.filter((s) => !s.home).length;
      vals.shots_total = shots.length;
      vals.pressure_recent5 = shots.filter((s) => s.minute > snap.minute - 5 && s.minute <= snap.minute).length;
      vals.pressure_recent10 = shots.filter((s) => s.minute > snap.minute - 10 && s.minute <= snap.minute).length;
      vals.pressure_recent15 = shots.filter((s) => s.minute > snap.minute - 15 && s.minute <= snap.minute).length;
      // pressure_recent (legacy key) stays the 10-minute window.
      vals.pressure_recent = vals.pressure_recent10;
    }
    vals.yellows_total = snap.yh;
    vals.reds_total = snap.rh + snap.ra;
    // Team goals come from the score itself, no extra fetch.
    vals.goals_home = snap.hg;
    vals.goals_away = snap.ag;
    // «Pressão no jogo todo» = remates + cantos do jogo, como diz a secção.
    if (vals.shots_total !== undefined && vals.corners_total !== undefined) vals.pressure_total = vals.shots_total + vals.corners_total;

    const pre = preRes?.v ?? null;
    const byKey = oddRes?.v ?? null;

    for (const b of mine) {
      stats[b.id].checked++;
      const nope = (fail: string): void => {
        diag[b.id].push({ eventId: g.id, home: resolved.homeSofa, away: resolved.awaySofa, minute: snap.minute, hg: snap.hg, ag: snap.ag, fail });
      };
      if (snap.minute < b.minute_from || snap.minute > b.minute_to) {
        nope(`fora da janela (${b.minute_from}–${b.minute_to}')`);
        continue;
      }
      const periodWant =
        b.period === "first" ? "só 1ª parte" : b.period === "second" ? "só 2ª parte" : b.period === "half" ? "só intervalo" : "";
      const periodOk =
        b.period === "any"
          ? true
          : b.period === "first"
            ? snap.phase === "live" && snap.minute < 45
            : b.period === "second"
              ? snap.phase === "live" && snap.minute >= 45
              : snap.phase === "halftime";
      if (!periodOk) {
        nope(`período (${periodWant})`);
        continue;
      }
      if (!scoreOk(b.score, snap.hg, snap.ag)) {
        nope(`marcador (pede ${BOT_SCORES.find((s) => s.key === b.score)?.label ?? b.score})`);
        continue;
      }
      // Fire-time goal filters: totals, difference, per half (post-interval).
      const gh = goalsNeutral(b.goals);
      const fhTot = snap.hth !== null && snap.hta !== null ? snap.hth + snap.hta : null;
      const shTot = fhTot !== null ? Math.max(0, snap.hg + snap.ag - fhTot) : null;
      if (!goalRulesOk(gh, { total: snap.hg + snap.ag, diff: Math.abs(snap.hg - snap.ag), fh: fhTot, sh: shTot })) {
        nope(fhTot === null && (gh.fh !== "any" || gh.sh !== "any") ? "golos (sem HT ainda)" : "golos (filtros)");
        continue;
      }
      // Pre-game criteria («Antes do jogo»): EVERY rule must pass — hist
      // rules over league history, médias de golos/cantos, odd pré-jogo.
      let ok = true;
      if (b.pregame.length > 0) {
        const league = await leagueOf(leagueCode);
        const pool = league?.data ? [...league.data.history, ...league.data.matches] : [];
        for (const rule of b.pregame) {
          if (rule.kind === "avg") {
            // Goals read straight from history; corners come from the teams'
            // last finished events (statistics endpoint, cached 30 days).
            if (rule.metric.startsWith("corners")) {
              const teamNames = rule.side === "home" ? [casa] : rule.side === "away" ? [fora] : [casa, fora];
              for (const name of teamNames) {
                const teamId = await sofaTeamIdFor(supabase, user.id, name);
                if (teamId === null) {
                  ok = false;
                  break;
                }
                const avg = await teamCornerAvg(supabase, user.id, teamId, rule.metric, rule.n);
                if (avg === null || !cmpGteLte(rule.cmp, rule.v, avg)) {
                  ok = false;
                  break;
                }
              }
            } else if (!goalAvgOk(rule, pool, casa, fora)) ok = false;
          } else if (rule.kind === "odd") {
            // Pre-match 1X2: from the same odds packet the live odd check uses;
            // without pre-match prices the game sits out, como diz o form.
            let pre: { home: number; away: number } | null = null;
            try {
              pre = preMatch1x2(await eventOdds(supabase, user.id, g.id, 60_000));
            } catch {
              pre = null;
            }
            if (!oddPregameOk(rule, pre, snap.hg, snap.ag)) ok = false;
          } else if (!pregameOk(rule, pool, casa, fora)) {
            ok = false;
          }
          if (!ok) break;
        }
      }
      if (!ok) {
        nope("pré-jogo");
        continue;
      }
      if (!statsOk(b.mode, b.stats, vals)) {
        nope("estatísticas");
        continue;
      }
      // Model probability for the alert market (fails closed without a model).
      if (b.min_prob !== null && b.min_prob !== undefined) {
        if (!pre || !pre.fromModel) {
          nope("sem modelo");
          continue;
        }
        const league = await leagueOf(leagueCode);
        if (!league) {
          nope("sem modelo");
          continue;
        }
        const live = predictLive({
          lambdaHome: pre.home,
          lambdaAway: pre.away,
          firstHalfShare: leagueRates(league.data.matches, new Date()).firstHalfShare,
          minute: snap.minute,
          homeGoals: snap.hg,
          awayGoals: snap.ag,
          redsHome: snap.rh,
          redsAway: snap.ra,
        });
        const prob =
          b.market === "mais1"
            ? 1 - live.nextGoal.none
            : b.market === "over25"
              ? (live.over["2.5"] ?? 0)
              : b.market === "sh_over15"
                ? live.secondHalf.over15
                : b.market === "fh_over05"
                  ? live.halfTime.over05
                : b.market === "home"
                ? live.fullTime.home
                : b.market === "away"
                  ? live.fullTime.away
                  : b.market === "draw"
                    ? live.fullTime.draw
                    : live.bothScore;
        if (!(prob >= b.min_prob)) {
          nope("probabilidade do modelo");
          continue;
        }
      }
      // Live odd floor (ignored when the feed has no price for the market).
      if (b.min_odd !== null && b.min_odd !== undefined) {
        const key = ODD_KEY[b.market];
        const odd = key && byKey ? findRealOdd(byKey, key, casa, fora) : undefined;
        if (odd !== undefined && !(odd >= b.min_odd)) {
          nope(`odd ${odd} abaixo da mínima ${b.min_odd}`);
          continue;
        }
      }
      stats[b.id].passing++;
      // Dedupe: same game already fired (unless re-fire allows a new minute).
      if (!b.refire) {
        const { data: seen } = await supabase
          .from("bot_alerts")
          .select("id")
          .eq("bot_id", b.id)
          .eq("event_id", g.id)
          .limit(1);
        if (seen && seen.length > 0) {
          nope("já disparou neste jogo");
          continue;
        }
      }
      const label = BOT_MARKETS.find((m) => m.key === b.market)?.label ?? b.market;
      const text = `ALERTA ${b.name} — ${label} · ${resolved.homeSofa} ${snap.hg}–${snap.ag} ${resolved.awaySofa} · ${snap.minute}'`;
      diag[b.id].push({ eventId: g.id, home: resolved.homeSofa, away: resolved.awaySofa, minute: snap.minute, hg: snap.hg, ag: snap.ag, fail: "" });
      const { data: ins, error } = await supabase
        .from("bot_alerts")
        .insert({
          user_id: user.id,
          bot_id: b.id,
          event_id: g.id,
          minute: snap.minute,
          home: resolved.homeSofa,
          away: resolved.awaySofa,
          hg: snap.hg,
          ag: snap.ag,
          market: b.market,
          text,
        })
        .select("id, created_at")
        .single();
      if (error || !ins) continue;
      fired.push({
        id: (ins as { id: string }).id,
        bot_id: b.id,
        bot_name: b.name,
        silent: b.silent,
        market: b.market,
        text,
        minute: snap.minute,
        home: resolved.homeSofa,
        away: resolved.awaySofa,
        hg: snap.hg,
        ag: snap.ag,
        created_at: (ins as { created_at: string }).created_at,
      });
    }
  });

  return Response.json({ fired, stats, diag, games: games.length, truncated: live.games.length > MAX_GAMES });
  } finally {
    checkRunning = false;
  }
}
