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
  const [oddMin, setOddMin] = useState("");
  const [alertMinute, setAlertMinute] = useState("");
  const [categories, setCategories] = useState(initialCategories);
  const [category, setCategory] = useState<TagItem | null>(null);
  const [reason, setReason] = useState("");
  const [sofascoreUrl, setSofascoreUrl] = useState("");
  const [bookmakerUrl, setBookmakerUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function addCategory(item: TagItem) {
    setCategories((prev) => (prev.some((c) => c.id === item.id) ? prev : [...prev, item]));
  }

  function handleSubmit() {
    setError(null);
    if (!ticket) return setError("Seleciona o jogo.");
    if (!category?.id) return setError("Seleciona ou cria o tipo de aposta.");
    if (!oddMin.trim()) return setError("Indica a odd mínima de entrada.");
    if (Number(oddMin) <= 1) return setError("A odd tem de ser maior que 1.");

    startTransition(async () => {
      try {
        await addPick({
          ticketId: ticket.id,
          selection: category.name,
          reason,
          betType: "live",
          odd: null,
          oddMin: Number(oddMin),
          alertMinute: alertMinute.trim() ? Number(alertMinute) : null,
          sofascoreUrl,
          bookmakerUrl,
          categoryId: category.id,
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <CategoryCombobox
          label="Tipo de aposta"
          placeholder="Ex: Over/Under, Ambas Marcam, Handicap..."
          items={categories}
          value={category}
          onSelect={setCategory}
          createAction={createBetCategory}
          onCreated={addCategory}
        />
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
        <div>
          <label className="mb-1 block text-sm text-neutral-300">Alerta ao minuto</label>
          <input
            type="number"
            step="1"
            min="1"
            value={alertMinute}
            onChange={(e) => setAlertMinute(e.target.value)}
            placeholder="Ex: 10"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-emerald-500"
          />
        </div>
      </div>

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm text-neutral-300">
            Link SofaScore <span className="text-neutral-500">(opcional)</span>
          </label>
          <input
            type="url"
            value={sofascoreUrl}
            onChange={(e) => setSofascoreUrl(e.target.value)}
            placeholder="https://www.sofascore.com/..."
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-emerald-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-neutral-300">
            Link da casa de apostas <span className="text-neutral-500">(opcional)</span>
          </label>
          <input
            type="url"
            value={bookmakerUrl}
            onChange={(e) => setBookmakerUrl(e.target.value)}
            placeholder="https://..."
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-emerald-500"
          />
        </div>
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
