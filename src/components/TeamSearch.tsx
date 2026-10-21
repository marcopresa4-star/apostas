"use client";

import Link from "next/link";
import { useState } from "react";

// Global team search on the idle Comparar screen: type a club, jump straight
// to its analysis (as casa — pick the opponent there). The index is built
// server-side from the mapped leagues' current teams.
export default function TeamSearch({
  index,
  base = "/estatisticas",
  teamKey = "casa",
}: {
  index: { team: string; league: string; leagueLabel: string }[];
  base?: string;
  teamKey?: string;
}) {
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
        className="w-full rounded-lg border border-white/[0.09] bg-white/[0.04] px-3 py-2 text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-emerald-500"
      />
      {hits.length > 0 && (
        <div className="mt-2 divide-y divide-white/[0.05] overflow-hidden glass">
          {hits.map((h) => (
            <Link
              key={`${h.league}|${h.team}`}
              href={`${base}?${new URLSearchParams({ liga: h.league, [teamKey]: h.team })}`}
              className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm transition hover:bg-white/[0.06]/60"
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
