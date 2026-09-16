"use client";

import { useTransition } from "react";
import { deleteTicket } from "@/app/(app)/actions";

export default function DeleteTicketButton({ ticketId }: { ticketId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (confirm("Apagar este jogo e todas as apostas associadas?")) {
          startTransition(() => deleteTicket(ticketId));
        }
      }}
      className="text-xs font-medium text-neutral-500 hover:text-red-400 disabled:opacity-50"
    >
      Apagar jogo
    </button>
  );
}
