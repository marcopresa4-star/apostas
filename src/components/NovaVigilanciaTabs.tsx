"use client";

import { useState } from "react";
import LiveWatchForm from "./LiveWatchForm";
import AddLiveToExistingForm from "./AddLiveToExistingForm";
import type { ComboItem, ComboCountry } from "./EntityCombobox";
import type { TicketOption } from "./ExistingTicketPicker";
import type { TagItem } from "./CategoryCombobox";

export default function NovaVigilanciaTabs({
  initialCompetitions,
  initialTeams,
  countries,
  existingTickets,
  initialCategories,
}: {
  initialCompetitions: ComboItem[];
  initialTeams: ComboItem[];
  countries: ComboCountry[];
  existingTickets: TicketOption[];
  initialCategories: TagItem[];
}) {
  const [mode, setMode] = useState<"novo" | "existente">("existente");

  return (
    <div>
      <div className="mb-4 inline-flex rounded-lg border border-neutral-700 bg-neutral-900 p-0.5 text-sm">
        <button
          type="button"
          onClick={() => setMode("existente")}
          className={`rounded-md px-3 py-1.5 font-medium transition ${
            mode === "existente" ? "bg-sky-600 text-white" : "text-neutral-400 hover:text-white"
          }`}
        >
          Jogo já registado
        </button>
        <button
          type="button"
          onClick={() => setMode("novo")}
          className={`rounded-md px-3 py-1.5 font-medium transition ${
            mode === "novo" ? "bg-sky-600 text-white" : "text-neutral-400 hover:text-white"
          }`}
        >
          Jogo novo
        </button>
      </div>

      {mode === "existente" ? (
        <AddLiveToExistingForm tickets={existingTickets} initialCategories={initialCategories} />
      ) : (
        <LiveWatchForm
          initialCompetitions={initialCompetitions}
          initialTeams={initialTeams}
          countries={countries}
          initialCategories={initialCategories}
        />
      )}
    </div>
  );
}
