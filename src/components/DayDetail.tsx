import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import FavoriteButton from "@/components/FavoriteButton";
import { LEAGUES } from "@/lib/footballData";
import { loadMaps, linkLocalName, fetchLiveEntries, seasonUpcomingExtra, seasonRecentLite, tournamentLiveFixtures, tournamentSeasons, type SofaFixture } from "@/lib/sofaHistory";
import { loadSofaLeague } from "@/lib/sofaLeague";
import { fetchSofaLiveNow } from "@/lib/sofaBoard";
import { cacheGetAny, cacheSet, HOUR_MS } from "@/lib/sofaCache";
import { matchTeamIn } from "@/lib/liveMatch";
import { eventOdds } from "@/lib/sofaOdds";
import { findRealOdd } from "@/lib/oddsParse";
import type { PlayedMatch } from "@/lib/footballModel";

// Detailed day view (the "Detalhada" toggle): one dense row per game with
// recent averages (rings), BTTS share, form dots and live 1X2 odds — the
// photo-style board. Same fixture source as the list/matrix (round window +
// tournament upcoming extras), history only for leagues with games that day,
// verdict cached 30 minutes. The odds read per game streams in after the
// render: the table shows up before the dozens of odds reads finish.
interface DetailRow {
  eventId: number | null;
  time: string | null;
  home: string;
  away: string;
  gm: number | null;
  gs: number | null;
  gmC: number | null;
  gsF: number | null;
  btts: number | null;
  formH: { r: "V" | "E" | "D"; date: string; opp: string }[];
  formF: { r: "V" | "E" | "D"; date: string; opp: string }[];
  fragile: boolean;
}

interface DetailLeague {
  code: string;
  label: string;
  rows: DetailRow[];
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

// The 1/X/2 odds of one game as a lazy read per row: the table renders from
// the (cached) day data right away and each cell streams in on its own when
// its single read finishes — no row waits for the dozens of odds reads a
// cold rebuild takes. Suspense fallback and result are both 3 <td>s.
async function GameOddsCells({ supabase, userId, eventId, home, away }: { supabase: SupabaseClient; userId: string; eventId: number; home: string; away: string }) {
  let o1: number | null = null;
  let oX: number | null = null;
  let o2: number | null = null;
  try {
    const parsed = await eventOdds(supabase, userId, eventId, HOUR_MS).catch(() => null);
    if (parsed) {
      const byKey: Record<string, number> = {};
      for (const m of parsed.markets) for (const c of m.choices) byKey[c.key] = c.odd;
      o1 = findRealOdd(byKey, "home", home, away) ?? null;
      oX = findRealOdd(byKey, "draw", home, away) ?? null;
      o2 = findRealOdd(byKey, "away", home, away) ?? null;
    }
  } catch {
    // Scraper offline or unreadable odds: dash like an uncovered game.
  }
  const cls = "px-2 py-2.5 text-center text-xs tabular-nums text-neutral-300";
  return (
    <>
      <td className={cls}>{odd2(o1)}</td>
      <td className={cls}>{odd2(oX)}</td>
      <td className={cls}>{odd2(o2)}</td>
    </>
  );
}

function OddsPending(): ReactNode {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <td key={i} className="px-2 py-2.5 text-center text-xs tabular-nums text-neutral-700">
          ⋯
        </td>
      ))}
    </>
  );
}

const num1 = (v: number): string => v.toFixed(1).replace(".", ",");
const odd2 = (v: number | null): string => (v !== null && v > 1 ? v.toFixed(2).replace(".", ",") : "—");

