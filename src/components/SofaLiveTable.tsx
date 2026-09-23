"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import type { SofaLiveEntry } from "@/lib/sofascore";
import type { Summary } from "@/lib/footballModel";
import { addWatchedMatch } from "@/app/(app)/actions";

const num1 = (n: number) => n.toFixed(1).replace(".", ",");

export interface SofaBoardStats {
  home: Summary | null;
  away: Summary | null;
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

function Stats({ s }: { s: Summary | null }) {
  if (!s) return <td className="px-2 py-2 text-center text-neutral-700">—</td>;
  return (
    <td className="px-2 py-2 text-center text-neutral-300">
      {num1(s.gfPerGame)}–{num1(s.gaPerGame)}
    </td>
  );
}

type SortKey = "minute" | "league" | "game" | "score" | "home" | "away" | "formHome" | "formAway";

const minuteValue = (g: SofaLiveEntry): number =>
  g.phase === "halftime" ? 45 : (g.minute ?? -1);

const formPoints = (form: ("V" | "E" | "D")[]): number =>
  form.reduce((n, r) => n + (r === "V" ? 3 : r === "E" ? 1 : 0), 0);

function Header({
  label,
  sortKey,
  active,
  dir,
  onSort,
  center,
  title,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey | null;
  dir: 1 | -1;
  onSort: (key: SortKey) => void;
  center?: boolean;
  title?: string;
}) {
  return (
    <th className={`px-2 py-2 font-semibold ${center ? "text-center" : "text-left"}`} title={title}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={`Ordenar por ${label.toLowerCase()}`}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-neutral-200 ${active === sortKey ? "text-amber-300" : ""}`}
      >
        {label}
        <span aria-hidden className="text-[9px]">{active === sortKey ? (dir === 1 ? "▲" : "▼") : "△"}</span>
      </button>
    </th>
  );
}

// The live board keyed by SofaScore event id. "Analisar" opens the live
// calculator with ?sofascore=id:. Columns sort both ways on click.
// Leagues can be favorited (★) and filtered to; games can be pinned (📌) to
// the top. Both persist in this browser.
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
}: {
  games: SofaLiveEntry[];
  stats: Record<number, SofaBoardStats>;
  form: Record<number, { home: ("V" | "E" | "D")[]; away: ("V" | "E" | "D")[] }>;
}) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [dir, setDir] = useState<1 | -1>(1);
  const [query, setQuery] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const [favLeagues, setFavLeagues] = useState<Set<string>>(() =>
    typeof window === "undefined" ? new Set() : loadSet(FAV_LEAGUES_KEY)
  );
  const [pinned, setPinned] = useState<Set<string>>(() =>
    typeof window === "undefined" ? new Set() : loadSet(PINNED_GAMES_KEY)
  );
  const onSort = (key: SortKey) => {
    if (sortKey === key) setDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setDir(1);
    }
  };

  const sorted = useMemo(() => {
    if (!sortKey) return games;
    const val = (g: SofaLiveEntry): string | number => {
      switch (sortKey) {
        case "minute":
          return minuteValue(g);
        case "league":
          return (stats[g.id]?.leagueLabel ?? g.competition).toLowerCase();
        case "game":
          return `${g.home} ${g.away}`.toLowerCase();
        case "score":
          return (g.homeGoals ?? -1) * 100 + (g.awayGoals ?? -1);
        case "home":
          return stats[g.id]?.home ? stats[g.id].home!.gfPerGame - stats[g.id].home!.gaPerGame : -999;
        case "away":
          return stats[g.id]?.away ? stats[g.id].away!.gfPerGame - stats[g.id].away!.gaPerGame : -999;
        case "formHome":
          return form[g.id] ? formPoints(form[g.id].home) : -1;
        case "formAway":
          return form[g.id] ? formPoints(form[g.id].away) : -1;
      }
    };
    return [...games].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return cmp !== 0 ? cmp * dir : a.kickoff.localeCompare(b.kickoff);
    });
  }, [games, stats, form, sortKey, dir]);

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
  const visible = sorted.filter((g) => {
    if (favOnly && !favLeagues.has(leagueOf(g))) return false;
    if (!q) return true;
    return (
      leagueOf(g).toLowerCase().includes(q) ||
      g.home.toLowerCase().includes(q) ||
      g.away.toLowerCase().includes(q)
    );
  });
  // Pinned games always on top, in kickoff order; the rest follows the sort.
  const pinnedRows = visible.filter((g) => pinned.has(String(g.id)));
  const restRows = visible.filter((g) => !pinned.has(String(g.id)));
  const rows = [...pinnedRows, ...restRows];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtrar por liga ou equipa…"
          className="w-64 max-w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-amber-500"
        />
        <button
          type="button"
          onClick={() => setFavOnly((v) => !v)}
          title={favOnly ? "Mostrar todas as ligas" : "Mostrar só ligas favoritas"}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            favOnly
              ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40"
              : "border border-neutral-700 bg-neutral-900 text-neutral-400 hover:text-neutral-200"
          }`}
        >
          ★ Favoritas{favLeagues.size > 0 ? ` (${favLeagues.size})` : ""}
        </button>
        {(query || favOnly || pinned.size > 0) && (
          <span className="text-xs text-neutral-500">
            {rows.length} de {games.length} jogos
            {pinned.size > 0 && ` · ${pinned.size} afixado${pinned.size === 1 ? "" : "s"}`}
          </span>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900">
      <table className="w-full min-w-[62rem] text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-[11px] uppercase tracking-wide text-neutral-500">
            <th className="px-2 py-2 font-semibold"></th>
            <Header label="Minuto" sortKey="minute" active={sortKey} dir={dir} onSort={onSort} />
            <Header label="Liga" sortKey="league" active={sortKey} dir={dir} onSort={onSort} />
            <Header label="Jogo" sortKey="game" active={sortKey} dir={dir} onSort={onSort} />
            <Header label="Resultado" sortKey="score" active={sortKey} dir={dir} onSort={onSort} center />
            <Header label="GM–GS casa" sortKey="home" active={sortKey} dir={dir} onSort={onSort} center title="Golos marcados e sofridos por jogo, últimos 5" />
            <Header label="GM–GS fora" sortKey="away" active={sortKey} dir={dir} onSort={onSort} center title="Golos marcados e sofridos por jogo, últimos 5" />
            <Header label="Forma casa" sortKey="formHome" active={sortKey} dir={dir} onSort={onSort} />
            <Header label="Forma fora" sortKey="formAway" active={sortKey} dir={dir} onSort={onSort} />
            <th className="px-3 py-2 font-semibold"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800/70">
          {rows.map((g) => {
            const s = stats[g.id];
            const f = form[g.id];
            const href = `/estatisticas/live?${new URLSearchParams({ sofascore: `id:${g.id}` })}`;
            const league = leagueOf(g);
            const isPinned = pinned.has(String(g.id));
            return (
              <tr key={g.id} className={isPinned ? "bg-amber-500/[0.04]" : undefined}>
                <td className="py-2.5 pr-0 pl-3">
                  <button
                    type="button"
                    onClick={() => togglePin(g)}
                    title={isPinned ? "Desafixar do topo" : "Afixar no topo desta lista (só aqui, não vai para a Dashboard)"}
                    className={`text-sm transition ${isPinned ? "text-amber-400" : "text-neutral-700 hover:text-neutral-400"}`}
                  >
                    📌
                  </button>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {g.phase === "halftime" ? (
                    <span className="font-semibold text-amber-400">Intervalo</span>
                  ) : (
                    <PeriodLabel g={g} />
                  )}
                </td>
                <td className="max-w-[9rem] truncate px-3 py-2.5 text-xs text-neutral-400" title={league}>
                  <button
                    type="button"
                    onClick={() => toggleFavLeague(league)}
                    title={favLeagues.has(league) ? "Tirar das favoritas" : "Marcar liga como favorita"}
                    className={`mr-1 transition ${favLeagues.has(league) ? "text-amber-400" : "text-neutral-700 hover:text-neutral-400"}`}
                  >
                    ★
                  </button>
                  {league}
                </td>
                <td className="px-3 py-2.5">
                  <span className="text-neutral-100">{g.home}</span> <span className="text-neutral-600">vs</span>{" "}
                  <span className="text-neutral-100">{g.away}</span>
                </td>
                <td className="px-3 py-2.5 text-center font-semibold text-neutral-100">
                  {g.homeGoals ?? "?"}–{g.awayGoals ?? "?"}
                </td>
                <Stats s={s?.home ?? null} />
                <Stats s={s?.away ?? null} />
                <td className="px-2 py-2.5">{f ? <Form form={f.home} /> : <span className="text-neutral-700">—</span>}</td>
                <td className="px-2 py-2.5">{f ? <Form form={f.away} /> : <span className="text-neutral-700">—</span>}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  {added.has(g.id) ? (
                    <Link href="/" title="Ver na Dashboard" className="text-xs font-medium text-emerald-400 hover:underline">
                      ✓ Na Dashboard
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
                      title="Passar para a Dashboard"
                      className="mr-2 text-xs font-medium text-sky-400 hover:underline disabled:opacity-50"
                    >
                      {pendingId === g.id ? "…" : "+ Dashboard"}
                    </button>
                  )}
                  <Link href={href} className="text-xs font-medium text-amber-400 hover:underline">
                    Analisar →
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-neutral-500">
          Nada corresponde ao filtro. Marca ligas com ★ ou limpa a pesquisa.
        </p>
      )}
      </div>
    </div>
  );
}
