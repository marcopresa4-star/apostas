"use client";

import { useState } from "react";

const BASE = "https://sportscore.com/embed";

type Tab = "lineups" | "standings" | "recent";

// More of the free Sportscore embeds, under a game's widget: the lineups of the
// match, the league table, and each team's recent results. Closed until you ask
// for one, so a widget stays as short as before and nothing extra loads.
export default function SportscoreExtras({
  matchSlug,
  homeSlug,
  awaySlug,
  competitionSlug,
  homeName,
  awayName,
}: {
  matchSlug: string;
  homeSlug: string | null;
  awaySlug: string | null;
  // Left out when Sportscore has no standings under the competition's name.
  competitionSlug: string | null;
  homeName: string;
  awayName: string;
}) {
  const [open, setOpen] = useState<Tab | null>(null);

  const tabs: { id: Tab; label: string }[] = [{ id: "lineups", label: "Onzes" }];
  if (competitionSlug) tabs.push({ id: "standings", label: "Classificação" });
  if (homeSlug && awaySlug) tabs.push({ id: "recent", label: "Jogos recentes" });

  const frame = (path: string, title: string, height: string) => (
    <iframe
      key={path}
      src={`${BASE}/${path}/?theme=dark`}
      title={title}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      className={`${height} w-full rounded-lg border-0`}
    />
  );

  return (
    <div className="border-t border-neutral-800 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setOpen((current) => (current === tab.id ? null : tab.id))}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
              open === tab.id
                ? "bg-sky-600 text-white"
                : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {open === "lineups" && (
        <div className="mt-2">{frame(`lineups/football/${matchSlug}`, "Onzes", "h-[560px]")}</div>
      )}
      {open === "standings" && competitionSlug && (
        <div className="mt-2">
          {frame(`standings/football/${competitionSlug}`, "Classificação", "h-[560px]")}
        </div>
      )}
      {open === "recent" && homeSlug && awaySlug && (
        <div className="mt-2 space-y-2">
          <p className="text-xs font-medium text-neutral-400">{homeName}</p>
          {frame(`fixtures/football/team/${homeSlug}`, `Jogos de ${homeName}`, "h-[360px]")}
          <p className="text-xs font-medium text-neutral-400">{awayName}</p>
          {frame(`fixtures/football/team/${awaySlug}`, `Jogos de ${awayName}`, "h-[360px]")}
        </div>
      )}
    </div>
  );
}
