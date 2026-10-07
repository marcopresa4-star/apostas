"use client";

import Link from "next/link";
import { useState } from "react";

// Global team search on the idle Comparar screen: type a club, jump straight
// to its analysis (as casa — pick the opponent there). The index is built
// server-side from the mapped leagues' current teams.
export default function TeamSearch({ index }: { index: { team: string; league: string; leagueLabel: string }[] }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const hits =
    needle.length < 2
      ? []
      : index.filter((r) => r.team.toLowerCase().includes(needle)).slice(0, 8);
  return (
    <div className="mb-4 max-w-4xl">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Procurar equipa…"
        className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-emerald-500"
      />
      {hits.length > 0 && (
        <div className="mt-2 divide-y divide-neutral-800/60 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
          {hits.map((h) => (
            <Link
              key={`${h.league}|${h.team}`}
              href={`/estatisticas?${new URLSearchParams({ liga: h.league, casa: h.team })}`}
              className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm transition hover:bg-neutral-800/60"
            >
              <span className="font-medium text-neutral-100">{h.team}</span>
              <span className="shrink-0 text-[11px] text-neutral-500">{h.leagueLabel}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
