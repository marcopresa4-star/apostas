"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import type { SofaLiveEntry } from "@/lib/sofascore";
import { addWatchedMatch } from "@/app/(app)/actions";

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
  useEffect(() => {
    setFavLeagues(loadSet(FAV_LEAGUES_KEY));
    setPinned(loadSet(PINNED_GAMES_KEY));
  }, []);

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
  const gameRow = (g: SofaLiveEntry) => {
    const r = rings[g.id];
    const d = detail[g.id];
    const f = form[g.id];
    const href = `/estatisticas/live?${new URLSearchParams({ sofascore: `id:${g.id}` })}`;
    const isPinned = pinned.has(String(g.id));
    return (
      <tr key={g.id} className={isPinned ? "bg-emerald-500/[0.04]" : undefined}>
        <td className="py-3 pr-0 pl-4">
          <button
            type="button"
            onClick={() => togglePin(g)}
            title={isPinned ? "Desafixar do topo" : "Afixar no topo e pôr nos Jogos"}
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
        {(query || favOnly || pinned.size > 0) && (
          <span className="text-xs text-neutral-500">
            {visible.length} de {games.length} jogos
            {pinned.size > 0 && ` · ${pinned.size} afixado${pinned.size === 1 ? "" : "s"}`}
          </span>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900">
        <table className="w-full min-w-[64rem] text-sm">
          <thead>
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
            {pinnedRows.length > 0 && (
              <Fragment key="pinned">
                <tr className="bg-emerald-500/[0.06]">
                  <td colSpan={compact ? 5 : 14} className="px-4 py-2 text-xs">
                    <span className="mr-1.5">📌</span>
                    <span className="font-semibold text-neutral-200">Afixados</span>{" "}
                    <span className="text-neutral-500">
                      {pinnedRows.length} {pinnedRows.length === 1 ? "jogo" : "jogos"}
                    </span>
                  </td>
                </tr>
                {pinnedRows.map(gameRow)}
              </Fragment>
            )}
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
