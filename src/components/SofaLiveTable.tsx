"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { SofaLiveEntry } from "@/lib/sofascore";
import { addWatchedMatch } from "@/app/(app)/actions";
import PinnedLiveStats from "./PinnedLiveStats";
import PinnedMiniTable from "./PinnedMiniTable";
import PinnedLineups from "./PinnedLineups";
import { moveKey, sortByOrder, type Move } from "@/lib/widgetOrder";

const num1 = (n: number) => n.toFixed(1).replace(".", ",");

export interface BoardRing {
  gm: number | null;
  gs: number | null;
  // Venue split: scored at home (casa) or conceded away (fora).
  venue: number | null;
  btts: number | null;
}

export interface SofaBoardRings {
  home: BoardRing;
  away: BoardRing;
}

export interface SofaBoardDetail {
  // Half-time score, straight from the live list rows (period1) — no extra
  // read per game anymore.
  ht: [number, number] | null;
  // Live 1X2, when the feed prices the game.
  odds?: { home: number; draw: number; away: number };
}

// Legacy shape (kept for the caller): per-side over/under summaries.
export interface SofaBoardStats {
  home: { gfPerGame: number; gaPerGame: number } | null;
  away: { gfPerGame: number; gaPerGame: number } | null;
  leagueLabel: string;
}

const CHIP = { V: "bg-emerald-600", E: "bg-neutral-600", D: "bg-red-600" } as const;

function Form({ form }: { form: ("V" | "E" | "D")[] }) {
  if (form.length === 0) return <span className="text-neutral-600">—</span>;
  return (
    <span className="flex gap-0.5">
      {form.map((r, i) => (
        <span key={i} className={`flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold text-white ${CHIP[r]}`}>
          {r}
        </span>
      ))}
    </span>
  );
}

// No trustworthy minute for this row (list rows carry no incidents and their
// period clock can be missing): show the period instead of a fake number.
function PeriodLabel({ g }: { g: SofaLiveEntry }) {
  if (g.minute !== null) {
    return (
      <span className="flex items-center gap-1.5 font-semibold text-red-400">
        <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
        {g.minute}&apos;
      </span>
    );
  }
  const d = g.statusDescription.toLowerCase();
  const label = /1st/.test(d)
    ? "1.ª parte"
    : /2nd/.test(d)
      ? "2.ª parte"
      : /started/.test(d)
        ? "A começar"
        : /extra/.test(d)
          ? "Prolong."
          : /half.?time|interval/.test(d)
            ? "Intervalo"
            : g.statusDescription || "Em direto";
  return <span className="font-semibold text-red-400">{label}</span>;
}

// Average ring (mockup style): value inside, arc proportional (scale 0–3 goals).
function Ring({ value, tone }: { value: number | null; tone: "green" | "orange" }) {
  if (value === null) return <span className="text-neutral-700">—</span>;
  const frac = Math.min(1, Math.max(0, value / 3));
  const color = tone === "green" ? "#34d399" : "#fb923c";
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="22" height="22" viewBox="0 0 22 22" role="img" aria-label={num1(value)}>
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
      <span className="text-xs font-medium text-neutral-200">{num1(value)}</span>
    </span>
  );
}

