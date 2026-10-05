"use client";

import { useState, type ReactNode } from "react";

// Two tabs inside the match report: team sheet vs forecast. The sections
// arrive pre-rendered from the server; this only switches visibility.
export default function ReportTabs({ ficha, previsao }: { ficha: ReactNode; previsao: ReactNode }) {
  const [aba, setAba] = useState<"ficha" | "previsao">("ficha");
  const tab = (id: "ficha" | "previsao", label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setAba(id)}
      className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
        aba === id ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40" : "text-neutral-400 hover:text-neutral-200"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="mt-6">
      <div className="mb-4 flex gap-2">
        {tab("ficha", "Ficha de jogo")}
        {tab("previsao", "Previsão")}
      </div>
      {aba === "ficha" ? <div className="space-y-4">{ficha}</div> : <div className="space-y-4">{previsao}</div>}
    </div>
  );
}
