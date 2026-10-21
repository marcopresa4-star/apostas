"use client";

// Follow a game that the mapped leagues don't cover: paste its SofaScore link
// and the game joins the Ao vivo agora board (and the Vista widgets, same
// watched_matches table). The add resolves the two team names through the
// event API first — addWatchedMatch requires them and refuses duplicates.
import { useState, useTransition } from "react";
import { parseSofascoreId } from "@/lib/sofascore";
import { addWatchedMatch, removeWatchedMatch } from "@/app/(app)/actions";

interface Chip {
  id: string; // watched_matches row id
  label: string; // "Home vs Away"
}

export default function AoVivoFollow({ chips }: { chips: Chip[] }) {
  const [open, setOpen] = useState(false);
  const [sofaLink, setSofaLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyAdd, startAdd] = useTransition();
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  function handleAdd() {
    const id = parseSofascoreId(sofaLink);
    if (id === null) {
      setError("Cola o link do jogo no SofaScore (tem «id:12345678» no fim, ou só o número).");
      return;
    }
    setError(null);
    startAdd(async () => {
      let home = "";
      let away = "";
      try {
        const res = await fetch(`/api/sofascore/event?id=${id}`, { cache: "no-store" });
        const state = res.ok ? ((await res.json())?.state ?? null) : null;
        if (state?.homeName && state?.awayName) {
          home = String(state.homeName);
          away = String(state.awayName);
        }
      } catch {
        // Falls through to the shared error below.
      }
      if (!home || !away) {
        setError("Não consegui ler as equipas do jogo (scraper desligado?). Tenta de novo.");
        return;
      }
      await addWatchedMatch(home, away, null, null, sofaLink);
      setSofaLink("");
      setOpen(false);
    });
  }

  function handleRemove(rowId: string) {
    setBusyIds((prev) => new Set(prev).add(rowId));
    startAdd(async () => {
      await removeWatchedMatch(rowId);
    });
  }

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-neutral-400">A seguir</span>
        {chips.map((c) => (
          <span
            key={c.id}
            className="flex items-center gap-1 rounded-full border border-sky-800/60 bg-sky-500/10 py-0.5 pr-1 pl-2.5 text-xs text-sky-200"
          >
            <span className="max-w-44 truncate">{c.label}</span>
            <button
              type="button"
              onClick={() => handleRemove(c.id)}
              disabled={busyIds.has(c.id)}
              title="Deixar de seguir"
              className="rounded-full px-1 text-sky-400/70 transition hover:bg-sky-800/40 hover:text-sky-200 disabled:opacity-40"
            >
              ✕
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-xs font-medium text-sky-400 hover:underline"
        >
          {open ? "Cancelar" : "+ Colar link do SofaScore"}
        </button>
      </div>
      {open && (
        <div className="mt-2 glass p-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="url"
              value={sofaLink}
              onChange={(e) => {
                setSofaLink(e.target.value);
                setError(null);
              }}
              placeholder="https://www.sofascore.com/.../id:12345678"
              className="w-full rounded-lg border border-white/[0.09] bg-white/[0.03] px-3 py-2 text-sm text-neutral-100 outline-none transition-colors focus:border-sky-500"
            />
            <button
              type="button"
              disabled={busyAdd || parseSofascoreId(sofaLink) === null}
              onClick={handleAdd}
              className="shrink-0 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-60"
            >
              {busyAdd ? "A seguir…" : "Seguir"}
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}
