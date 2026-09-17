"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ExistingTicketPicker, { type TicketOption } from "./ExistingTicketPicker";
import CategoryCombobox, { type TagItem } from "./CategoryCombobox";
import { addPick, createBetCategory } from "@/app/(app)/actions";

export default function AddLiveToExistingForm({
  tickets,
  initialCategories,
}: {
  tickets: TicketOption[];
  initialCategories: TagItem[];
}) {
  const [ticket, setTicket] = useState<TicketOption | null>(null);
  const [selection, setSelection] = useState("");
  const [oddMin, setOddMin] = useState("");
  const [categories, setCategories] = useState(initialCategories);
  const [category, setCategory] = useState<TagItem | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function addCategory(item: TagItem) {
    setCategories((prev) => (prev.some((c) => c.id === item.id) ? prev : [...prev, item]));
  }

  function handleSubmit() {
    setError(null);
    if (!ticket) return setError("Seleciona o jogo.");
    if (!selection.trim()) return setError("Indica a possível aposta.");
    if (!oddMin.trim()) return setError("Indica a odd mínima de entrada.");
    if (Number(oddMin) <= 1) return setError("A odd tem de ser maior que 1.");

    startTransition(async () => {
      try {
        await addPick({
          ticketId: ticket.id,
          selection,
          reason,
          betType: "live",
          odd: null,
          oddMin: Number(oddMin),
          categoryId: category?.id ?? null,
        });
        router.push("/live");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível guardar. Tenta novamente.");
      }
    });
  }

  if (tickets.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-neutral-800 px-4 py-8 text-center text-sm text-neutral-500">
        Ainda não tens jogos registados em Apostas. Cria primeiro um em{" "}
        <Link href="/apostas/nova" className="text-emerald-400 hover:underline">
          Nova aposta
        </Link>
        .
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-sm">
      <ExistingTicketPicker items={tickets} value={ticket} onSelect={setTicket} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr]">
        <div>
          <label className="mb-1 block text-sm text-neutral-300">Possível aposta</label>
          <input
            type="text"
            value={selection}
            onChange={(e) => setSelection(e.target.value)}
            placeholder="Ex: Próximo a marcar: Casa"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-emerald-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-neutral-300">Odd mínima</label>
          <input
            type="number"
            step="0.01"
            min="1.01"
            value={oddMin}
            onChange={(e) => setOddMin(e.target.value)}
            placeholder="Ex: 1.85"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-emerald-500"
          />
        </div>
      </div>

      <CategoryCombobox
        label="Tipo de aposta (opcional)"
        placeholder="Ex: Over/Under, Ambas Marcam, Handicap..."
        items={categories}
        value={category}
        onSelect={setCategory}
        createAction={createBetCategory}
        onCreated={addCategory}
      />

      <div>
        <label className="mb-1 block text-sm text-neutral-300">Razão (opcional)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="O que estás a vigiar neste jogo..."
          className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-emerald-500"
        />
      </div>

      {error && (
        <p className="rounded-lg bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Link
          href="/live"
          className="rounded-lg px-3 py-2 text-center font-medium text-neutral-400 transition hover:text-white sm:w-auto"
        >
          Cancelar
        </Link>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending}
          className="w-full rounded-lg bg-sky-600 px-3 py-2 font-medium text-white shadow-lg shadow-sky-600/20 transition hover:bg-sky-500 disabled:opacity-60 sm:w-auto"
        >
          {isPending ? "A guardar..." : "Vigiar jogo"}
        </button>
      </div>
    </div>
  );
}
