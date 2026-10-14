"use client";

import { useState } from "react";
import { addFavoriteAction, removeFavoriteAction } from "@/app/(app)/estatisticas/jogos-dia/actions";

// Star button for one game: follows it so the watcher promotes it at
// kickoff (Em direto + Jogos + afixado no Ao vivo).
export default function FavoriteButton({
  eventId,
  home,
  away,
  tournament,
  initial,
}: {
  eventId: number;
  home: string;
  away: string;
  tournament: string;
  initial: boolean;
}) {
  const [fav, setFav] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy || eventId <= 0}
      onClick={() => {
        setBusy(true);
        const next = !fav;
        setFav(next);
        (next ? addFavoriteAction(eventId, home, away, tournament) : removeFavoriteAction(eventId))
          .catch(() => setFav(!next))
          .finally(() => setBusy(false));
      }}
      title={fav ? "Deixar de seguir" : "Seguir: ao apito fica afixado no Ao vivo"}
      className={`shrink-0 transition disabled:opacity-50 ${
        fav ? "text-amber-300 hover:text-neutral-400" : "text-neutral-700 hover:text-amber-300"
      }`}
    >
      ★
    </button>
  );
}
