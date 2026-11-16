"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buildLeagueCompareAction } from "./actions";

// Building the whole-league table reads every mapped league's season (round by
// round), so it is a press, never an automatic render.
export default function BuildCompareButton({ hasIndex }: { hasIndex: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            try {
              await buildLeagueCompareAction(hasIndex);
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Não foi possível calcular.");
            }
          })
        }
        className="btn-glow px-3 py-1.5 text-sm disabled:opacity-60"
      >
        {isPending ? "A calcular as ligas… (pode demorar minutos)" : hasIndex ? "Recalcular todas as ligas" : "Calcular todas as ligas"}
      </button>
      {error && <span className="text-[11px] text-red-400">{error}</span>}
    </span>
  );
}
