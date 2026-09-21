"use client";

import { useState, useTransition } from "react";
import { saveSportscoreLink } from "@/app/(app)/actions";

// Teaches the widget what Sportscore calls these two clubs: paste the address of
// one of its match pages. It is saved by the clubs' names, so it only has to be
// done once per club, whatever the game.
export default function SportscoreTeach({
  homeNames,
  awayNames,
  onSaved,
}: {
  homeNames: string[];
  awayNames: string[];
  onSaved: () => void;
}) {
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveSportscoreLink(homeNames, awayNames, link);
      if (result.ok) {
        setLink("");
        onSaved();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="text-left">
      <p className="text-xs text-neutral-400">
        Abre este jogo em{" "}
        <a
          href="https://sportscore.com/football/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-400 hover:underline"
        >
          sportscore.com
        </a>
        , copia o endereço da página e cola aqui. Fica guardado para estas equipas.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && link.trim() && !isPending) save();
          }}
          placeholder="https://sportscore.com/football/match/..."
          className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-xs text-neutral-100 outline-none focus:border-sky-500"
        />
        <button
          type="button"
          disabled={isPending || !link.trim()}
          onClick={save}
          className="shrink-0 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sky-500 disabled:opacity-60"
        >
          {isPending ? "A guardar..." : "Guardar"}
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
    </div>
  );
}
