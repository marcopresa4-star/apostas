"use client";

import { useState } from "react";
import StandingsTable, { type StandingsLine } from "./StandingsTable";

// League table with a Casa/Global/Fora toggle: the global view (official
// points where the source has them) plus each side's own games, counted from
// the season's fixtures with venue-only form and strength.
export default function VenueStandings({
  global,
  home,
  away,
  highlight,
}: {
  global: StandingsLine[];
  home: StandingsLine[];
  away: StandingsLine[];
  highlight?: { home: string; away: string };
}) {
  const [view, setView] = useState<"home" | "global" | "away">("global");
  const lines = view === "home" ? home : view === "away" ? away : global;
  const hasVenue = home.length > 0 || away.length > 0;
  const btn = (v: "home" | "global" | "away", label: string) => (
    <button
      key={v}
      type="button"
      onClick={() => setView(v)}
      aria-pressed={view === v}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        view === v ? "bg-neutral-100 text-neutral-900" : "text-neutral-400 hover:text-neutral-200"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div>
      {hasVenue && (
        <div className="mb-2 inline-flex items-center gap-1 rounded-full border border-neutral-800 bg-neutral-900 p-1">
          {btn("home", "Casa")}
          {btn("global", "Global")}
          {btn("away", "Fora")}
        </div>
      )}
      <StandingsTable lines={lines} highlight={highlight} />
      {view !== "global" && (
        <p className="mt-1 text-[11px] text-neutral-500">
          Só jogos {view === "home" ? "em casa" : "fora"} nos dados (pontos contados, sem tabela oficial).
        </p>
      )}
    </div>
  );
}
