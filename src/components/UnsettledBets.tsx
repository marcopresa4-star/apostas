"use client";

import { useState, useTransition } from "react";
import { useNow } from "@/lib/useNow";
import { unsettledBets, type OpenBet } from "@/lib/unsettled";
import { updateLegStatus, updatePickStatus } from "@/app/(app)/actions";
import { STATUS_OPTIONS } from "./StatusButtons";
import { formatOdd } from "@/lib/multiples";
import type { BetStatus } from "@/lib/database.types";

const SHOWN = 5;

function Row({ bet }: { bet: OpenBet }) {
  const [isPending, startTransition] = useTransition();
  const mark = (status: BetStatus) =>
    startTransition(() => (bet.kind === "pick" ? updatePickStatus(bet.id, status) : updateLegStatus(bet.id, status)));

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-neutral-100">
          {bet.home} <span className="text-neutral-500">vs</span> {bet.away}
        </p>
        <p className="truncate text-xs text-neutral-400">
          {bet.match_date.slice(8, 10)}/{bet.match_date.slice(5, 7)} às {bet.match_time.slice(0, 5)}
          {bet.competition ? ` · ${bet.competition}` : ""} ·{" "}
          <span className="text-neutral-200">
            {bet.selection}
            {bet.odd !== null ? ` @ ${formatOdd(bet.odd)}` : ""}
          </span>
          {bet.kind === "leg" && <span className="ml-1.5 rounded bg-violet-950 px-1 text-[10px] font-semibold text-violet-300">MÚLTIPLA</span>}
          {bet.live && <span className="ml-1.5 rounded bg-sky-950 px-1 text-[10px] font-semibold text-sky-300">LIVE</span>}
        </p>
        {bet.actualScore && (
          <p className="mt-0.5 text-xs">
            <span className="text-neutral-400">
              Resultado real: <span className="font-medium text-neutral-200">{bet.actualScore[0]}–{bet.actualScore[1]}</span>
            </span>
            {bet.suggestion && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => mark(bet.suggestion!)}
                title="Marca a aposta com este resultado"
                className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-semibold text-white disabled:opacity-50 ${
                  bet.suggestion === "green" ? "bg-emerald-700 hover:bg-emerald-600" : "bg-red-700 hover:bg-red-600"
                }`}
              >
                Sugestão: {bet.suggestion === "green" ? "Green" : "Red"} · aplicar
              </button>
            )}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.status}
            type="button"
            disabled={isPending}
            onClick={() => mark(opt.status)}
            className={`rounded-lg px-2 py-1 text-xs font-medium text-white transition disabled:opacity-50 ${opt.className}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </li>
  );
}

// Bets whose game has ended but that still have no result. Marking the result
// is up to you, and a forgotten one skews the stats, so they are listed at the
// top of the Dashboard until you mark them.
export default function UnsettledBets({ open }: { open: OpenBet[] }) {
  const now = useNow(30_000);
  const [all, setAll] = useState(false);
  if (!now) return null;
  const waiting = unsettledBets(open, now);
  if (waiting.length === 0) return null;
  const shown = all ? waiting : waiting.slice(0, SHOWN);

  return (
    <section className="mb-6 rounded-xl border border-amber-800/60 bg-amber-950/20 px-4 py-3">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-amber-300">
        <span aria-hidden>⏳</span> Por resolver ({waiting.length})
      </h2>
      <p className="mb-1 text-xs text-neutral-400">
        O jogo já acabou e a aposta continua pendente. Marca o resultado para as estatísticas ficarem certas.
      </p>
      <ul className="divide-y divide-amber-900/30">
        {shown.map((bet) => (
          <Row key={`${bet.kind}-${bet.id}`} bet={bet} />
        ))}
      </ul>
      {waiting.length > SHOWN && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="mt-1 text-xs font-medium text-amber-400 hover:underline"
        >
          {all ? "Mostrar menos" : `Mostrar as ${waiting.length}`}
        </button>
      )}
    </section>
  );
}
