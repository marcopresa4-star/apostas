import { requireAdmin } from "@/lib/requireAdmin";
import { createClient } from "@/lib/supabase/server";
import { sofaRaw } from "@/lib/sofaRaw";
import { loadMaps } from "@/lib/sofaHistory";
import { eventOdds } from "@/lib/sofaOdds";
import { oddsKeyFor } from "@/lib/oddsParse";
import { HOUR_MS } from "@/lib/sofaCache";
import { KIND_LABEL, settleWon, type Bet, type BetKind, type BetStatus } from "@/lib/bets";
import BetForm from "./BetForm";
import { BetCard } from "./BetCard";

const KINDS: BetKind[] = ["pre", "watch", "live"];
const KIND_TITLE: Record<BetKind, string> = {
  pre: "⚽ Jogos de hoje (pré)",
  watch: "👀 A vigiar em live",
  live: "🔥 Ativas em live",
};

function toBet(row: Record<string, unknown>): Bet | null {
  if (typeof row.id !== "string") return null;
  const kind = row.kind;
  const status = row.status;
  if (kind !== "pre" && kind !== "watch" && kind !== "live") return null;
  if (status !== "open" && status !== "won" && status !== "lost" && status !== "void") return null;
  if (typeof row.home_team !== "string" || typeof row.away_team !== "string") return null;
  return {
    id: row.id,
    kind,
    status,
    home_team: row.home_team,
    away_team: row.away_team,
    league_label: typeof row.league_label === "string" ? row.league_label : null,
    market_key: typeof row.market_key === "string" ? row.market_key : "",
    market_label: typeof row.market_label === "string" ? row.market_label : "",
    odd: typeof row.odd === "number" ? row.odd : null,
    sofascore_id: typeof row.sofascore_id === "number" ? row.sofascore_id : null,
    kickoff: typeof row.kickoff === "string" ? row.kickoff : null,
    target_odd: typeof row.target_odd === "number" ? row.target_odd : null,
    target_minute: typeof row.target_minute === "number" ? row.target_minute : null,
    settled_auto: row.settled_auto === true,
    close_odd: typeof row.close_odd === "number" ? row.close_odd : null,
    created_at: typeof row.created_at === "string" ? row.created_at : null,
  };
}

