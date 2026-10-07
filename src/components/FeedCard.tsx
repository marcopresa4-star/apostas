"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { predictLive } from "@/lib/liveModel";
import LiveEvolutionChart from "./LiveEvolutionChart";
import { useEvoSnapshots } from "@/lib/useEvoSnapshots";
import { removeFeedGameAction } from "@/app/(app)/feed/actions";

// One followed game: live score + minute header, full evolution chart, link
// to the calculator. Pre-match expectation comes from the existing prematch
// endpoint (same numbers the calculator opens with).
export default function FeedCard({
  rowId,
  eventId,
  home,
  away,
  tournament,
}: {
  rowId: string;
  eventId: number;
  home: string;
  away: string;
  tournament: string;
}) {
  const { snaps, live, meta } = useEvoSnapshots(eventId, true);
  const router = useRouter();
  const [pre, setPre] = useState<{ home: number; away: number; firstHalfShare: number } | null>(null);
  useEffect(() => {
    let stop = false;
    fetch(`/api/sofascore/prematch?id=${eventId}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!stop && body && typeof body.home === "number" && typeof body.away === "number") {
          setPre({ home: body.home, away: body.away, firstHalfShare: typeof body.firstHalfShare === "number" ? body.firstHalfShare : 0.44 });
        }
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [eventId]);

  const homeName = meta?.home || home;
  const awayName = meta?.away || away;
  const modelAt = (s: { minute: number; hg: number; ag: number; rh: number; ra: number; xgH: number | null; xgA: number | null }) => {
    if (!pre) return { mais1: null, over25: null, btts: null, exp: null };
    const q = predictLive({
      lambdaHome: pre.home,
      lambdaAway: pre.away,
      firstHalfShare: pre.firstHalfShare,
      minute: s.minute,
      homeGoals: s.hg,
      awayGoals: s.ag,
      redsHome: s.rh,
      redsAway: s.ra,
      ...(s.xgH !== null && s.xgA !== null ? { homeXg: s.xgH, awayXg: s.xgA } : {}),
    });
    return {
      mais1: 1 - q.nextGoal.none,
      over25: q.over["2.5"] ?? null,
      btts: q.bothScore ?? null,
      exp: q.remainingHome + q.remainingAway,
    };
  };

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <p className="truncate text-[11px] text-neutral-500">{meta?.tournament || tournament}</p>
        <button
          type="button"
          onClick={() => {
            if (confirm(`Deixar de seguir ${homeName} vs ${awayName}?`)) {
              removeFeedGameAction(rowId).then(() => router.refresh());
            }
          }}
          className="shrink-0 text-[11px] text-neutral-500 hover:text-red-300"
        >
          Remover ✕
        </button>
      </div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-base font-semibold text-neutral-100">
          {homeName} <span className="text-neutral-500">vs</span> {awayName}
        </p>
        {live ? (
          <p className="text-sm font-bold tabular-nums">
            <span className="text-emerald-300">
              {live.hg}–{live.ag}
            </span>{" "}
            <span className="font-semibold text-red-400">
              {live.phase === "halftime" ? "INT" : `${live.minute}'`}
            </span>
          </p>
        ) : (
          <p className="text-sm text-neutral-500">Por começar</p>
        )}
        <Link href={`/estatisticas/live?${new URLSearchParams({ sofascore: `id:${eventId}` })}`} className="text-xs font-medium text-emerald-400 hover:underline">
          Abrir na calculadora →
        </Link>
      </div>
      {snaps.length > 0 ? (
        <LiveEvolutionChart snaps={snaps} modelAt={modelAt} homeName={homeName} awayName={awayName} />
      ) : (
        <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-center text-xs text-neutral-500">
          {live ? "A acumular leituras (1/min)…" : "O gráfico começa ao apito inicial."}
        </p>
      )}
    </div>
  );
}
