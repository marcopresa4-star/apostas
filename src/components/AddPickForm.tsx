"use client";

import { useState, useTransition } from "react";
import { addPick } from "@/app/(app)/actions";
import type { BetType } from "@/lib/database.types";

export default function AddPickForm({ ticketId }: { ticketId: string }) {
  const [open, setOpen] = useState(false);
  const [betType, setBetType] = useState<BetType>("pre_jogo");
  const [selection, setSelection] = useState("");
  const [odd, setOdd] = useState("");
  const [oddMin, setOddMin] = useState("");
  const [oddMax, setOddMax] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-emerald-400 hover:underline"
      >
        + Adicionar aposta a este jogo
      </button>
    );
  }

  function reset() {
    setBetType("pre_jogo");
    setSelection("");
    setOdd("");
    setOddMin("");
    setOddMax("");
    setReason("");
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        await addPick({
          ticketId,
          selection,
          reason,
          betType,
          odd: odd.trim() ? Number(odd) : null,
          oddMin: oddMin.trim() ? Number(oddMin) : null,
          oddMax: oddMax.trim() ? Number(oddMax) : null,
        });
        reset();
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível guardar. Tenta novamente.");
      }
    });
  }

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
      <div className="mb-2 inline-flex rounded-lg border border-neutral-700 bg-neutral-900 p-0.5 text-xs">
        <button
          type="button"
          onClick={() => setBetType("pre_jogo")}
          className={`rounded-md px-2.5 py-1 font-medium transition ${
            betType === "pre_jogo" ? "bg-emerald-600 text-white" : "text-neutral-400 hover:text-white"
          }`}
        >
          Pré-jogo
        </button>
        <button
          type="button"
          onClick={() => setBetType("live")}
          className={`rounded-md px-2.5 py-1 font-medium transition ${
            betType === "live" ? "bg-sky-600 text-white" : "text-neutral-400 hover:text-white"
          }`}
        >
          Live
        </button>
      </div>

      <div className="mb-2 flex gap-2">
        <input
          type="text"
          autoFocus
          value={selection}
          onChange={(e) => setSelection(e.target.value)}
          placeholder="Ex: Ambas marcam"
          className="w-full flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-500"
        />
        {betType === "pre_jogo" ? (
          <input
            type="number"
            step="0.01"
            min="1.01"
            value={odd}
            onChange={(e) => setOdd(e.target.value)}
            placeholder="Odd"
            className="w-20 shrink-0 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-500"
          />
        ) : (
          <>
            <input
              type="number"
              step="0.01"
              min="1.01"
              value={oddMin}
              onChange={(e) => setOddMin(e.target.value)}
              placeholder="Odd mín."
              className="w-20 shrink-0 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-500"
            />
            <input
              type="number"
              step="0.01"
              min="1.01"
              value={oddMax}
              onChange={(e) => setOddMax(e.target.value)}
              placeholder="Odd máx."
              className="w-20 shrink-0 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-500"
            />
          </>
        )}
      </div>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="Razão (opcional)"
        className="mb-2 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-500"
      />
      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={handleSubmit}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
        >
          {isPending ? "A guardar..." : "Adicionar"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-400 hover:text-white"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
