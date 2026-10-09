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
import { findRealOdd } from "@/lib/oddsParse";
import { predictLive } from "@/lib/liveModel";
import { leagueRates } from "@/lib/footballModel";
import {
  BOT_MARKETS,
  gatesOk,
  pregameOk,
  settleAlert,
  snapMinute,
  statsOk,
  type Bot,
  type StatValues,
} from "@/lib/bots";

const MAX_GAMES = 12;
const MAX_SETTLE = 20;

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
  return out;
}

const ODD_KEY: Record<string, string | null> = {
  mais1: null, // no bookmaker equivalent: the odd condition never applies
  home: "home",
  draw: "draw",
  away: "away",
  over25: "over:2.5",
  btts: "btts:yes",
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

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { data: bots } = await supabase
    .from("bots")
    .select("*")
    .eq("user_id", user.id)
    .eq("enabled", true)
    .order("created_at", { ascending: true })
    .returns<Bot[]>();
  const active = bots ?? [];
  if (active.length === 0) return Response.json({ fired: [], stats: {}, games: 0 });

  // Settle open alerts first (bounded): finished games get their hit.
  const { data: open } = await supabase
    .from("bot_alerts")
    .select("id, bot_id, event_id, hg, ag, market")
    .eq("user_id", user.id)
    .is("hit", null)
    .order("created_at", { ascending: false })
    .limit(MAX_SETTLE);
  await pool(open ?? [], 6, async (a) => {
    try {
      const body = await sofaRaw<unknown>(`/event/${a.event_id}`);
      const event = obj((body as Record<string, unknown> | null)?.event ?? body);
      const finished = String(obj(event?.status)?.type ?? "").toLowerCase() === "finished";
      if (!finished) return;
      const hs = obj(event?.homeScore);
      const as = obj(event?.awayScore);
      const fhg = num(hs?.current) ?? num(hs?.display);
      const fag = num(as?.current) ?? num(as?.display);
      if (fhg === null || fag === null) return;
      await supabase
        .from("bot_alerts")
        .update({ hit: settleAlert(a.market as Bot["market"], a.hg, a.ag, fhg, fag) })
        .eq("id", a.id);
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
  for (const b of active) stats[b.id] = { checked: 0, passing: 0 };

  await pool(games, 4, async (g) => {
    let resolved: Awaited<ReturnType<typeof resolveSofaLink>> | null = null;
    try {
      resolved = await resolveSofaLink(supabase, user.id, `id:${g.id}`);
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
    let snap: { minute: number; phase: "live" | "halftime"; hg: number; ag: number; rh: number; ra: number; yh: number } | null = null;
    try {
      const body = await sofaRaw<unknown>(`/event/${g.id}`);
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
      snap = { minute, phase, hg, ag, rh, ra, yh: yh + ya };
    } catch (err) {
      if (err instanceof ScraperOffline) return; // transient: next minute retries
      return;
    }
    if (!snap) return;

    // Shared per-game reads, once: stats, shots, pre-match expectation, odds.
    // Independent of each other, so they go together (Supabase cache hits
    // resolve without touching the serial scraper).
    const needStats = mine.some((b) => b.stats.some((s) => !["yellows_total", "reds_total", "pressure_recent"].includes(s.k)));
    const needShots = mine.some((b) => b.stats.some((s) => ["shots_total", "shots_home", "shots_away", "pressure_recent"].includes(s.k)));
    const needModel = mine.some((b) => b.min_prob !== null && b.min_prob !== undefined);
    const needOdds = mine.some((b) => b.min_odd !== null && b.min_odd !== undefined);
    const [statRes, shotRes, preRes, oddRes] = await Promise.all([
      needStats
        ? sofaRaw<unknown>(`/event/${g.id}/statistics`).then(
            (b) => ({ ok: true as const, v: parseStats(b) }),
            () => ({ ok: false as const, v: {} as Partial<StatValues> })
          )
        : Promise.resolve(null),
      needShots
        ? sofaRaw<unknown>(`/event/${g.id}/shotmap`).then(
            (b) => ({ ok: true as const, v: parseShots(b) }),
            () => ({ ok: false as const, v: [] as Shot[] })
          )
        : Promise.resolve(null),
      needModel ? prematchFor(supabase, user.id, g.id).then(
        (v) => ({ ok: true as const, v }),
        () => ({ ok: false as const, v: null })
      ) : Promise.resolve(null),
      needOdds
        ? eventOdds(supabase, user.id, g.id, 60_000)
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
      vals.pressure_recent = shots.filter((s) => s.minute > snap.minute - 10 && s.minute <= snap.minute).length;
    }
    vals.yellows_total = snap.yh;
    vals.reds_total = snap.rh + snap.ra;

    const pre = preRes?.v ?? null;
    const byKey = oddRes?.v ?? null;

    for (const b of mine) {
      stats[b.id].checked++;
      if (!gatesOk(b, snap)) continue;
      // Pre-game history filter (all rules required).
      let ok = true;
      if (b.pregame.length > 0) {
        const league = await leagueOf(leagueCode);
        const pool = league?.data ? [...league.data.history, ...league.data.matches] : [];
        for (const rule of b.pregame) {
          const r = rule as { side: "home" | "away" | "either"; metric: "total_over15" | "total_over25" | "btts" | "sh_over05" | "sh_over15"; n: number; pct: number };
          if (!pregameOk(r, pool, casa, fora)) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) continue;
      if (!statsOk(b.mode, b.stats, vals)) continue;
      // Model probability for the alert market (fails closed without a model).
      if (b.min_prob !== null && b.min_prob !== undefined) {
        if (!pre || !pre.fromModel) continue;
        const league = await leagueOf(leagueCode);
        if (!league) continue;
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
              : b.market === "home"
                ? live.fullTime.home
                : b.market === "away"
                  ? live.fullTime.away
                  : b.market === "draw"
                    ? live.fullTime.draw
                    : live.bothScore;
        if (!(prob >= b.min_prob)) continue;
      }
      // Live odd floor (ignored when the feed has no price for the market).
      if (b.min_odd !== null && b.min_odd !== undefined) {
        const key = ODD_KEY[b.market];
        const odd = key && byKey ? findRealOdd(byKey, key, casa, fora) : undefined;
        if (odd !== undefined && !(odd >= b.min_odd)) continue;
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
        if (seen && seen.length > 0) continue;
      }
      const label = BOT_MARKETS.find((m) => m.key === b.market)?.label ?? b.market;
      const text = `ALERTA ${b.name} — ${label} · ${resolved.homeSofa} ${snap.hg}–${snap.ag} ${resolved.awaySofa} · ${snap.minute}'`;
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

  return Response.json({ fired, stats, games: games.length, truncated: live.games.length > MAX_GAMES });
}
