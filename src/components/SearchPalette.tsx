"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LEAGUES } from "@/lib/footballData";

interface TeamHit {
  id: number;
  name: string;
  category: string;
  national: boolean;
}

interface NextGame {
  eventId: number;
  home: string;
  away: string;
  tournament: string;
  kickoff: string | null;
  live: boolean;
}

// Command-K palette: jump to a league's analysis, or to a team's next game
// (live calculator). Leagues filter locally; teams come from SofaScore.
export default function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [teams, setTeams] = useState<TeamHit[] | null>(null);
  const [looking, setLooking] = useState(false);
  const [nextByTeam, setNextByTeam] = useState<Record<number, NextGame | { none: true }>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTeams(null);
      setNextByTeam({});
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open ]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setTeams(null);
      return;
    }
    setLooking(true);
    const id = window.setTimeout(() => {
      fetch(`/api/sofascore/search-teams?q=${encodeURIComponent(q)}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((body: { teams?: TeamHit[] } | null) => {
          setTeams(Array.isArray(body?.teams) ? body.teams : []);
        })
        .catch(() => setTeams([]))
        .finally(() => setLooking(false));
    }, 250);
    return () => window.clearTimeout(id);
  }, [query ]);

  const nextOf = (teamId: number): NextGame | { none: true } | undefined => nextByTeam[teamId];

  const loadNext = (teamId: number) => {
    if (nextByTeam[teamId] !== undefined) return;
    fetch(`/api/sofascore/team-next?teamId=${teamId}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: (NextGame & { none?: undefined }) | { none: true } | null) => {
        if (!body) return;
        setNextByTeam((prev) => ({ ...prev, [teamId]: body }));
      })
      .catch(() => {});
  };

  if (!open) return null;
  const q = query.trim().toLowerCase();
  const leagues = q
    ? LEAGUES.filter((l) => l.label.toLowerCase().includes(q)).slice(0, 6)
    : [];
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-24"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Pesquisar"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
          placeholder="Liga ou equipa… (Esc fecha)"
          className="w-full border-b border-neutral-800 bg-transparent px-4 py-3 text-neutral-100 outline-none placeholder:text-neutral-600"
        />
        <div className="max-h-80 overflow-y-auto p-2">
          {leagues.length > 0 && (
            <>
              <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Ligas</p>
              {leagues.map((l) => (
                <Link
                  key={l.code}
                  href={`/estatisticas?${new URLSearchParams({ liga: l.code })}`}
                  onClick={onClose}
                  className="block rounded-lg px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
                >
                  🧮 {l.label}
                </Link>
              ))}
            </>
          )}
          {(teams !== null || looking) && (
            <>
              <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Equipas {looking ? "…" : ""}
              </p>
              {teams !== null && teams.length === 0 && !looking && (
                <p className="px-3 py-2 text-xs text-neutral-500">Sem equipas para isto.</p>
              )}
              {(teams ?? []).map((t) => {
                const next = nextOf(t.id);
                return (
                  <div key={t.id} className="rounded-lg px-3 py-2 hover:bg-neutral-800" onMouseEnter={() => loadNext(t.id)}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-sm text-neutral-200">
                        {t.national ? "🏳️" : "👕"} {t.name}
                        <span className="ml-1.5 text-[11px] text-neutral-500">{t.category}</span>
                      </p>
                      {next && "eventId" in next && (
                        <Link
                          href={`/estatisticas/live?${new URLSearchParams({ sofascore: `id:${next.eventId}` })}`}
                          onClick={onClose}
                          className="shrink-0 text-xs font-medium text-amber-400 hover:underline"
                        >
                          {next.live ? "Em direto →" : "Próximo jogo →"}
                        </Link>
                      )}
                      {next && !("eventId" in next) && (
                        <span className="shrink-0 text-[11px] text-neutral-600">sem próximo jogo</span>
                      )}
                    </div>
                    {next && "eventId" in next && (
                      <p className="mt-0.5 truncate text-[11px] text-neutral-500">
                        {next.home} vs {next.away}
                        {next.tournament ? ` · ${next.tournament}` : ""}
                      </p>
                    )}
                  </div>
                );
              })}
            </>
          )}
          {q.length < 2 && (
            <p className="px-3 py-3 text-xs text-neutral-600">Escreve pelo menos 2 letras. ⌘K / Ctrl+K abre e fecha.</p>
          )}
        </div>
      </div>
    </div>
  );
}
