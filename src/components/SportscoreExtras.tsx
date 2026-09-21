"use client";

import { useState } from "react";

const BASE = "https://sportscore.com/embed";

type Tab = "lineups" | "standings";

// More of the free Sportscore embeds, under a game's widget: the lineups of the
// match and the league table. Closed until you ask for one, so a widget stays
// as short as before and nothing extra loads. (A team's own page was tried and
// dropped: it lists either the next games or the recent results, never both,
// so for most teams it only showed the games still to come.)
export default function SportscoreExtras({
  matchSlug,
  competitionSlug,
}: {
  matchSlug: string;
  // Left out when Sportscore has no standings under the competition's name.
  competitionSlug: string | null;
}) {
  const [open, setOpen] = useState<Tab | null>(null);

  const tabs: { id: Tab; label: string }[] = [{ id: "lineups", label: "Onzes" }];
  if (competitionSlug) tabs.push({ id: "standings", label: "Classificação" });

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
    </div>
  );
}
