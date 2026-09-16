"use client";

import { useState, useTransition } from "react";
import StatusBadge, { STATUS_BORDER } from "./StatusBadge";
import StatusButtons from "./StatusButtons";
import PickImages, { type PickImageItem } from "./PickImages";
import { updatePick } from "@/app/(app)/actions";
import type { BetStatus } from "@/lib/database.types";

interface PickCardProps {
  pick: {
    id: string;
    selection: string;
    reason: string | null;
    status: BetStatus;
    odd: number | null;
  };
  images: PickImageItem[];
}

export default function PickCard({ pick, images }: PickCardProps) {
  const [editing, setEditing] = useState(false);
  const [selection, setSelection] = useState(pick.selection);
  const [odd, setOdd] = useState(pick.odd !== null ? String(pick.odd) : "");
  const [reason, setReason] = useState(pick.reason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function cancelEdit() {
    setSelection(pick.selection);
    setOdd(pick.odd !== null ? String(pick.odd) : "");
    setReason(pick.reason ?? "");
    setError(null);
    setEditing(false);
  }

  function handleSave() {
    if (!selection.trim()) {
      setError("Indica a aposta.");
      return;
    }
    if (odd.trim() && Number(odd) <= 1) {
      setError("A odd tem de ser maior que 1.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await updatePick({
          pickId: pick.id,
          selection,
          reason,
          odd: odd.trim() ? Number(odd) : null,
        });
        setEditing(false);
      } catch {
        setError("Não foi possível guardar. Tenta novamente.");
      }
    });
  }

  return (
    <div className={`rounded-lg border-l-4 bg-neutral-950 p-3 ${STATUS_BORDER[pick.status]}`}>
      {editing ? (
        <div className="mb-2 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              autoFocus
              value={selection}
              onChange={(e) => setSelection(e.target.value)}
              className="w-full flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-500"
            />
            <input
              type="number"
              step="0.01"
              min="1.01"
              value={odd}
              onChange={(e) => setOdd(e.target.value)}
              placeholder="Odd"
              className="w-20 shrink-0 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-500"
            />
          </div>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Razão (opcional)"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-500"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={handleSave}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              {isPending ? "A guardar..." : "Guardar"}
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              className="rounded-lg px-3 py-1.5 text-xs text-neutral-400 hover:text-white"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-start justify-between gap-2">
            <p className="min-w-0 break-words text-sm font-medium text-emerald-300">
              {pick.selection}
              {pick.odd !== null && (
                <span className="ml-2 text-xs font-normal text-neutral-400">
                  @ {pick.odd.toFixed(2)}
                </span>
              )}
            </p>
            <div className="shrink-0">
              <StatusBadge status={pick.status} />
            </div>
          </div>
          {pick.reason && <p className="mb-2 text-sm text-neutral-300">{pick.reason}</p>}
          <PickImages pickId={pick.id} images={images} />
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mb-2 text-xs text-neutral-500 hover:text-neutral-300"
          >
            Editar aposta
          </button>
        </>
      )}

      {!editing && <StatusButtons pickId={pick.id} status={pick.status} />}
    </div>
  );
}
