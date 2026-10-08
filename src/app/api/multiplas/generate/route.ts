import { createClient } from "@/lib/supabase/server";
import { LEAGUES, loadLeague } from "@/lib/footballData";
import { loadMaps } from "@/lib/sofaHistory";
import { fixtureEventId, loadSofaLeague } from "@/lib/sofaLeague";
import { eventOdds } from "@/lib/sofaOdds";
import { cacheGet, cacheSet, HOUR_MS } from "@/lib/sofaCache";
import { findRealOdd } from "@/lib/oddsParse";
import { leagueRates, predict } from "@/lib/footballModel";
import { baseRates, candidatesFor, MIN_GAMES, TRUST } from "@/lib/recommendation";
import { loadAutoTune } from "@/lib/autoTune";
import { familyOf, type PricedLeg } from "@/lib/multiplasGen";

// Heavy lift for the Múltiplas generator: fixtures on the chosen days for the
// chosen mapped leagues, model candidates joined to REAL bookmaker odds.
// Same bounds as the Value sweep (60 odds reads, small batches: the local
// scraper answers one at a time). Quarter lines are skipped (half-win
// settlement has no place in an accumulator); full-void legs (DNB, integer
// lines) carry a voidNote. Verdict cached 10 minutes per input set.
const MAX_EVENTS = 60;
const ODD_CONCURRENCY = 8;
const LEAGUE_CONCURRENCY = 4;

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

const isQuarter = (key: string): boolean => /:(?:[+-]?\d+\.(?:25|75))$/.test(key);
const lastSeg = (key: string): string => key.slice(key.lastIndexOf(":") + 1);

interface GenBody {
  days?: unknown;
  leagues?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = user.id;