// Settles what finished alone, and enriches open bets: analysis link (league
// + local teams from the event's tournament) and the current price for the
// movement readout. One event read per bet; odds ride the shared cache.
async function autoSettle(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  bets: Bet[]
): Promise<Bet[]> {
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const tournaments = await loadMaps(supabase, userId, "tournament").catch(() => []);
  const teams = await loadMaps(supabase, userId, "team").catch(() => []);
  const toLocal = new Map(teams.filter((m) => m.local_name).map((m) => [m.name, m.local_name]));
  let changed = false;
  const closeBackfill: { id: string; close_odd: number }[] = [];
  // Backfills the close only on recent history: old rows without a price stay
  // as they are instead of costing a read every load.
  const recentEnough = (b: Bet): boolean => {
    const d = b.kickoff ?? b.created_at;
    if (!d) return true;
    return Date.now() - Date.parse(d) < 45 * 86_400_000;
  };
  const out = await Promise.all(
    bets.map(async (b) => {
      // Watched games never settle alone: nothing was entered yet.
      if (b.kind === "watch" || !b.sofascore_id) return b;
      const body = await sofaRaw<unknown>(`/event/${b.sofascore_id}`).catch(() => null);
      const root = (body ?? {}) as Record<string, unknown>;
      const event = (root.event ?? root) as Record<string, unknown>;
      const unique = (((event.tournament ?? {}) as Record<string, unknown>).uniqueTournament ?? {}) as Record<
        string,
        unknown
      >;
      const homeSofa = ((event.homeTeam ?? {}) as Record<string, unknown>).name;
      const awaySofa = ((event.awayTeam ?? {}) as Record<string, unknown>).name;
      let analysisHref: string | null = null;
      if (typeof unique.id === "number" && typeof homeSofa === "string" && typeof awaySofa === "string") {
        const code = tournaments.find((m) => m.sofascore_id === unique.id)?.name_key ?? null;
        if (code) {
          const casa = toLocal.get(homeSofa) ?? homeSofa;
          const fora = toLocal.get(awaySofa) ?? awaySofa;
          analysisHref = `/estatisticas?${new URLSearchParams({ liga: code, casa, fora })}`;
        }
      }
      const finished = ((event.status ?? {}) as Record<string, unknown>).type === "finished";
      // Closing price (finished games keep their closing-ish prices, cached):
      // entry vs close tells whether the entry beat the market.
      let closeOdd: number | null = null;
      if (finished) {
        const parsed = await eventOdds(supabase, userId, b.sofascore_id, HOUR_MS).catch(() => null);
        if (parsed) {
          const byKey: Record<string, number> = {};
          for (const m of parsed.markets) for (const c of m.choices) byKey[c.key] = c.odd;
          const key = oddsKeyFor(b.market_key, b.home_team, b.away_team);
          closeOdd = key ? (byKey[key] ?? null) : null;
        }
      }
      if (b.status !== "open") {
        // Old settled rows without a close: backfill once (recent only).
        if (closeOdd !== null && b.close_odd == null && recentEnough(b)) {
          closeBackfill.push({ id: b.id, close_odd: closeOdd });
          return { ...b, analysisHref, close_odd: closeOdd };
        }
        return { ...b, analysisHref };
      }
      let liveOdd: number | null = null;
      if (!finished) {
        const parsed = await eventOdds(supabase, userId, b.sofascore_id, HOUR_MS).catch(() => null);
        if (parsed) {
          const byKey: Record<string, number> = {};
          for (const m of parsed.markets) for (const c of m.choices) byKey[c.key] = c.odd;
          const key = oddsKeyFor(b.market_key, b.home_team, b.away_team);
          liveOdd = key ? (byKey[key] ?? null) : null;
        }
      }
      if (!finished) return { ...b, analysisHref, liveOdd };
      const hs = ((event.homeScore ?? {}) as Record<string, unknown>);
      const as = ((event.awayScore ?? {}) as Record<string, unknown>);
      const hg = num(hs.current);
      const ag = num(as.current);
      if (hg === null || ag === null) return { ...b, analysisHref, liveOdd };
      const ht1 = num(hs.period1);
      const ht2 = num(as.period1);
      let firstScorer: "home" | "away" | "none" | null = hg + ag === 0 ? "none" : null;
      if (b.market_key.startsWith("fts:") && firstScorer === null) {
        const inc = await sofaRaw<unknown>(`/event/${b.sofascore_id}/incidents`).catch(() => null);
        const list = ((inc ?? {}) as Record<string, unknown>).incidents;
        if (Array.isArray(list)) {
          const goals = list.flatMap((item) => {
            const e = (item ?? {}) as Record<string, unknown>;
            const type = String(e.incidentType ?? "").toLowerCase();
            const time = num(e.time);
            if ((!type.includes("goal") && !type.includes("penalt")) || time === null) return [];
            const own = String(e.incidentClass ?? "").toLowerCase().includes("own");
            return [{ time, home: own ? e.isHome !== true : e.isHome === true }];
          });
          goals.sort((a, b2) => a.time - b2.time);
          if (goals.length > 0) firstScorer = goals[0].home ? "home" : "away";
        }
      }
      const result = settleWon(
        b.market_key,
        [hg, ag],
        {
          ht: ht1 !== null && ht2 !== null ? [ht1, ht2] : null,
          firstScorer,
        }
      );
      if (result === null) return { ...b, analysisHref, liveOdd };
      changed = true;
      return {
        ...b,
        status: result as BetStatus,
        settled_auto: true,
        analysisHref,
        liveOdd,
        close_odd: closeOdd ?? b.close_odd,
      };
    })
  );
  if (changed) {
    await Promise.all(
      out
        .filter((b, i) => b.status !== bets[i].status)
        .map((b) =>
          supabase
            .from("bets")
            .update({
              status: b.status,
              settled_auto: true,
              settled_at: new Date().toISOString(),
              ...(b.close_odd != null ? { close_odd: b.close_odd } : {}),
            })
            .eq("id", b.id)
            .eq("user_id", userId)
        )
    );
  }
  if (closeBackfill.length > 0) {
    await Promise.all(
      closeBackfill.map((u) => supabase.from("bets").update({ close_odd: u.close_odd }).eq("id", u.id).eq("user_id", userId))
    );
  }
  return out;
}

