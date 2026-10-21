"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

const initialState: { error: string | null } = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm glass p-8 shadow-xl">
        <h1 className="mb-1 text-2xl font-bold tracking-tight text-neutral-100">
          <span className="title-glow">Apostas</span>
        </h1>
        <p className="mb-6 text-sm text-neutral-400">
          Inicia sessão para gerir as tuas apostas.
        </p>

        <form action={formAction} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm text-neutral-300">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-lg border border-white/[0.09] bg-white/[0.03] px-3 py-2 text-neutral-100 outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm text-neutral-300">
              Palavra-passe
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-white/[0.09] bg-white/[0.03] px-3 py-2 text-neutral-100 outline-none focus:border-emerald-500"
            />
          </div>

          {state.error && (
            <p className="rounded-lg bg-red-950 px-3 py-2 text-sm text-red-300">
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-emerald-600 px-3 py-2 font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
          >
            {pending ? "A entrar..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
