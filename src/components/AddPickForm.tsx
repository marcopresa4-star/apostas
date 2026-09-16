"use client";

import { useState, useTransition } from "react";
import { addPick } from "@/app/(app)/actions";
import type { BetType } from "@/lib/database.types";

export default function AddPickForm({
  ticketId,
  betType,
}: {
  ticketId: string;
  betType: BetType;
}) {
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState("");
  const [odd, setOdd] = useState("");
  const [oddMin, setOddMin] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`text-xs font-medium hover:underline ${
          betType === "live" ? "text-sky-400" : "text-emerald-400"
        }`}
      >
        {betType === "live" ? "+ Vigiar aposta live" : "+ Adicionar aposta pré-jogo"}
      </button>
    );
  }

  function reset() {
    setSelection("");
    setOdd("");
    setOddMin("");
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
      <div className="mb-2 flex gap-2">
        <input
          type="text"
          autoFocus
          value={selection}
          onChange={(e) => setSelection(e.target.value)}
          placeholder={betType === "live" ? "Ex: Próximo a marcar: Casa" : "Ex: Ambas marcam"}
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
          <input
            type="number"
            step="0.01"
            min="1.01"
            value={oddMin}
            onChange={(e) => setOddMin(e.target.value)}
            placeholder="Odd mín."
            className="w-24 shrink-0 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-500"
          />
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
          className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60 ${
            betType === "live" ? "bg-sky-600 hover:bg-sky-500" : "bg-emerald-600 hover:bg-emerald-500"
          }`}
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