function Ring({ value, tone, title }: { value: number | null; tone: "green" | "orange"; title: string }) {
  if (value === null) return <span className="text-neutral-700">—</span>;
  const frac = Math.min(1, Math.max(0, value / 4));
  const color = tone === "green" ? "#34d399" : "#fb923c";
  return (
    <span className="inline-flex items-center gap-1" title={title}>
      <svg width="20" height="20" viewBox="0 0 22 22" role="img" aria-label={num1(value)}>
        <circle cx="11" cy="11" r="9" fill="none" stroke="#3f3f46" strokeWidth="2.5" />
        <circle
          cx="11"
          cy="11"
          r="9"
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${(frac * 56.5).toFixed(1)} 56.5`}
          transform="rotate(-90 11 11)"
        />
      </svg>
      <span className="text-xs font-medium tabular-nums text-neutral-200">{num1(value)}</span>
    </span>
  );
}

const FORM_CLS = { V: "bg-emerald-600", E: "bg-neutral-600", D: "bg-red-600" } as const;

// Refrescos em segundo plano em curso (por chave; igual à Matriz): quando a
// página serve a última avaliação e lança o refresco, visitas repetidas à
// mesma tabela não empilham outra passagem por cima.
const recomputing = new Set<string>();
function kickRecompute(key: string, run: () => Promise<void>): void {
  if (recomputing.has(key)) return;
  recomputing.add(key);
  void run()
    .catch(() => {})
    .finally(() => recomputing.delete(key));
}

function Dots({ form, title }: { form: { r: "V" | "E" | "D"; date: string; opp: string }[]; title: string }) {
  if (form.length === 0) return <span className="text-neutral-700">—</span>;
  return (
    <span className="inline-flex gap-0.5" title={title}>
      {form.map((g, i) => {
        const when =
          g && typeof g.date === "string" && g.date.length >= 10
            ? `${g.date.slice(8, 10)}/${g.date.slice(5, 7)} vs ${typeof g.opp === "string" ? g.opp : "?"} (${g.r})`
            : String(g?.r ?? "?");
        return (
          <span
            key={i}
            title={when}
            className={`flex h-4 w-4 cursor-default items-center justify-center rounded text-[9px] font-bold text-white ${FORM_CLS[g?.r ?? "E"]}`}
          >
            {g?.r ?? "?"}
          </span>
        );
      })}
    </span>
  );
}

// The full day evaluation, shared by the page (first view / background
// refresh) and by the Matrix prewarm (prewarmDayDetail below). Writes the
// daydetail:v5 cache on success.
export async function computeDayDetail(
  supabase: SupabaseClient,
  userId: string,
  day: string,
  pais: string,
  ligaSel: string
): Promise<{ table: DetailLeague[]; failed: string[]; staleLeagues: string[]; unlinkedNames: string[] }> {
  const maps = await loadMaps(supabase, userId, "tournament").catch(() => []);
  const codes = new Set(maps.map((m) => m.name_key));
  const countryOf = (label: string): string => label.split("·")[0]?.trim() ?? label;
  const leagues = LEAGUES.filter((l) => {
    if (!codes.has(l.code) || l.code.startsWith("int.")) return false;
    if (ligaSel && l.code !== ligaSel) return false;
    if (pais && countryOf(l.label as string) !== pais) return false;
    return true;
  });
  const labelOf = (code: string): string => leagues.find((l) => l.code === code)?.label ?? code;
  const key = `daydetail:v5:${day}|${pais}|${ligaSel}`;
  const teamMaps = await loadMaps(supabase, userId, "team").catch(() => []);
  const toLocal = new Map(teamMaps.filter((m) => m.local_name).map((m) => [m.name, m.local_name]));
  const convert = (name: string): string => toLocal.get(name) ?? linkLocalName(teamMaps, name) ?? name;
  const failedSet = new Set<string>();
  const staleSet = new Set<string>();
  const unlinkedSet = new Set<string>();
  const found: DetailLeague[] = [];
  // One live read per pass (scraper caches it 60s), shared by all leagues.
  const liveEntries = await fetchLiveEntries().catch(() => []);
  await pool(leagues, 4, async (l) => {
    const map = maps.find((m) => m.name_key === l.code);
    if (!map) return;
    let seasons;
    try {
      seasons = await tournamentSeasons(supabase, userId, map.sofascore_id);
    } catch {
      failedSet.add(l.code);
      return;
    }
    const s = seasons[0];
    if (!s) return;
    // Sonda leve (igual à matriz): próximos + recentes da época cobrem o
    // dia inteiro; ligas sem jogos no dia ficam-se por aqui.
    const upcoming = await seasonUpcomingExtra(supabase, userId, map.sofascore_id, s.id, true, 0).catch(() => null);
    if (upcoming === null) {
      failedSet.add(l.code);
      return;
    }
    const recent = await seasonRecentLite(supabase, userId, map.sofascore_id, s.id, true).catch(() => [] as SofaFixture[]);
    const seenIds = new Set<number>();
    const flat: SofaFixture[] = [];
    for (const f of [...upcoming, ...(recent ?? []), ...tournamentLiveFixtures(liveEntries, map.sofascore_id, 0)]) {
      if (f.date === day && !seenIds.has(f.id)) {
        seenIds.add(f.id);
        flat.push(f);
      }
    }
    const dayFx = flat.filter((f) => f.date === day && !f.ft);
    if (dayFx.length === 0) return;
    let data;
    try {
      const loaded = await loadSofaLeague(supabase, userId, l.code, { history: true, fixtures: false, shots: false });
      data = loaded?.data ?? null;
      if (loaded?.stale) staleSet.add(l.code);
      for (const u of loaded?.unlinked ?? []) unlinkedSet.add(`${labelOf(l.code)}: ${u}`);
    } catch {
      failedSet.add(l.code);
      return;
    }
    if (!data) {
      failedSet.add(l.code);
      return;
    }
    const teamGames = (team: string, venue: "H" | "A" | null): PlayedMatch[] => {
      const seen = new Set<string>();
      return data.matches.filter((m) => {
        if (!((venue !== "A" && m.team1 === team) || (venue !== "H" && m.team2 === team))) return false;
        // Same duplicate guard as the form dots: one entry per
        // date+opponent+venue, so averages never double-count a tie.
        const v = m.team1 === team ? "H" : "A";
        const k = `${m.date}|${m.team1 === team ? m.team2 : m.team1}|${v}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    };
    // Newest first, like every football app: the leftmost dot is the most
    // recent game.
    const last5 = (team: string, venue: "H" | "A" | null): PlayedMatch[] => teamGames(team, venue).slice(-5).reverse();
    const avg = (ms: PlayedMatch[], f: (m: PlayedMatch) => number): number | null =>
      ms.length === 0 ? null : ms.reduce((s, m) => s + f(m), 0) / ms.length;
    const res = (team: string, m: PlayedMatch): { r: "V" | "E" | "D"; date: string; opp: string } => {
      const gf = m.team1 === team ? m.ft[0] : m.ft[1];
      const ga = m.team1 === team ? m.ft[1] : m.ft[0];
      return { r: gf > ga ? "V" : gf < ga ? "D" : "E", date: m.date, opp: m.team1 === team ? m.team2 : m.team1 };
    };
    const rows: DetailRow[] = [];
    const jobs: { f: SofaFixture; home: string; away: string }[] = [];
    const jobsSeen = new Set<string>();
    for (const f of dayFx) {
      const home = convert(f.team1);
      const away = convert(f.team2);
      // Stale spellings (league cache built before the team map landed) keep
      // the row: the tolerant fit sees "Getafe CF" == "Getafe".
      const teamIn = (name: string): boolean => data.teams.includes(name) || matchTeamIn(name, data.teams) !== null;
      if (!teamIn(home) || !teamIn(away)) continue;
      // Same tie under two ids (postponed stale entry) would render twice:
      // one pairing per league per day.
      const pair = `${home}|${away}`;
      if (jobsSeen.has(pair)) continue;
      jobsSeen.add(pair);
      jobs.push({ f, home, away });
    }
    await pool(jobs, 8, async ({ f, home, away }) => {
      const hAll = teamGames(home, null).slice(-5);
      const hHome = teamGames(home, "H").slice(-5);
      const aAll = teamGames(away, null).slice(-5);
      const aAway = teamGames(away, "A").slice(-5);
      const gm = avg(hAll, (m) => (m.team1 === home ? m.ft[0] : m.ft[1]));
      const gs = avg(hAll, (m) => (m.team1 === home ? m.ft[1] : m.ft[0]));
      const gmC = avg(hHome, (m) => m.ft[0]);
      const gsF = avg(aAway, (m) => m.ft[1]);
      const pool10 = [...hAll, ...aAll];
      const btts = pool10.length > 0 ? pool10.filter((m) => m.ft[0] > 0 && m.ft[1] > 0).length / pool10.length : null;
      rows.push({
        eventId: typeof f.id === "number" ? f.id : null,
        time: f.time ?? null,
        home,
        away,
        gm,
        gs,
        gmC,
        gsF,
        btts,
        formH: last5(home, "H").map((m) => res(home, m)),
        formF: last5(away, "A").map((m) => res(away, m)),
        fragile: hAll.length < 5 || aAll.length < 5,
      });
    });
    if (rows.length > 0) {
      rows.sort((a, b) => `${a.time ?? ""}`.localeCompare(`${b.time ?? ""}`) || a.home.localeCompare(b.home));
      found.push({ code: l.code, label: labelOf(l.code), rows });
    }
  });
  const table = found;
  const failed = [...failedSet];
  const staleLeagues = [...staleSet];
  const unlinkedNames = [...unlinkedSet].slice(0, 12);
  if (failed.length === 0) {
    await cacheSet(supabase, userId, key, table).catch(() => {});
  } else {
    // Partial evals cache too — never block a re-entry on retry cycles.
    await cacheSet(supabase, userId, key, { rows: table, failed }).catch(() => {});
  }
  return { table, failed, staleLeagues, unlinkedNames };
}