  let body: GenBody;
  try {
    body = (await request.json()) as GenBody;
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const days = Array.isArray(body.days)
    ? [...new Set(body.days.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort().slice(0, 14)
    : [];
  const wantLeagues = Array.isArray(body.leagues) ? body.leagues.filter((l): l is string => typeof l === "string") : [];
  if (days.length === 0) return Response.json({ error: "no days" }, { status: 400 });

  const maps = await loadMaps(supabase, userId, "tournament").catch(() => []);
  const mapped = new Set(maps.map((m) => m.name_key));
  const leagues = LEAGUES.filter(
    (l) => mapped.has(l.code) && !l.code.startsWith("int.") && (wantLeagues.length === 0 || wantLeagues.includes(l.code))
  ).map((l) => l.code);
  if (leagues.length === 0) return Response.json({ error: "no leagues" }, { status: 400 });

  const cacheKey = `multiplas:${days.join(",")}|${[...leagues].sort().join(",")}`;
  const cached = await cacheGet(supabase, userId, cacheKey, 10 * 60_000).catch(() => null);
  if (cached && typeof cached === "object" && !Array.isArray(cached)) {
    return Response.json(cached, { headers: { "Cache-Control": "private, max-age=60" } });
  }

  const now = new Date();
  const tune = await loadAutoTune(supabase, userId).catch(() => null);
  let fixturesTotal = 0;
  let oddsTotal = 0;
  let truncated = false;
  const legs: PricedLeg[] = [];

  await pool(leagues, LEAGUE_CONCURRENCY, sweepLeague);

  async function sweepLeague(code: string): Promise<void> {
    if (truncated) return;
    const league = LEAGUES.find((l) => l.code === code) ?? null;
    const sofa = await loadSofaLeague(supabase, userId, code, { history: false, shots: false }).catch(() => null);
    const data = sofa?.data ?? (await loadLeague(code, now).catch(() => null));
    if (!data || truncated) return;
    const base = baseRates(data.matches);
    const fhs = leagueRates(data.matches, now).firstHalfShare;
    const upcoming = data.fixtures
      .filter((f) => !f.ft && days.includes(f.date))
      .sort((a, b) => `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`));
    fixturesTotal += upcoming.length;
    const jobs = upcoming.flatMap((f) => {
      const eventId = fixtureEventId(f);
      if (!eventId) return [];
      const prediction = predict(data.matches, f.team1, f.team2, now);
      const games = Math.min(prediction.gamesHome, prediction.gamesAway);
      if (games < MIN_GAMES) return [];
      return [{ f, eventId, prediction, games }];
    });
    await pool(jobs, ODD_CONCURRENCY, async ({ f, eventId, prediction, games }) => {
      if (truncated) return;
      if (oddsTotal >= MAX_EVENTS) {
        truncated = true;
        return;
      }
      oddsTotal++;
      const parsed = await eventOdds(supabase, userId, eventId, HOUR_MS).catch(() => null);
      if (!parsed || truncated) return;
      const byKey: Record<string, number> = {};
      for (const m of parsed.markets) for (const c of m.choices) byKey[c.key] = c.odd;
      const cands = new Map(
        candidatesFor(prediction, base, f.team1, f.team2, fhs, data.matches, tune).map((c) => [c.key, c])
      );
      // Empate não é candidato (nunca se sugere), mas é mercado: mesma
      // conta do pull-back da família resultado (igual ao Value).
      if (!cands.has("draw")) {
        const trust = TRUST.result * (tune?.groups.result?.trustMult ?? 1);
        const p = base.draw + trust * (prediction.fullTime.draw - base.draw);
        cands.set("draw", {
          group: "result",
          key: "draw",
          label: "Empate",
          p,
          base: base.draw,
          won: ([h, a]) => h === a,
        });
      }
      // Resultado ao intervalo, da grelha HT do modelo (mesma fonte das
      // tabelas do Comparar). Só com golos de 1.ª parte nos dados.
      const withHt = data.matches.filter((m) => m.ht !== null && m.ht !== undefined);
      if (withHt.length > 0 && withHt.length >= data.matches.length / 2) {
        const ht = prediction.halfTime;
        const share = (test: (h: number, a: number) => boolean): number =>
          withHt.filter((m) => test(m.ht![0], m.ht![1])).length / withHt.length;
        cands.set("ht:home", {
          group: "result",
          key: "ht:home",
          label: `A vencer ao intervalo: ${f.team1}`,
          p: ht.home,
          base: share((h, a) => h > a),
          won: () => false,
        });
        cands.set("ht:draw", {
          group: "result",
          key: "ht:draw",
          label: "Empate ao intervalo",
          p: ht.draw,
          base: share((h, a) => h === a),
          won: () => false,
        });
        cands.set("ht:away", {
          group: "result",
          key: "ht:away",
          label: `A vencer ao intervalo: ${f.team2}`,
          p: ht.away,
          base: share((h, a) => h < a),
          won: () => false,
        });
      }
      for (const c of cands.values()) {
        if (isQuarter(c.key)) continue;
        const fam = familyOf(c.key);
        if (!fam || !fam.covered) continue;
        if (c.p <= 0) continue;
        const real = findRealOdd(byKey, c.key, f.team1, f.team2);
        if (real === undefined || real <= 1) continue;
        const push = c.push ?? 0;
        const fair = c.p > 0 ? (push > 0 ? (1 - push) / c.p : 1 / c.p) : Infinity;
        if (!Number.isFinite(fair)) continue;
        let voidNote: string | null = null;
        if (c.key.startsWith("dnb:")) voidNote = "Devolve no empate";
        else if (push > 0) voidNote = `Devolve com exatamente ${lastSeg(c.key)}`;
        legs.push({
          eventId,
          date: f.date,
          time: f.time ?? null,
          league: code,
          leagueLabel: league?.label ?? code,
          home: f.team1,
          away: f.team2,
          family: fam.id,
          key: c.key,
          label: c.label,
          p: c.p,
          fair,
          real,
          edge: c.p * real - 1,
          games,
          voidNote,
        });
      }
    });
  }

  const out = { legs, fixturesTotal, oddsTotal, truncated, days };
  await cacheSet(supabase, userId, cacheKey, out).catch(() => {});
  return Response.json(out, { headers: { "Cache-Control": "private, max-age=60" } });
}
