"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buildLeagueCompareAction } from "./actions";

// Building the whole-league table reads every mapped league's season (round by
// round), so it is a press, never an automatic render. The action does a batch
// per call and this loop keeps calling it, so the work is resumable and the
// progress is visible instead of one request hanging for minutes.
export default function BuildCompareButton({
  hasIndex,
  rows,
  total,
}: {
  hasIndex: boolean;
  rows: number;
  total: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [progress, setProgress] = useState<{ rows: number; total: number } | null>(null);
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
            setProgress({ rows, total });
            let force = hasIndex;
            try {
              // 40 batches of 4 is far more than any league list here; the
              // cap is only a guard against looping forever on a broken feed.
              for (let i = 0; i < 40; i++) {
                const result = await buildLeagueCompareAction(force);
                force = false;
                setProgress({ rows: result.index.rows.length, total: result.total });
                if (result.done) break;
              }
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Não foi possível calcular.");
            }
          })
        }
        className="btn-glow px-3 py-1.5 text-sm disabled:opacity-60"
      >
        {isPending
          ? progress && progress.rows < progress.total
            ? `A calcular as ligas… ${progress.rows}/${progress.total}`
            : hasIndex
              ? "A recalcular as ligas…"
              : "A calcular as ligas…"
          : hasIndex
            ? "Recalcular todas as ligas"
            : "Calcular todas as ligas"}
      </button>
      {error && <span className="text-[11px] text-red-400">{error}</span>}
    </span>
  );
}