export default async function ApostasPage() {
  await requireAdmin();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("bets")
    .select("id, kind, status, home_team, away_team, league_label, market_key, market_label, odd, sofascore_id, kickoff, target_odd, target_minute, settled_auto, close_odd, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  const loaded = ((data ?? []) as Record<string, unknown>[]).flatMap((r) => {
    const b = toBet(r);
    return b ? [b] : [];
  });
  const bets = await autoSettle(supabase, user.id, loaded);
  const open = bets.filter((b) => b.status === "open");
  const settled = bets.filter((b) => b.status !== "open").slice(0, 30);
  const won = settled.filter((b) => b.status === "won").length;
  const lost = settled.filter((b) => b.status === "lost").length;
  const decided = won + lost;
  // Hit rate by market (decided bets only, voids out).
  const byMarket = new Map<string, { won: number; lost: number }>();
  for (const b of bets) {
    if (b.status !== "won" && b.status !== "lost") continue;
    const entry = byMarket.get(b.market_label) ?? { won: 0, lost: 0 };
    if (b.status === "won") entry.won++;
    else entry.lost++;
    byMarket.set(b.market_label, entry);
  }
  const marketRows = [...byMarket.entries()]
    .map(([label, r]) => ({ label, ...r, total: r.won + r.lost }))
    .sort((a, b) => b.total - a.total);
  // Profit in units (1 unit staked, odds only): won pays odd-1, lost costs 1,
  // voids refund. Skips bets without an odd.
  const unitsOf = (b: Bet): number | null => {
    if (b.odd === null || !Number.isFinite(b.odd)) return null;
    if (b.status === "won") return b.odd - 1;
    if (b.status === "lost") return -1;
    return null;
  };
  const familyOf = (key: string): string => {
    if (/^(home|draw|away|1x|x2|12|dnb:)/.test(key)) return "Resultado";
    if (/^(btts|combo:)/.test(key)) return "Ambas marcam";
    if (/^halves:/.test(key)) return "Partes";
    if (/^(over|under|ah|to|tu|htover|htunder|htto|httu):/.test(key)) return "Golos";
    return "Outros";
  };
  const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const monthKeyOf = (b: Bet): { key: string; label: string } | null => {
    const d = b.kickoff ?? b.created_at;
    if (!d) return null;
    const t = new Date(d);
    if (Number.isNaN(t.getTime())) return null;
    const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`;
    return { key, label: `${MONTHS[t.getMonth()]}/${String(t.getFullYear()).slice(2)}` };
  };
  const decidedUnits = bets.flatMap((b) => {
    const u = unitsOf(b);
    return u === null ? [] : [{ bet: b, u }];
  });
  const rollup = (keyFn: (b: Bet) => string | null): { label: string; u: number; n: number }[] => {
    const map = new Map<string, { u: number; n: number }>();
    for (const { bet: b, u } of decidedUnits) {
      const label = keyFn(b) ?? "—";
      const entry = map.get(label) ?? { u: 0, n: 0 };
      entry.u += u;
      entry.n += 1;
      map.set(label, entry);
    }
    return [...map.entries()]
      .map(([label, r]) => ({ label, ...r }))
      .sort((a, b) => b.u - a.u);
  };
  const totalU = decidedUnits.reduce((s, r) => s + r.u, 0);
  const leagueRows = rollup((b) => b.league_label);
  const familyRows = rollup((b) => familyOf(b.market_key));
  const monthRows = (() => {
    const map = new Map<string, { label: string; u: number; n: number }>();
    for (const { bet: b, u } of decidedUnits) {
      const m = monthKeyOf(b);
      if (!m) continue;
      const entry = map.get(m.key) ?? { label: m.label, u: 0, n: 0 };
      entry.u += u;
      entry.n += 1;
      map.set(m.key, entry);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([, r]) => r);
  })();
  // Closing-line value: entry odd vs the close, in settled bets with both.
  const clvRows = bets.flatMap((b) => {
    if ((b.status !== "won" && b.status !== "lost") || b.odd === null || b.close_odd === null || b.close_odd <= 1) return [];
    return [(b.odd - b.close_odd) / b.close_odd];
  });
  const clvBeat = clvRows.filter((v) => v >= 0).length;
  const clvAvg = clvRows.length > 0 ? clvRows.reduce((s, v) => s + v, 0) / clvRows.length : null;
  const fmtU = (u: number): string => `${u >= 0 ? "+" : ""}${u.toFixed(1).replace(".", ",")}u`;

  return (
    <div data-wide>
      <h1 className="mb-1 text-xl font-semibold">🎯 Apostas</h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Pré-jogo, vigiadas para entrar em live e ativas em live. Só odds, sem valores. Com link do SofaScore, o
        resultado confere-se sozinho nos mercados normais; o resto marca-se à mão.
        {decided > 0 && (
          <>
            {" "}
            Fechadas: <span className="font-medium text-emerald-400">{won} ganhas</span> ·{" "}
            <span className="font-medium text-red-400">{lost} perdidas</span> (
            {Math.round((won / decided) * 100)}% de acerto).
          </>
        )}
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {KINDS.map((kind) => (
          <section key={kind} className="min-w-0">
            <h2 className="mb-2 text-sm font-semibold text-neutral-200">{KIND_TITLE[kind]}</h2>
            <div className="space-y-2">
              {open
                .filter((b) => b.kind === kind)
                .map((b) => (
                  <BetCard key={b.id} bet={b} />
                ))}
              {open.every((b) => b.kind !== kind) && (
                <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-center text-xs text-neutral-600">
                  Nada aqui. Adiciona em baixo.
                </p>
              )}
            </div>
            <details className="mt-2 rounded-xl border border-neutral-800 bg-neutral-900/50 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-amber-400 hover:underline">
                + Adicionar ({KIND_LABEL[kind].toLowerCase()})
              </summary>
              <div className="mt-2 pb-1">
                <BetForm kind={kind} />
              </div>
            </details>
          </section>
        ))}
      </div>

      {decidedUnits.length > 0 && (
        <details className="mt-4 max-w-4xl rounded-2xl border border-neutral-800 bg-neutral-900 p-5" open={false}>
          <summary className="cursor-pointer text-sm font-semibold text-neutral-300">
            Desempenho:{" "}
            <span className={totalU >= 0 ? "text-emerald-400" : "text-red-400"}>{fmtU(totalU)}</span>{" "}
            <span className="font-normal text-neutral-500">em {decidedUnits.length}</span>
            {clvAvg !== null && (
              <span className="font-normal text-neutral-500">
                {" "}
                · fecho batido em {clvBeat}/{clvRows.length} ({clvAvg >= 0 ? "+" : ""}
                {Math.round(clvAvg * 100)}% em média)
              </span>
            )}
          </summary>
          {(
            [
              ["Por liga", leagueRows],
              ["Por mercado", familyRows],
              ["Por mês", monthRows],
            ] as const
          ).map(([title, rows]) =>
            rows.length > 0 ? (
              <div key={title} className="mt-3">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{title}</p>
                <div className="flex flex-wrap gap-1.5">
                  {rows.map((r) => (
                    <span
                      key={r.label}
                      title={`${r.n} apostas`}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                        r.u >= 0 ? "bg-emerald-600/15 text-emerald-300" : "bg-red-600/15 text-red-300"
                      }`}
                    >
                      {r.label}: {fmtU(r.u)} ({r.n})
                    </span>
                  ))}
                </div>
              </div>
            ) : null
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
            Unidades com 1 unidade por aposta (ganha paga odd−1, perdida custa 1, anulada devolve). O fecho compara a
            odd de entrada com a do apito final: bater o fecho com frequência é o melhor sinal de skill.
          </p>
        </details>
      )}

      {settled.length > 0 && (
        <details className="mt-6 max-w-4xl rounded-2xl border border-neutral-800 bg-neutral-900 p-5" open={false}>
          <summary className="cursor-pointer text-sm font-semibold text-neutral-300">
            Fechadas ({settled.length})
          </summary>
          {marketRows.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {marketRows.map((r) => (
                <span
                  key={r.label}
                  title={`${r.won} ganhas em ${r.total}`}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                    r.won / r.total >= 0.5 ? "bg-emerald-600/15 text-emerald-300" : "bg-red-600/15 text-red-300"
                  }`}
                >
                  {r.label}: {r.won}/{r.total}
                </span>
              ))}
            </div>
          )}
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            {settled.map((b) => (
              <BetCard key={b.id} bet={b} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
