"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { removeFavoriteAction } from "@/app/(app)/estatisticas/jogos-dia/actions";

// Removes a followed game from the waiting list.
export default function UnfavButton({ eventId, label }: { eventId: number; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        if (!confirm(`Deixar de seguir ${label}?`)) return;
        setBusy(true);
        removeFavoriteAction(eventId)
          .catch(() => {})
          .finally(() => {
            setBusy(false);
            router.refresh();
          });
      }}
      className="shrink-0 text-[11px] text-neutral-500 hover:text-red-300 disabled:opacity-50"
    >
      Remover ✕
    </button>
  );
}
