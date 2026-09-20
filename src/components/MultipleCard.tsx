"use client";

import { useState, useTransition } from "react";
import StatusBadge, { STATUS_BORDER } from "./StatusBadge";
import { STATUS_OPTIONS } from "./StatusButtons";
import { updateLegStatus, deleteMultiple, setMultiplePublished } from "@/app/(app)/actions";
import {
  canPublishMultiple,
  effectiveOdd,
  formatOdd,
  multipleStatus,
  placedOdd,
  type MultipleLeg,
  type MultipleRow,
} from "@/lib/multiples";

function LegRow({ leg, live, readOnly }: { leg: MultipleLeg; live: boolean; readOnly: boolean }) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className={`rounded-lg border-l-4 bg-neutral-950 p-3 ${STATUS_BORDER[leg.status]}`}>
      <p className="truncate text-xs uppercase tracking-wide text-neutral-500">
        {leg.competition?.name}
        {leg.competition?.country?.name ? ` · ${leg.competition.country.name}` : ""}
      </p>
      <p className="break-words text-sm font-medium text-neutral-100">
        {leg.home_team?.name} <span className="text-neutral-500">vs</span> {leg.away_team?.name}
      </p>
      <p className="text-xs text-neutral-400">
        {new Date(`${leg.match_date}T00:00:00`).toLocaleDateString("pt-PT", {
          day: "2-digit",
          month: "2-digit",
        })}{" "}
        às {leg.match_time.slice(0, 5)}
        {live && leg.entry_minute != null ? ` · entrei aos ${leg.entry_minute}'` : ""}
      </p>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-neutral-200">
          {leg.selection}{" "}
          <span className="font-semibold text-emerald-400">@ {formatOdd(leg.odd)}</span>
        </p>
        <StatusBadge status={leg.status} />
      </div>

      {!readOnly && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.status}
              type="button"
              disabled={isPending}
              onClick={() => startTransition(() => updateLegStatus(leg.id, opt.status))}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium text-white transition disabled:opacity-50 ${
                leg.status === opt.status ? opt.className : "bg-neutral-800 hover:bg-neutral-700"
              }`}
            >
              {opt.label}
            </button>
          ))}
          {leg.status !== "pending" && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => startTransition(() => updateLegStatus(leg.id, "pending"))}
              className="rounded-lg px-2.5 py-1 text-xs font-medium text-neutral-400 hover:text-white disabled:opacity-50"
            >
              Repor pendente
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// One multiple: its games, each with its own result, and the total odd. The
// multiple's own result is worked out from the games, so there is nothing to
// set on it.
export default function MultipleCard({
  multiple,
  readOnly = false,
}: {
  multiple: MultipleRow;
  readOnly?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [isTogglingPublish, startPublishTransition] = useTransition();
  const [publishError, setPublishError] = useState<string | null>(null);
  const legs = [...multiple.legs].sort((a, b) =>
    `${a.match_date}T${a.match_time}`.localeCompare(`${b.match_date}T${b.match_time}`)
  );
  const status = multipleStatus(legs);
  const placed = placedOdd(legs);
  const effective = effectiveOdd(legs);
  const live = multiple.bet_type === "live";
  const canPublish = canPublishMultiple({ is_published: multiple.is_published, legs });

  function handleTogglePublish() {
    setPublishError(null);
    startPublishTransition(async () => {
      const result = await setMultiplePublished(multiple.id, !multiple.is_published);
      if (!result.ok) setPublishError(result.error);
    });
  }

  return (
    <div
      className={`rounded-2xl border border-neutral-800 border-l-4 bg-neutral-900 p-4 shadow-sm ${STATUS_BORDER[status]}`}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {live ? "Múltipla live" : "Múltipla"} · {legs.length} jogos
          </p>
          <p className="text-lg font-bold text-neutral-100">
            Odd total <span className="text-emerald-400">{formatOdd(placed)}</span>
          </p>
          {effective !== placed && (
            <p className="text-xs text-neutral-400">
              Odd efetiva {formatOdd(effective)}{" "}
              <span className="text-neutral-500">(com devolvidas e meias)</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {!readOnly && multiple.is_published && (
            <span
              title="Visível na Comunidade"
              className="rounded-full bg-violet-950 px-2 py-0.5 text-[10px] font-semibold text-violet-300"
            >
              📢 Publicada
            </span>
          )}
          <StatusBadge status={status} />
          {!readOnly && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                if (confirm("Apagar esta múltipla e todos os seus jogos?")) {
                  startTransition(() => deleteMultiple(multiple.id));
                }
              }}
              className="text-xs font-medium text-neutral-500 hover:text-red-400 disabled:opacity-50"
            >
              Apagar
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {legs.map((leg) => (
          <LegRow key={leg.id} leg={leg} live={live} readOnly={readOnly} />
        ))}
      </div>

      {multiple.reason && (
        <p className="mt-3 whitespace-pre-line text-sm text-neutral-400">{multiple.reason}</p>
      )}
      {!readOnly && (
        <div className="mt-3">
          <button
            type="button"
            disabled={isTogglingPublish || !canPublish}
            onClick={handleTogglePublish}
            title={!canPublish ? "Só podes publicar múltiplas pendentes" : undefined}
            className={`text-xs disabled:opacity-50 ${
              multiple.is_published
                ? "text-violet-400 hover:text-violet-300"
                : "text-neutral-500 hover:text-neutral-300 disabled:hover:text-neutral-500"
            }`}
          >
            {isTogglingPublish
              ? "..."
              : multiple.is_published
                ? "Retirar da Comunidade"
                : "Publicar na Comunidade"}
          </button>
          {publishError && <p className="mt-1 text-xs text-red-400">{publishError}</p>}
        </div>
      )}
      {multiple.bookmaker_url && (
        <a
          href={multiple.bookmaker_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-xs font-medium text-sky-400 hover:underline"
        >
          Abrir na casa de apostas ↗
        </a>
      )}
    </div>
  );
}
