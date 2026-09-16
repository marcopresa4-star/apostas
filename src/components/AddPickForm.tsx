"use client";

import { useState, useTransition } from "react";
import { addPick } from "@/app/(app)/actions";

export default function AddPickForm({ ticketId }: { ticketId: string }) {
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState("");
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

  function handleSubmit() {
    if (!selection.trim()) {
      setError("Indica a aposta.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await addPick({ ticketId, selection, reason });
        setSelection("");
        setReason("");
        setOpen(false);
      } catch {
        setError("Não foi possível guardar. Tenta novamente.");
      }
    });
  }

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
      <input
        type="text"
        autoFocus
        value={selection}
        onChange={(e) => setSelection(e.target.value)}
        placeholder="Ex: Ambas marcam"
        className="mb-2 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-500"
      />
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
