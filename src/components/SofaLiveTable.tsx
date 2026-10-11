"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { SofaLiveEntry } from "@/lib/sofascore";
import { addWatchedMatch } from "@/app/(app)/actions";

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
  // Half-time score, only read for mapped leagues (one extra read per game).
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
  if (form.length === 0) return null;
  return (
    <span className="flex gap-0.5" title="Forma (últimos 5)">
      {form.map((r, i) => (
        <span key={i} className={`flex h-3.5 w-3.5 items-center justify-center rounded text-[8px] font-bold text-white ${CHIP[r]}`}>
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



// The live board grouped by league, like a fixtures board: one header row
// per competition, then its games in kickoff order. "Analisar" opens the live
// calculator with ?sofascore=id:. Leagues can be favorited (★) and filtered
// to; games can be pinned (📌) to the top. Both persist in this browser.
const FAV_LEAGUES_KEY = "apostas:favLeagues";
const PINNED_GAMES_KEY = "apostas:pinnedGames";

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
}: {
  games: SofaLiveEntry[];
  stats: Record<number, SofaBoardStats>;
  form: Record<number, { home: ("V" | "E" | "D")[]; away: ("V" | "E" | "D")[] }>;
  rings: Record<number, SofaBoardRings>;
  detail: Record<number, SofaBoardDetail>;
}) {
  const router = useRouter();
  const [auto, setAuto] = useState(true);
  const [query, setQuery] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  // Browser-only preferences hydrate after mount: reading them in the
  // initializer would disagree with the server and break hydration.
  const [favLeagues, setFavLeagues] = useState<Set<string>>(new Set());
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  useEffect(() => {
    setFavLeagues(loadSet(FAV_LEAGUES_KEY));
    setPinned(loadSet(PINNED_GAMES_KEY));
  }, []);
  // Refresh from the server every minute while this tab is visible (paused
  // in background tabs): the board re-reads the live list, filters and pins
  // survive because they live in client state.
  useEffect(() => {
    if (!auto) return;
    const tick = (): void => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
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
    const pinning = !pinned.has(key);
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
    // Pinning also puts the game on the Dashboard (its own Remover ✕ takes it
    // off again; unpinning here only unsorts). Duplicates are refused server-side.
    if (pinning) {
      setPendingId(game.id);
      startTransition(async () => {
        try {
          await addWatchedMatch(game.home, game.away, null, null, `id:${game.id}`);
          setAdded((prev) => new Set(prev).add(game.id));
        } finally {
          setPendingId(null);
        }
      });
    }
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
  const byKickoff = [...visible].sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const pinnedRows = byKickoff.filter((g) => pinned.has(String(g.id)));
  const restRows = byKickoff.filter((g) => !pinned.has(String(g.id)));
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
  // One game card, shared by the pinned block and the league groups.
  const gameCard = (g: SofaLiveEntry) => {
    const d = detail[g.id];
    const f = form[g.id];
    const href = `/estatisticas/live?${new URLSearchParams({ sofascore: `id:${g.id}` })}`;
    const isPinned = pinned.has(String(g.id));
    const isAdded = added.has(g.id);
    return (
      <div
        key={g.id}
        className={`rounded-xl border bg-neutral-950 p-4 ${isPinned ? "border-emerald-800/40" : "border-neutral-800"}`}
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="truncate text-[11px] text-neutral-500">{leagueOf(g)}</p>
          <button
            type="button"
            onClick={() => togglePin(g)}
            title={isPinned ? "Desafixar" : "Afixar no topo e pôr nos Jogos"}
            className={`shrink-0 text-sm transition ${isPinned ? "text-emerald-400" : "text-neutral-700 hover:text-neutral-400"}`}
          >
            📌
          </button>
        </div>
        <div className="mb-2">
          {g.phase === "halftime" ? (
            <span className="text-xs font-semibold text-emerald-400">● Intervalo</span>
          ) : g.minute !== null ? (
            <span className="text-xs font-semibold text-red-400">● {g.minute}&apos; AO VIVO</span>
          ) : (
            <PeriodLabel g={g} />
          )}
        </div>
        <p className="truncate text-sm text-neutral-200">{g.home}</p>
        <div className="my-1 flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums text-emerald-400">
            {g.homeGoals ?? "?"}–{g.awayGoals ?? "?"}
          </span>
          {d?.ht && <span className="text-xs text-neutral-500">({d.ht[0]}–{d.ht[1]})</span>}
        </div>
        <p className="mb-2 truncate text-sm text-neutral-200">{g.away}</p>
        {(f?.home || f?.away) && (
          <div className="mb-3 flex items-center gap-3">
            {f?.home && <Form form={f.home} />}
            {f?.away && <Form form={f.away} />}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <Link href={href} className="text-xs font-medium text-emerald-400 hover:underline">
            Analisar no live →
          </Link>
          {isAdded ? (
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
              className="text-xs font-medium text-sky-400 hover:underline disabled:opacity-50"
            >
              {pendingId === g.id ? "…" : "+ Jogos"}
            </button>
          )}
        </div>
      </div>
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
      <div className="max-h-[75vh] space-y-5 overflow-auto rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        {pinnedRows.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pinnedRows.map(gameCard)}
          </div>
        )}
        {groups.map((grp, gi) => (
          <section key={`g${gi}`}>
            <div className="mb-2 flex items-center gap-1.5 px-1 text-xs">
              <button
                type="button"
                onClick={() => toggleFavLeague(grp.league)}
                title={favLeagues.has(grp.league) ? "Tirar das favoritas" : "Marcar liga como favorita"}
                className={`transition ${favLeagues.has(grp.league) ? "text-emerald-400" : "text-neutral-700 hover:text-neutral-400"}`}
              >
                ★
              </button>
              <span className="font-semibold text-neutral-200">{grp.league}</span>{" "}
              <span className="text-neutral-500">
                {grp.games.length} {grp.games.length === 1 ? "jogo" : "jogos"}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {grp.games.map(gameCard)}
            </div>
          </section>
        ))}
        {visible.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-neutral-500">
            Nada corresponde ao filtro. Marca ligas com ★ ou limpa a pesquisa.
          </p>
        )}
      </div>
    </div>
  );
}
