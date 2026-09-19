"use client";

import { useState, useTransition } from "react";
import { enterLivePick, skipLivePick, resumeWatchingPick } from "@/app/(app)/actions";
import { estimateGameMinute } from "@/lib/matchStatus";
import type { PickStage } from "@/lib/database.types";

// The two decisions on a live pick you are watching - "Entrei" (asks for the
// real odd you got and the game minute) or "Não entrei" - plus an undo for a
// skipped one. Renders nothing for an active pick (it is resolved with
// Green/Red/Devolvida instead). With the game's kickoff the minute field
// starts filled with the current match minute.
export default function LiveStageActions({
  pickId,
  stage,
  kickoff,
}: {
  pickId: string;
  stage: PickStage;
  kickoff?: { date: string; time: string };
}) {
  const [entering, setEntering] = useState(false);
  const [odd, setOdd] = useState("");
  const [minute, setMinute] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function startEntering() {
    const estimate = kickoff ? estimateGameMinute(kickoff.date, kickoff.time, new Date()) : null;
    setMinute(estimate === null ? "" : String(estimate));
    setEntering(true);
  }

  function confirmEntry() {
    if (minute.trim()) {
      const m = Number(minute);
      if (!Number.isInteger(m) || m < 0 || m > 150) {
        setError("O minuto tem de ser um número entre 0 e 150.");
        return;
      }
    }
    run(() => enterLivePick(pickId, Number(odd), minute.trim() ? Number(minute) : null));
  }

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error);
      else {
        setEntering(false);
        setOdd("");
        setMinute("");
      }
    });
  }

  if (stage === "active") return null;

  if (stage === "skipped") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-semibold text-neutral-400">
          Não entrei
        </span>
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(() => resumeWatchingPick(pickId))}
          className="text-neutral-500 hover:text-neutral-300 disabled:opacity-50"
        >
          Voltar a vigiar
        </button>
        {error && <span className="text-red-400">{error}</span>}
      </div>
    );
  }

  if (entering) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          step="0.01"
          min="1.01"
          value={odd}
          autoFocus
          onChange={(e) => setOdd(e.target.value)}
          placeholder="Odd em que entrei"
          className="w-36 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-emerald-500"
        />
        <input
          type="number"
          step="1"
          min="0"
          max="150"
          value={minute}
          onChange={(e) => setMinute(e.target.value)}
          placeholder="Minuto"
          title="Minuto do jogo em que entraste"
          className="w-20 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-emerald-500"
        />
        <button
          type="button"
          disabled={isPending}
          onClick={confirmEntry}
          className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
        >
          {isPending ? "..." : "Confirmar"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEntering(false);
            setError(null);
          }}
          className="text-xs text-neutral-500 hover:text-neutral-300"
        >
          Cancelar
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={startEntering}
        className="rounded-lg bg-emerald-600/15 px-2.5 py-1 text-xs font-medium text-emerald-300 transition hover:bg-emerald-600/25 disabled:opacity-50"
      >
        Entrei
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() => run(() => skipLivePick(pickId))}
        className="rounded-lg bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-400 transition hover:bg-neutral-700 hover:text-neutral-200 disabled:opacity-50"
      >
        Não entrei
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
