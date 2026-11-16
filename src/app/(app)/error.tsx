"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import Link from "next/link";

// Shown when a page throws while rendering: keeps the sidebar and navigation,
// explains in plain words and offers a retry instead of a blank screen.
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="glass mx-auto mt-10 flex max-w-md flex-col items-center px-6 py-12 text-center" role="alert">
      <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 text-2xl text-red-300 ring-1 ring-red-400/30">!</span>
      <p className="font-display text-base font-semibold text-neutral-100">Algo correu mal ao carregar esta página</p>
      <p className="mt-1.5 text-sm leading-relaxed text-neutral-400">
        Pode ser uma falha passageira da fonte de dados. Tenta outra vez; se continuar, volta aos jogos.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => retry()} className="btn-glow inline-flex min-h-10 items-center rounded-xl px-5 py-2 text-sm">
          Tentar outra vez
        </button>
        <Link href="/" className="btn-soft inline-flex min-h-10 items-center rounded-xl border border-white/10 px-5 py-2 text-sm text-neutral-200">
          Ir para os jogos
        </Link>
      </div>
    </div>
  );
}
