"use client";

import { useState } from "react";
import { formAverages, formRows, formTags, resultOf, type FormRow } from "@/lib/recentForm";
import type { PlayedMatch } from "@/lib/footballModel";

type Venue = "all" | "H" | "A";

const comma2 = (v: number): string => v.toFixed(2).replace(".", ",");

const RES_CHIP: Record<string, string> = {
  V: "bg-emerald-500/20 text-emerald-300",
  E: "bg-neutral-500/20 text-neutral-300",
  D: "bg-red-500/20 text-red-300",
};

function TeamForm({ team, matches }: { team: string; matches: PlayedMatch[] }) {
  const [venue, setVenue] = useState<Venue>("all");
  const rows = formRows(team, matches).filter((r) => venue === "all" || r.venue === venue);
  const avg = formAverages(rows);
  const tabs: { key: Venue; label: string }[] = [
    { key: "all", label: "Todos" },
    { key: "H", label: "Casa" },
    { key: "A", label: "Fora" },
  ];
  return (
    <div className="min-w-0 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="truncate text-sm font-semibold text-neutral-100">{team}</p>
        <div className="flex shrink-0 gap-1 rounded-lg bg-neutral-950 p-0.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setVenue(t.key)}
              className={`rounded-md px-2 py-0.5 text-[11px] transition ${
                venue === t.key ? "bg-neutral-800 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {avg ? (
        <div className="mb-3 grid grid-cols-3 text-center">
          <div>
            <p className="text-base font-semibold tabular-nums text-neutral-100">{comma2(avg.scored)}</p>
            <p className="text-[10px] text-neutral-500">Média marcados</p>
          </div>
          <div>
            <p className="text-base font-semibold tabular-nums text-neutral-100">{comma2(avg.conceded)}</p>
            <p className="text-[10px] text-neutral-500">Média sofridos</p>
          </div>
          <div>
            <p className="text-base font-semibold tabular-nums text-neutral-100">{(avg.over * 100).toFixed(1).replace(".", ",")}%</p>
            <p className="text-[10px] text-neutral-500">Taxa over 2.5</p>
          </div>
        </div>
      ) : (
        <p className="mb-3 text-xs text-neutral-500">Ainda sem jogos.</p>
      )}
      <div className="divide-y divide-neutral-800/60">
        {rows.map((r: FormRow) => {
          const ft = resultOf(r.gf, r.ga);
          const ht = r.hh !== null && r.ha !== null ? resultOf(r.venue === "H" ? r.hh : r.ha, r.venue === "H" ? r.ha : r.hh) : null;
          const over = r.hg + r.ag > 2.5;
          return (
            <div key={`${r.date}-${r.opp}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-xs">
              <span className="shrink-0 text-neutral-500">{r.date}</span>
              <span
                title={r.venue === "H" ? "Em casa" : "Fora"}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-neutral-700 text-[10px] font-semibold text-neutral-400"
              >
                {r.venue}
              </span>
              <span className="min-w-0 flex-1 truncate text-neutral-300">{r.opp}</span>
              <span className="shrink-0 font-semibold tabular-nums text-neutral-100">
                {r.hg}–{r.ag}{" "}
                <span className="font-normal text-neutral-500">
                  (HT {r.hh !== null && r.ha !== null ? `${r.hh}–${r.ha}` : "–"})
                </span>
              </span>
              {ht && (
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${RES_CHIP[ht]}`}>HT-{ht}</span>
              )}
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${RES_CHIP[ft]}`}>FT-{ft}</span>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                  over ? "bg-emerald-500/20 text-emerald-300" : "bg-neutral-500/20 text-neutral-400"
                }`}
              >
                {over ? "Over" : "Under"}
              </span>
              {formTags(r).map((t) => (
                <span
                  key={t}
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    t === "Reviravolta" ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"
                  }`}
                >
                  {t}
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Recent form of both sides (last 10 played each): averages, venue filter
// and per-game HT/FT chips plus comeback tags, like the classic tables.
export default function RecentForm({ home, away, matches }: { home: string; away: string; matches: PlayedMatch[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-neutral-300">Forma recente (últimos 10 jogos)</h3>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TeamForm team={home} matches={matches} />
        <TeamForm team={away} matches={matches} />
      </div>
    </div>
  );
}