function Btts({ value }: { value: number | null }) {
  if (value === null) return <span className="text-neutral-700">—</span>;
  const cls = value >= 0.6 ? "bg-emerald-500/15 text-emerald-300" : value >= 0.4 ? "bg-amber-500/15 text-amber-300" : "bg-red-500/15 text-red-300";
  return <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${cls}`}>{Math.round(value * 100)}%</span>;
}

// The live board grouped by league, like a fixtures board: one header row
// per competition, then its games in kickoff order. "Analisar" opens the live
// calculator with ?sofascore=id:. Leagues can be favorited (★) and filtered
// to; games can be pinned (📌) to the top. Both persist in this browser.
const FAV_LEAGUES_KEY = "apostas:favLeagues";
const PINNED_GAMES_KEY = "apostas:pinnedGames";
const PINNED_COLS_KEY = "apostas:pinnedCols";
// Manual order of the pinned cards (ids): new pins append at the end.
const PINNED_ORDER_KEY = "apostas:pinnedOrder";

// Pinned-card header with its own 30s score/minute poll (light read): the
// board refreshes every 60s, so without this the score lags the bars, which
// poll on their own. Falls back to the board values between polls.
function PinnedHead({ g, ht }: { g: SofaLiveEntry; ht?: [number, number] | null }) {
  const [live, setLive] = useState<{ minute: number | null; phase: string; hg: number | null; ag: number | null } | null>(null);
  // Baseline score: only increases after the first reading toast.
  const prevScore = useRef<{ hg: number; ag: number } | null>(null);
  useEffect(() => {
    prevScore.current = null;
  }, [g.id]);
  useEffect(() => {
    let stop = false;
    const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const poll = async (): Promise<void> => {
      try {
        // No `cache: no-store` here: the route answers max-age=30, shared by
        // every tab and card instead of one fresh scraper read each.
        const res = await fetch(`/api/sofascore/event?id=${g.id}&light=1`);
        if (!res.ok || stop) return;
        const body = (await res.json()) as {
          state?: { minute?: unknown; phase?: unknown; homeGoals?: unknown; awayGoals?: unknown };
        };
        const st = body?.state;
        if (!st || stop) return;
        const hg = num(st.homeGoals);
        const ag = num(st.awayGoals);
        setLive({
          minute: num(st.minute),
          phase: typeof st.phase === "string" ? st.phase : g.phase,
          hg,
          ag,
        });
        // Goal since the last reading: toast it in the corner (global). A step
        // back (1-0 -> 0-0: disallowed goal) toasts a correction instead —
        // the board already corrects itself, this explains why. Both sticky.
        const prev = prevScore.current;
        if (prev && hg !== null && ag !== null) {
          const scored = hg > prev.hg || ag > prev.ag;
          const chalkedOff = !scored && (hg < prev.hg || ag < prev.ag);
          const scorer = hg > prev.hg ? g.home : ag > prev.ag ? g.away : null;
          try {
            if (scored) {
              window.dispatchEvent(
                new CustomEvent("apostas:bot-alert", {
                  detail: {
                    id: `goal-${g.id}-${hg}-${ag}`,
                    bot_name: "Golo",
                    text: `⚽ Golo ${scorer ? `${scorer}! ` : ""}${g.home} ${hg}–${ag} ${g.away}`,
                    sticky: true,
                  },
                })
              );
            } else if (chalkedOff) {
              window.dispatchEvent(
                new CustomEvent("apostas:bot-alert", {
                  detail: {
                    id: `anulado-${g.id}-${hg}-${ag}`,
                    bot_name: "Golo anulado",
                    text: `⚠️ Golo anulado: estava ${g.home} ${prev.hg}–${prev.ag} ${g.away}, agora ${hg}–${ag}`,
                    sticky: true,
                  },
                })
              );
            }
          } catch {
            // No listeners: nothing to show it on.
          }
        }
        if (hg !== null && ag !== null) prevScore.current = { hg, ag };
      } catch {
        // Next round retries; board values stand in.
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 30_000);
    const onVisible = (): void => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [g.id, g.phase]);
  const minute = live?.minute ?? g.minute;
  const phase = live?.phase ?? g.phase;
  const hg = live?.hg ?? g.homeGoals;
  const ag = live?.ag ?? g.awayGoals;
  return (
    <>
      <div className="mb-2">
        {phase === "halftime" ? (
          <span className="text-xs font-semibold text-emerald-400">● Intervalo</span>
        ) : minute !== null ? (
          <span className="text-xs font-semibold text-red-400">● {minute}&apos; AO VIVO</span>
        ) : (
          <PeriodLabel g={g} />
        )}
      </div>
      <div className="mb-3 flex items-baseline gap-x-2">
        <span className="min-w-0 flex-1 truncate text-sm text-neutral-200">{g.home}</span>
        <span className="shrink-0 text-2xl font-bold tabular-nums text-emerald-400">
          {hg ?? "?"}–{ag ?? "?"}
        </span>
        {ht && <span className="shrink-0 text-xs tabular-nums text-neutral-500">({ht[0]}–{ht[1]})</span>}
        <span className="min-w-0 flex-1 truncate text-right text-sm text-neutral-200">{g.away}</span>
      </div>
    </>
  );
}
function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export default function SofaLiveTable({
  games,
  stats,
  form,
  rings,
  detail,
  autoPinned = [],
}: {
  games: SofaLiveEntry[];
  stats: Record<number, SofaBoardStats>;
  form: Record<number, { home: ("V" | "E" | "D")[]; away: ("V" | "E" | "D")[] }>;
  rings: Record<number, SofaBoardRings>;
  detail: Record<number, SofaBoardDetail>;
  // Games followed in Em direto that are live now: pinned automatically
  // (no localStorage). Manual pins still work on top.
  autoPinned?: number[];
}) {
  const router = useRouter();
  const [auto, setAuto] = useState(true);
  const [query, setQuery] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [compact, setCompact] = useState(false);
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  // Browser-only preferences hydrate after mount: reading them in the
  // initializer would disagree with the server and break hydration.
  const [favLeagues, setFavLeagues] = useState<Set<string>>(new Set());
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [expandedTable, setExpandedTable] = useState<Set<number>>(new Set());
  const [expandedLineups, setExpandedLineups] = useState<Set<number>>(new Set());
  const [pinnedCols, setPinnedCols] = useState<1 | 2 | 3>(3);
  const [pinOrder, setPinOrder] = useState<string[]>([]);
  // Live 1X2 loads client-side, in one batched request after the table has
  // rendered: the server render stands without odds, so a busy scraper never
  // holds the board. Each server cycle re-renders rows (fresh `games`),
  // refetching the users' visible prices; sense-check throttling 15s guards
  // double mounts.
  const [liveOdds, setLiveOdds] = useState<Record<number, { home: number; draw: number; away: number }>>({});
  const lastOddsAt = useRef(0);
  useEffect(() => {
    const ids = games
      .filter((g) => stats[g.id])
      .map((g) => g.id)
      .slice(0, 40);
    if (ids.length === 0 || Date.now() - lastOddsAt.current < 15_000) return;
    lastOddsAt.current = Date.now();
    let alive = true;
    fetch(`/api/sofascore/live-odds?ids=${ids.join(",")}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { odds?: Record<string, [number, number, number] | null> } | null) => {
        if (!alive || !data?.odds) return;
        const next: Record<number, { home: number; draw: number; away: number }> = {};
        for (const [k, v] of Object.entries(data.odds)) {
          if (v) next[Number(k)] = { home: v[0], draw: v[1], away: v[2] };
        }
        setLiveOdds((prev) => ({ ...prev, ...next }));
      })
      .catch(() => {
        // Gimmicky column: a failed batch leaves "—" where the price would be.
      });
    return () => {
      alive = false;
    };
  }, [games, stats]);
  // Server detail (interval) merged with the client-fetched odds: the two
  // render spots below read this one map.
  const fullDetail = useMemo<Record<number, SofaBoardDetail>>(() => {
    const out: Record<number, SofaBoardDetail> = {};
    for (const [k, v] of Object.entries(detail)) out[Number(k)] = v;
    for (const [k, o] of Object.entries(liveOdds)) {
      const id = Number(k);
      out[id] = { ht: out[id]?.ht ?? null, odds: o };
    }
    return out;
  }, [detail, liveOdds]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PINNED_ORDER_KEY);
      const list: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(list)) setPinOrder(list.filter((x): x is string => typeof x === "string"));
    } catch {
      // Private mode: default order.
    }
  }, []);
  useEffect(() => {
    try {
      const v = Number(window.localStorage.getItem("apostas:pinnedCols"));
      if (v === 1 || v === 2 || v === 3) setPinnedCols(v);
    } catch {
      // Private mode: default stands.
    }
  }, []);
  const setCols = (n: 1 | 2 | 3): void => {
    setPinnedCols(n);
    try {
      window.localStorage.setItem("apostas:pinnedCols", String(n));
    } catch {
      // Private mode: just this session.
    }
  };
  useEffect(() => {
    setFavLeagues(loadSet(FAV_LEAGUES_KEY));
    setPinned(loadSet(PINNED_GAMES_KEY));
  }, []);
  // Refresh from the server every minute, even in background tabs (the
  // browser throttles hidden tabs to ~1/min anyway, which is our cadence):
  // pinned games must not go stale just because the tab lost focus. Filters
  // and pins survive because they live in client state.
  useEffect(() => {
    if (!auto) return;
    const tick = (): void => {
      router.refresh();
    };
    const t = setInterval(tick, 60_000);
    const onVisible = (): void => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [auto, router]);

  const leagueOf = (g: SofaLiveEntry): string => stats[g.id]?.leagueLabel ?? g.competition;

  const toggleFavLeague = (league: string) => {
    setFavLeagues((prev) => {
      const next = new Set(prev);
      if (next.has(league)) next.delete(league);
      else next.add(league);
      try {
        localStorage.setItem(FAV_LEAGUES_KEY, JSON.stringify([...next]));
      } catch {
        // Private mode: favorites just don't persist.
      }
      return next;
    });
  };

  const togglePin = (game: SofaLiveEntry) => {
    const key = String(game.id);
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(PINNED_GAMES_KEY, JSON.stringify([...next]));
      } catch {
        // Private mode: pins just don't persist.
      }
      return next;
    });
    // Pinning stays local to Ao vivo agora: Jogos gets games only through the
    // explicit "+ Jogos" button below (or by hand on the Jogos page).
  };

  const q = query.trim().toLowerCase();
  const visible = games.filter((g) => {
    if (favOnly && !favLeagues.has(leagueOf(g))) return false;
    if (!q) return true;
    return (
      leagueOf(g).toLowerCase().includes(q) ||
      g.home.toLowerCase().includes(q) ||
      g.away.toLowerCase().includes(q)
    );
  });
  // Pinned games form one flat block on top (no league headers: the same
  // league would otherwise headline twice); the rest groups by league.
  // Auto-pins (followed games gone live) join the manual pins.
  const byKickoff = [...visible].sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const autoSet = useMemo(() => new Set(autoPinned.map(String)), [autoPinned]);
  const isPinned = (g: SofaLiveEntry): boolean => pinned.has(String(g.id)) || autoSet.has(String(g.id));
  const pinnedRows = byKickoff.filter((g) => isPinned(g));
  const restRows = byKickoff.filter((g) => !isPinned(g));
  // Manual order for the pinned block (ids not yet ordered go last, by
  // kickoff): ‹ › on each card, remembered in this browser.
  const pinnedKeys = sortByOrder(
    pinnedRows.map((g) => String(g.id)),
    pinOrder
  );
  const orderedPinned = pinnedKeys.flatMap((k) => pinnedRows.filter((g) => String(g.id) === k));
  const movePin = (id: number, to: Move): void => {
    const next = moveKey(pinnedKeys, String(id), to);
    if (!next) return;
    setPinOrder(next);
    try {
      window.localStorage.setItem(PINNED_ORDER_KEY, JSON.stringify(next));
    } catch {
      // Private mode: order just doesn't persist.
    }
  };
  // Stats start open on every pinned game (manual + auto): newly pinned ids
  // join the set, minimized ones are never re-added.
  const pinnedKey = pinnedRows.map((g) => g.id).join(",");
  useEffect(() => {
    if (!pinnedKey) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of pinnedKey.split(",").map(Number)) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [pinnedKey]);
  // Groups in order of appearance.
  const groups = useMemo(() => {
    const out: { league: string; games: SofaLiveEntry[] }[] = [];
    for (const g of restRows) {
      const league = leagueOf(g);
      const last = out[out.length - 1];
      if (last && last.league === league) last.games.push(g);
      else out.push({ league, games: [g] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return out;
  }, [games, stats, query, favOnly, pinned]);

  // One game row, shared by the pinned block and the league groups.
  const gameRow = (g: SofaLiveEntry) => {
    const r = rings[g.id];
    const d = fullDetail[g.id];
    const f = form[g.id];
    const href = `/estatisticas/live?${new URLSearchParams({ sofascore: `id:${g.id}` })}`;
    const isPinned = pinned.has(String(g.id));
    return (
      <tr key={g.id} className={`transition-colors hover:bg-neutral-800/40 ${isPinned ? "bg-emerald-500/[0.04]" : ""}`}>
        <td className="py-3 pr-0 pl-4">
          <button
            type="button"
            onClick={() => togglePin(g)}
            title={isPinned ? "Desafixar do topo" : "Afixar no topo"}
            className={`text-sm transition ${isPinned ? "text-emerald-400" : "text-neutral-700 hover:text-neutral-400"}`}
          >
            📌
          </button>
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          {g.phase === "halftime" ? (
            <span className="font-semibold text-emerald-400">Intervalo</span>
          ) : (
            <PeriodLabel g={g} />
          )}
        </td>
        <td className="min-w-56 px-4 py-3">
          <span className="block text-neutral-100">
            {g.home} <span className="text-neutral-600">vs</span> {g.away}
          </span>
        </td>
        <td className="px-4 py-3 text-center text-base font-semibold whitespace-nowrap text-neutral-100">
          {g.homeGoals ?? "?"}–{g.awayGoals ?? "?"}
          {d?.ht && <span className="ml-1.5 text-[11px] font-normal text-neutral-500">({d.ht[0]}–{d.ht[1]})</span>}
        </td>
        {!compact && (
          <>
            <td className="px-3 py-3 text-center">
              <Ring value={r?.home.gm ?? null} tone="green" />
            </td>
            <td className="px-3 py-3 text-center">
              <Ring value={r?.home.gs ?? null} tone="orange" />
            </td>
            <td className="px-3 py-3 text-center">
              <Ring value={r?.home.venue ?? null} tone="green" />
            </td>
            <td className="px-3 py-3 text-center">
              <Ring value={r?.away.venue ?? null} tone="orange" />
            </td>
            <td className="px-3 py-3 text-center">
              <Btts value={r ? Math.max(r.home.btts ?? -1, r.away.btts ?? -1) : null} />
            </td>
            <td className="px-3 py-3">{f ? <Form form={f.home} /> : <span className="text-neutral-700">—</span>}</td>
            <td className="px-3 py-3">{f ? <Form form={f.away} /> : <span className="text-neutral-700">—</span>}</td>
            <td className="px-3 py-3 text-center text-xs tabular-nums text-neutral-300">
              {d?.odds ? d.odds.home.toFixed(2).replace(".", ",") : "—"}
            </td>
            <td className="px-3 py-3 text-center text-xs tabular-nums text-neutral-300">
              {d?.odds ? d.odds.draw.toFixed(2).replace(".", ",") : "—"}
            </td>
            <td className="px-3 py-3 text-center text-xs tabular-nums text-neutral-300">
              {d?.odds ? d.odds.away.toFixed(2).replace(".", ",") : "—"}
            </td>
          </>
        )}
        <td className="px-4 py-3 text-right whitespace-nowrap">
          {added.has(g.id) ? (
            <Link href="/" title="Ver nos Jogos" className="text-xs font-medium text-emerald-400 hover:underline">
              ✓ Nos Jogos
            </Link>
          ) : (
            <button
              type="button"
              disabled={pendingId === g.id}
              onClick={() => {
                setPendingId(g.id);
                startTransition(async () => {
                  try {
                    await addWatchedMatch(g.home, g.away, null, null, `id:${g.id}`);
                    setAdded((prev) => new Set(prev).add(g.id));
                  } finally {
                    setPendingId(null);
                  }
                });
              }}
              title="Passar para os Jogos"
              className="mr-2 text-xs font-medium text-sky-400 hover:underline disabled:opacity-50"
            >
              {pendingId === g.id ? "…" : "+ Jogos"}
            </button>
          )}
          <Link href={href} className="text-xs font-medium text-emerald-400 hover:underline">
            Analisar →
          </Link>
        </td>
      </tr>
    );
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtrar por liga ou equipa…"
          className="w-64 max-w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-emerald-500"
        />
        <button
          type="button"
          onClick={() => setFavOnly((v) => !v)}
          title={favOnly ? "Mostrar todas as ligas" : "Mostrar só ligas favoritas"}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            favOnly
              ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40"
              : "border border-neutral-700 bg-neutral-900 text-neutral-400 hover:text-neutral-200"
          }`}
        >
          ★ Favoritas{favLeagues.size > 0 ? ` (${favLeagues.size})` : ""}
        </button>
        <button
          type="button"
          onClick={() => setCompact((v) => !v)}
          title={compact ? "Ver com estatísticas" : "Ver só resultado"}
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-400 transition hover:text-neutral-200"
        >
          {compact ? "▦ Compacta" : "☰ Detalhada"}
        </button>
        <button
          type="button"
          onClick={() => setAuto((v) => !v)}
          title={auto ? "Pausar atualização automática" : "Atualizar sozinho de minuto a minuto"}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            auto
              ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40"
              : "border border-neutral-700 bg-neutral-900 text-neutral-400 hover:text-neutral-200"
          }`}
        >
          {auto ? "● Auto" : "○ Auto"}
        </button>
        {(query || favOnly || pinned.size > 0) && (
          <span className="text-xs text-neutral-500">
            {visible.length} de {games.length} jogos
            {pinned.size > 0 && ` · ${pinned.size} afixado${pinned.size === 1 ? "" : "s"}`}
          </span>
        )}
      </div>
      <div className="max-h-[75vh] overflow-auto rounded-xl border border-neutral-800 bg-neutral-900">
        {pinnedRows.length > 0 && (
          <div className="border-b border-neutral-800 p-4">
            <div className="mb-2 flex items-center gap-1.5">
              <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Afixados por linha</span>
              {([1, 2, 3] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCols(n)}
                  title={`${n} por linha`}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                    pinnedCols === n
                      ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40"
                      : "border border-neutral-700 text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-3" style={{ gridTemplateColumns: `repeat(${pinnedCols}, minmax(0, 1fr))` }}>
            {orderedPinned.map((g) => {
              const d = fullDetail[g.id];
              const f = form[g.id];
              const href = `/estatisticas/live?${new URLSearchParams({ sofascore: `id:${g.id}` })}`;
              return (
                <div key={g.id} className="min-w-0 rounded-xl border border-emerald-800/40 bg-neutral-950 p-4">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="truncate text-[11px] text-neutral-500">{leagueOf(g)}</p>
                    <span className="flex shrink-0 items-center gap-1">
                      {autoSet.has(String(g.id)) && !pinned.has(String(g.id)) && (
                        <span title="Afixado automático: jogo seguido, em direto" className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
                          auto
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => movePin(g.id, "earlier")}
                        title="Passar para a esquerda"
                        className="text-[11px] text-neutral-600 transition hover:text-neutral-200"
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        onClick={() => movePin(g.id, "later")}
                        title="Passar para a direita"
                        className="text-[11px] text-neutral-600 transition hover:text-neutral-200"
                      >
                        ›
                      </button>
                      <button
                        type="button"
                        onClick={() => togglePin(g)}
                        title={pinned.has(String(g.id)) ? "Desafixar" : autoSet.has(String(g.id)) ? "Afixar também manualmente" : "Afixar no topo"}
                        className={`text-sm transition ${pinned.has(String(g.id)) ? "text-emerald-400 hover:text-neutral-400" : "text-neutral-700 hover:text-neutral-400"}`}
                      >
                        📌
                      </button>
                    </span>
                  </div>
                  <PinnedHead g={g} ht={d?.ht} />
                  <div className="flex items-center justify-between gap-2">
                    <Link href={href} className="text-xs font-medium text-emerald-400 hover:underline">
                      Analisar no live →
                    </Link>
                    <span className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedLineups((prev) => {
                            const next = new Set(prev);
                            if (next.has(g.id)) next.delete(g.id);
                            else next.add(g.id);
                            return next;
                          })
                        }
                        title={expandedLineups.has(g.id) ? "Esconder onzes" : "Ver onzes no relvado"}
                        className="shrink-0 text-xs font-medium text-violet-300 hover:underline"
                      >
                        {expandedLineups.has(g.id) ? "Esconder ▲" : "Onzes ▼"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedTable((prev) => {
                            const next = new Set(prev);
                            if (next.has(g.id)) next.delete(g.id);
                            else next.add(g.id);
                            return next;
                          })
                        }
                        title={expandedTable.has(g.id) ? "Esconder tabela" : "Ver tabela da liga"}
                        className="shrink-0 text-xs font-medium text-amber-300 hover:underline"
                      >
                        {expandedTable.has(g.id) ? "Esconder ▲" : "Tabela ▼"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(g.id)) next.delete(g.id);
                            else next.add(g.id);
                            return next;
                          })
                        }
                        title={expanded.has(g.id) ? "Esconder estatísticas" : "Ver momentum e estatísticas"}
                        className="shrink-0 text-xs font-medium text-sky-400 hover:underline"
                      >
                        {expanded.has(g.id) ? "Esconder ▲" : "Stats ▼"}
                      </button>
                    </span>
                  </div>
                  {expandedTable.has(g.id) && (
                    <PinnedMiniTable
                      eventId={g.id}
                      homeName={g.home}
                      awayName={g.away}
                      formHome={f?.home ?? []}
                      formAway={f?.away ?? []}
                    />
                  )}
                  {expandedLineups.has(g.id) && <PinnedLineups eventId={g.id} homeName={g.home} awayName={g.away} />}
                  {expanded.has(g.id) && <PinnedLiveStats eventId={g.id} homeName={g.home} awayName={g.away} />}
                </div>
              );
            })}
            </div>
          </div>
        )}
        <table className="w-full min-w-[64rem] text-sm">
          <thead className="sticky top-0 z-10 bg-neutral-900 shadow-[0_1px_0_0_#27272a]">
            <tr className="border-b border-neutral-800 text-[11px] uppercase tracking-wide text-neutral-500">
              <th className="px-2 py-2.5 font-semibold"></th>
              <th className="px-3 py-2.5 text-left font-semibold">Minuto</th>
              <th className="px-3 py-2.5 text-left font-semibold">Jogo</th>
              <th className="px-3 py-2.5 text-center font-semibold">Resultado</th>
              {!compact && (
                <>
                  <th className="px-3 py-2.5 text-center font-semibold" title="Golos marcados por jogo, últimos 5">GM</th>
                  <th className="px-3 py-2.5 text-center font-semibold" title="Golos sofridos por jogo, últimos 5">GS</th>
                  <th className="px-3 py-2.5 text-center font-semibold" title="Marcados em casa, últimos 5">GM-C</th>
                  <th className="px-3 py-2.5 text-center font-semibold" title="Sofridos fora, últimos 5">GS-F</th>
                  <th className="px-3 py-2.5 text-center font-semibold" title="Ambas marcam, últimos 5">BTS</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Frm-C</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Frm-F</th>
                  <th className="px-3 py-2.5 text-center font-semibold">1</th>
                  <th className="px-3 py-2.5 text-center font-semibold">X</th>
                  <th className="px-3 py-2.5 text-center font-semibold">2</th>
                </>
              )}
              <th className="px-3 py-2.5 font-semibold"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800/70">
            {groups.map((grp, gi) => (
              <Fragment key={`g${gi}`}>
                <tr className="bg-neutral-800/40">
                  <td colSpan={compact ? 5 : 14} className="px-4 py-2 text-xs">
                    <button
                      type="button"
                      onClick={() => toggleFavLeague(grp.league)}
                      title={favLeagues.has(grp.league) ? "Tirar das favoritas" : "Marcar liga como favorita"}
                      className={`mr-1.5 transition ${favLeagues.has(grp.league) ? "text-emerald-400" : "text-neutral-700 hover:text-neutral-400"}`}
                    >
                      ★
                    </button>
                    <span className="font-semibold text-neutral-200">{grp.league}</span>{" "}
                    <span className="text-neutral-500">
                      {grp.games.length} {grp.games.length === 1 ? "jogo" : "jogos"}
                    </span>
                  </td>
                </tr>
                {grp.games.map(gameRow)}
              </Fragment>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-neutral-500">
            Nada corresponde ao filtro. Marca ligas com ★ ou limpa a pesquisa.
          </p>
        )}
      </div>
    </div>
  );
}
