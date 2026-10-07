"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addFeedGameAction, FEED_MAX } from "@/app/(app)/feed/actions";

// Adds a game to the live feed by SofaScore link or id (before kickoff is
// fine: the chart starts when the game does).
export default function FeedAdd({ count }: { count: number }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mb-4 flex max-w-4xl flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim() || busy) return;
        setBusy(true);
        setError(null);
        addFeedGameAction(value.trim()).then((r) => {
          setBusy(false);
          if (!r.ok) {
            setError(r.error);
            return;
          }
          setValue("");
          router.refresh();
        });
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Cola o link do jogo no SofaScore (mesmo por começar)…"
          className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-emerald-500"
        />
        <button
          type="submit"
          disabled={busy || count >= FEED_MAX}
          title={count >= FEED_MAX ? `Máximo de ${FEED_MAX} jogos` : "Adicionar ao direto"}
          className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? "…" : "Acompanhar"}
        </button>
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
      <p className="text-[11px] text-neutral-500">
        {count}/{FEED_MAX} jogos · adiciona antes do apito: o gráfico começa sozinho.
      </p>
    </form>
  );
}