// Prewarm: the Matrix fires this after evaluating its own table, so the
// user's next click into vista Detalhada finds the table ready — without it
// that first click always waited minutes. Guarded by the same in-flight set
// as the page's own background refresh; a fresh table (≲30 min) skips it.
export function prewarmDayDetail(
  supabase: SupabaseClient,
  userId: string,
  day: string,
  pais: string,
  ligaSel: string
): void {
  const key = `daydetail:v5:${day}|${pais}|${ligaSel}`;
  const run = async (): Promise<void> => {
    const meta = await cacheGetAny(supabase, userId, key).catch(() => null);
    if (meta && Date.now() - meta.fetchedAt < HOUR_MS / 2) return;
    await computeDayDetail(supabase, userId, day, pais, ligaSel);
  };
  if (recomputing.has(key)) return;
  recomputing.add(key);
  void run()
    .catch(() => {})
    .finally(() => recomputing.delete(key));
}

export default async function DayDetail({
  day,
  pais,
  ligaSel,
  equipa,
  diretos,
  refresh,
}: {
  day: string;
  pais: string;
  ligaSel: string;
  equipa: string;
  diretos: boolean;
  refresh: boolean;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <p className="text-sm text-neutral-400">Sem sessão.</p>;

  const maps = await loadMaps(supabase, user.id, "tournament").catch(() => []);
  const codes = new Set(maps.map((m) => m.name_key));
  const { data: favRows } = await supabase.from("favorite_games").select("event_id").eq("user_id", user.id);
  const favIds = new Set((favRows ?? []).map((r) => (r as { event_id?: unknown }).event_id).filter((n): n is number => typeof n === "number"));
  const countryOf = (label: string): string => label.split("·")[0]?.trim() ?? label;
  const leagues = LEAGUES.filter((l) => {
    if (!codes.has(l.code) || l.code.startsWith("int.")) return false;
    if (ligaSel && l.code !== ligaSel) return false;
    if (pais && countryOf(l.label as string) !== pais) return false;
    return true;
  });
  const labelOf = (code: string): string => leagues.find((l) => l.code === code)?.label ?? code;

  const cacheKey = `daydetail:v5:${day}|${pais}|${ligaSel}`;
  const meta = refresh ? null : await cacheGetAny(supabase, user.id, cacheKey).catch(() => null);
  const age = meta ? Date.now() - meta.fetchedAt : Infinity;
  let table: DetailLeague[] = [];
  let failed: string[] = [];
  let staleLeagues: string[] = [];
  let unlinkedNames: string[] = [];
  let shownAge: number | null = null; // idade da última avaliação servida
  let refazendo = false;
  let primeiraAviso: string | null = null;
  const compute = async (): Promise<void> => {
    const res = await computeDayDetail(supabase, user.id, day, pais, ligaSel);
    table = res.table;
    failed = res.failed;
    staleLeagues = res.staleLeagues;
    unlinkedNames = res.unlinkedNames;
  };
  const readPayload = (p: unknown): { rows: DetailLeague[]; partialFailed: string[] } | null => {
    if (Array.isArray(p)) return { rows: p as DetailLeague[], partialFailed: [] };
    if (p !== null && typeof p === "object") {
      const o = p as Record<string, unknown>;
      if (Array.isArray(o.rows)) {
        return { rows: o.rows as DetailLeague[], partialFailed: Array.isArray(o.failed) ? (o.failed as string[]) : [] };
      }
    }
    return null;
  };
  const served = readPayload(meta?.payload);
  if (served) {
    table = served.rows;
    failed = served.partialFailed;
    if (failed.length > 0) {
      shownAge = Math.max(0, Math.round(age / 60_000));
      refazendo = true;
      kickRecompute(cacheKey, compute);
    } else if (age <= HOUR_MS / 2) {
      // cache fresca, avaliação completa
    } else if (age <= 6 * HOUR_MS) {
      // Igual à matriz: servimos já a última avaliação e reavaliamos ao lado —
      // a página deixa de esperar minutos quando o refresco de 30 min expira.
      shownAge = Math.max(0, Math.round(age / 60_000));
      refazendo = true;
      kickRecompute(cacheKey, compute);
    } else {
      // Muito velha (≈6h+): igual à parcial — serve-se e reavalia-se em
      // segundo plano; Jamais o render às espera de minutos.
      shownAge = Math.max(0, Math.round(age / 60_000));
      refazendo = true;
      kickRecompute(cacheKey, compute);
    }
  } else {
    // Primeira avaliação nunca vista — não bloqueia o render (igual à
    // matriz: navegar abortaria_minutes de computação). O recarregar
    // encontra a tabela parcial ou completa em cache.
    primeiraAviso = "A avaliar pela primeira vez neste dia — recarrega em ~1–2 min.";
    kickRecompute(cacheKey, compute);
  }

  const { games: live } = await fetchSofaLiveNow(Date.now()).catch(() => ({ games: [] as { id: number; minute: number | null; phase: string; homeGoals: number | null; awayGoals: number | null }[] }));
  const liveById = new Map(live.map((g) => [g.id, g]));
  const shown = table
    .map((lg) => ({
      ...lg,
      rows: lg.rows
        .map((r) => ({ ...r, lg: r.eventId !== null ? liveById.get(r.eventId) : undefined }))
        .filter(
          (r) =>
            (!equipa || `${r.home} ${r.away}`.toLowerCase().includes(equipa)) &&
            (!diretos || (r.lg !== undefined && (r.lg.phase === "live" || r.lg.phase === "halftime")))
        ),
    }))
    .filter((lg) => lg.rows.length > 0);
  shown.sort((a, b) => a.label.localeCompare(b.label));
  const nRows = shown.reduce((s, lg) => s + lg.rows.length, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-500">
        <span>
          {nRows} jogo{nRows === 1 ? "" : "s"} · GM/GS últimos 5 · GM-C em casa · GS-F fora · BTS nos últimos 10 · Frm-C últimos 5 em casa · Frm-F últimos 5 fora ·{" "}
          <Link
            href={`/estatisticas/jogos-dia?${new URLSearchParams({
              data: day,
              ...(pais ? { pais } : {}),
              ...(ligaSel ? { liga: ligaSel } : {}),
              ...(equipa ? { equipa } : {}),
              ...(diretos ? { diretos: "1" } : {}),
              vista: "detalhada",
              refresh: "1",
            })}`}
            className="text-neutral-400 hover:text-neutral-200 hover:underline"
          >
            atualizar
          </Link>
        </span>
        {shownAge !== null && refazendo && (
          <span className="text-sky-300" title="A última avaliação é de hoje; a nova corre agora em segundo plano">
            Mostrada a última avaliação (há {shownAge} min) — a reavaliar em segundo plano; recarrega daqui a ~1 min.
          </span>
        )}
        {primeiraAviso && <span className="text-sky-300">{primeiraAviso}</span>}
        {failed.length > 0 && <span className="text-amber-300">Sem leitura em {failed.length} ligas — recarrega.</span>}
        {staleLeagues.length > 0 && (
          <span className="text-amber-300" title={staleLeagues.join(", ")}>
            Cache antiga em {staleLeagues.length} liga{staleLeagues.length === 1 ? "" : "s"} (falha técnica): os números podem estar desatualizados — recarrega.
          </span>
        )}
        {unlinkedNames.length > 0 && (
          <span className="text-amber-300" title={unlinkedNames.join(", ")}>
            Grafias por ligar no Mapa: {unlinkedNames.slice(0, 6).join(", ")}
            {unlinkedNames.length > 6 ? ` +${unlinkedNames.length - 6}` : ""} — jogos dessas equipas podem faltar ou sair trocados.
          </span>
        )}
      </div>
      {primeiraAviso ? (
        <div className="max-w-4xl rounded-xl border border-dashed border-emerald-700/40 bg-neutral-900 px-4 py-10 text-center">
          <p className="text-sm font-medium text-neutral-200">{primeiraAviso}</p>
          <p className="mx-auto mt-2 max-w-2xl text-xs leading-relaxed text-neutral-500">
            A avaliação detalhada deste dia corre em segundo plano — a janela Compacta tem dados já no próximo recarregar, e a
            Detalhada entra em seguida.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <p className="max-w-4xl rounded-xl border border-dashed border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
          {diretos ? "Nenhum jogo a decorrer agora nos filtros escolhidos." : "Sem jogos para a detalhada neste dia e filtros."}
        </p>
      ) : (
        shown.map((lg) => (
          <div key={lg.code} className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900">
            <p className="border-b border-neutral-800 bg-neutral-800/40 px-4 py-2 text-sm font-semibold text-neutral-200">
              {lg.label} · {lg.rows.length} {lg.rows.length === 1 ? "jogo" : "jogos"}
            </p>
            <table className="w-full min-w-[64rem] text-sm">
              <thead>
                <tr className="border-b border-neutral-800 text-[10px] uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-2 text-left font-semibold">Hora</th>
                  <th className="px-2 py-2 text-left font-semibold">Liga</th>
                  <th className="px-2 py-2 text-left font-semibold">Jogo</th>
                  <th className="px-2 py-2 text-center font-semibold" title="Golos marcados/jogo, casa, últimos 5">GM</th>
                  <th className="px-2 py-2 text-center font-semibold" title="Golos sofridos/jogo, casa, últimos 5">GS</th>
                  <th className="px-2 py-2 text-center font-semibold" title="Marcados em casa, últimos 5 em casa">GM-C</th>
                  <th className="px-2 py-2 text-center font-semibold" title="Sofridos fora, últimos 5 fora">GS-F</th>
                  <th className="px-2 py-2 text-center font-semibold" title="Ambas marcam nos últimos 10 (5+5)">BTS</th>
                  <th className="px-2 py-2 text-left font-semibold">Frm-C</th>
                  <th className="px-2 py-2 text-left font-semibold">Frm-F</th>
                  <th className="px-2 py-2 text-center font-semibold">1</th>
                  <th className="px-2 py-2 text-center font-semibold">X</th>
                  <th className="px-2 py-2 text-center font-semibold">2</th>
                  <th className="px-2 py-2 text-right font-semibold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60">
                {lg.rows.map((r) => {
                  const gl = r.lg;
                  const isLive = gl !== undefined && (gl.phase === "live" || gl.phase === "halftime");
                  return (
                    <tr key={`${r.eventId ?? "x"}|${r.home}|${r.away}|${r.time ?? ""}`} className={`transition-colors hover:bg-neutral-800/40 ${r.fragile ? "opacity-55" : ""}`}>
                      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                        {isLive && gl !== undefined ? (
                          <span className="font-semibold text-red-400">
                            {gl.phase === "halftime" ? "INT" : `${gl.minute ?? ""}'`}
                          </span>
                        ) : (
                          <span className="text-neutral-500">{r.time ? r.time.slice(0, 5) : "—"}</span>
                        )}
                      </td>
                      <td className="max-w-36 truncate px-2 py-2.5 text-xs text-neutral-500">{lg.label}</td>
                      <td className="min-w-56 px-2 py-2.5">
                        <Link
                          href={`/estatisticas?${new URLSearchParams({ liga: lg.code, casa: r.home, fora: r.away })}`}
                          title="Abrir no Comparar equipas"
                          className="text-neutral-100 transition hover:text-emerald-300"
                        >
                          {r.home} <span className="text-neutral-600">vs</span> {r.away}
                        </Link>{" "}
                        {isLive && gl !== undefined && (
                          <span className="font-semibold tabular-nums text-emerald-300">
                            {gl.homeGoals ?? "?"}–{gl.awayGoals ?? "?"}
                          </span>
                        )}
                        {r.fragile && (
                          <span title="Menos de 5 jogos nos dados" className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                            poucos jogos
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-center"><Ring value={r.gm} tone="green" title="Marcados/jogo, casa, últimos 5" /></td>
                      <td className="px-2 py-2.5 text-center"><Ring value={r.gs} tone="orange" title="Sofridos/jogo, casa, últimos 5" /></td>
                      <td className="px-2 py-2.5 text-center"><Ring value={r.gmC} tone="green" title="Marcados em casa, últimos 5 em casa" /></td>
                      <td className="px-2 py-2.5 text-center"><Ring value={r.gsF} tone="orange" title="Sofridos fora, últimos 5 fora" /></td>
                      <td className="px-2 py-2.5 text-center">
                        {r.btts === null ? (
                          <span className="text-neutral-700">—</span>
                        ) : (
                          <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${r.btts >= 0.6 ? "bg-emerald-500/15 text-emerald-300" : r.btts >= 0.4 ? "bg-amber-500/15 text-amber-300" : "bg-red-500/15 text-red-300"}`}>
                            {Math.round(r.btts * 100)}%
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2.5"><Dots form={r.formH} title="Forma da casa, últimos 5" /></td>
                      <td className="px-2 py-2.5"><Dots form={r.formF} title="Forma do fora, últimos 5" /></td>
                      {r.eventId !== null && r.eventId > 0 ? (
                        <Suspense key={r.eventId} fallback={<OddsPending />}>
                          <GameOddsCells supabase={supabase} userId={user.id} eventId={r.eventId} home={r.home} away={r.away} />
                        </Suspense>
                      ) : (
                        <>
                          {[0, 1, 2].map((i) => (
                            <td key={i} className="px-2 py-2.5 text-center text-xs tabular-nums text-neutral-700">
                              —
                            </td>
                          ))}
                        </>
                      )}
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        {r.eventId !== null && r.eventId > 0 && (
                          <FavoriteButton eventId={r.eventId} home={r.home} away={r.away} tournament={lg.label} initial={favIds.has(r.eventId)} />
                        )}{" "}
                        {r.eventId !== null && (
                          <Link href={`/estatisticas/live?${new URLSearchParams({ sofascore: `id:${r.eventId}` })}`} className="text-xs font-medium text-emerald-400 hover:underline">
                            Analisar →
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}
