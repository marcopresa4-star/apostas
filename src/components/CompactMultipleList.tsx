"use client";

import { useTransition } from "react";
import StatusBadge, { STATUS_BORDER } from "./StatusBadge";
import { setMultiplePublished } from "@/app/(app)/actions";
import {
  canPublishMultiple,
  formatOdd,
  multipleStatus,
  placedOdd,
  type MultipleRow,
} from "@/lib/multiples";
import type { BetStatus } from "@/lib/database.types";

const DOT: Record<BetStatus, string> = {
  pending: "bg-neutral-500",
  green: "bg-emerald-400",
  red: "bg-red-400",
  void: "bg-amber-400",
  half_green: "bg-teal-400",
  half_red: "bg-orange-400",
};

// The Dashboard's short version of a multiple: total odd, result and one line
// per game. Results are set on the Apostas / Live pages.
export default function CompactMultipleList({ multiples }: { multiples: MultipleRow[] }) {
  const [isPending, startTransition] = useTransition();

  function handleTogglePublish(multiple: MultipleRow) {
    startTransition(async () => {
      const result = await setMultiplePublished(multiple.id, !multiple.is_published);
      if (!result.ok) window.alert(result.error);
    });
  }

  return (
    <div className="space-y-2">
      {multiples.map((multiple) => {
        const legs = [...multiple.legs].sort((a, b) =>
          `${a.match_date}T${a.match_time}`.localeCompare(`${b.match_date}T${b.match_time}`)
        );
        const status = multipleStatus(legs);
        const canPublish = canPublishMultiple({ is_published: multiple.is_published, legs });

        return (
          <div
            key={multiple.id}
            className={`rounded-xl border border-neutral-800 border-l-4 bg-neutral-900 px-3 py-2.5 ${STATUS_BORDER[status]}`}
          >
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-sm font-medium text-neutral-100">
                {multiple.bet_type === "live" && (
                  <span className="mr-1.5 rounded bg-sky-950 px-1 text-[9px] font-semibold text-sky-300">
                    LIVE
                  </span>
                )}
                Múltipla <span className="text-neutral-500">· {legs.length} jogos</span>
              </p>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="text-sm font-semibold text-emerald-400">
                  @{formatOdd(placedOdd(legs))}
                </span>
                <StatusBadge status={status} />
                <button
                  type="button"
                  disabled={isPending || !canPublish}
                  onClick={() => handleTogglePublish(multiple)}
                  title={
                    multiple.is_published
                      ? "Publicada na Comunidade — clique para retirar"
                      : canPublish
                        ? "Publicar na Comunidade"
                        : "Só podes publicar múltiplas pendentes"
                  }
                  className={`rounded p-0.5 transition disabled:opacity-40 ${
                    multiple.is_published
                      ? "text-violet-400 hover:bg-violet-500/10 hover:text-violet-300"
                      : "text-neutral-600 hover:bg-neutral-800 hover:text-neutral-400 disabled:hover:bg-transparent disabled:hover:text-neutral-600"
                  }`}
                >
                  📢
                </button>
              </div>
            </div>

            <div className="space-y-1">
              {legs.map((leg) => (
                <div key={leg.id} className="flex items-center gap-1.5 text-xs text-neutral-300">
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[leg.status]}`}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {leg.home_team?.name} <span className="text-neutral-500">vs</span>{" "}
                    {leg.away_team?.name}
                    <span className="text-neutral-500"> · {leg.selection}</span>
                  </span>
                  <span className="shrink-0 text-neutral-500">
                    {leg.entry_minute != null ? `${leg.entry_minute}'` : leg.match_time.slice(0, 5)}
                  </span>
                  <span className="shrink-0 text-neutral-400">@{formatOdd(leg.odd)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
