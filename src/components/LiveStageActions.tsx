"use client";

import { useState, useTransition } from "react";
import { enterLivePick, skipLivePick, resumeWatchingPick } from "@/app/(app)/actions";
import type { PickStage } from "@/lib/database.types";

// The two decisions on a live pick you are watching - "Entrei" (asks for the
// real odd you got) or "Não entrei" - plus an undo for a skipped one. Renders
// nothing for an active pick (it is resolved with Green/Red/Devolvida
// instead).
export default function LiveStageActions({
  pickId,
  stage,
}: {
  pickId: string;
  stage: PickStage;
}) {
  const [entering, setEntering] = useState(false);
  const [odd, setOdd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error);
      else {
        setEntering(false);
        setOdd("");
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
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(() => enterLivePick(pickId, Number(odd)))}
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
        onClick={() => setEntering(true)}
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
