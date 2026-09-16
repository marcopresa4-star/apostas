"use client";

import { useTransition } from "react";
import type { BetStatus } from "@/lib/database.types";
import { updatePickStatus, deletePick } from "@/app/(app)/actions";

const OPTIONS: { status: BetStatus; label: string; className: string }[] = [
  { status: "green", label: "Green", className: "bg-emerald-600 hover:bg-emerald-500" },
  { status: "red", label: "Red", className: "bg-red-600 hover:bg-red-500" },
  { status: "void", label: "Devolvida", className: "bg-amber-600 hover:bg-amber-500" },
];

export default function StatusButtons({
  pickId,
  status,
}: {
  pickId: string;
  status: BetStatus;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {OPTIONS.map((opt) => (
          <button
            key={opt.status}
            disabled={isPending}
            onClick={() => startTransition(() => updatePickStatus(pickId, opt.status))}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium text-white transition disabled:opacity-50 ${
              status === opt.status ? opt.className : "bg-neutral-800 hover:bg-neutral-700"
            }`}
          >
            {opt.label}
          </button>
        ))}
        {status !== "pending" && (
          <button
            disabled={isPending}
            onClick={() => startTransition(() => updatePickStatus(pickId, "pending"))}
            className="rounded-lg px-2.5 py-1 text-xs font-medium text-neutral-400 hover:text-white disabled:opacity-50"
          >
            Repor pendente
          </button>
        )}
      </div>
      <button
        disabled={isPending}
        onClick={() => {
          if (confirm("Apagar esta aposta?")) {
            startTransition(() => deletePick(pickId));
          }
        }}
        className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-neutral-500 hover:text-red-400 disabled:opacity-50"
      >
        Apagar
      </button>
    </div>
  );
}
