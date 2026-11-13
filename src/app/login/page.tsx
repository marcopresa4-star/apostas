"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

const initialState: { error: string | null } = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div aria-hidden className="hero-orb hero-orb-a" />
      <div aria-hidden className="hero-orb hero-orb-b" />
      <div className="glass-accent float-slow relative w-full max-w-sm p-8 shadow-2xl shadow-emerald-900/20">
        <span
          aria-hidden
          className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 text-2xl shadow-lg shadow-emerald-500/40 ring-1 ring-white/20"
        >
          ⚽
        </span>
        <h1 className="hero-title mb-1 text-neutral-100">
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
              className="w-full rounded-xl border border-white/[0.09] bg-white/[0.03] px-3 py-2.5 text-neutral-100 outline-none focus:border-emerald-500"
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
              className="w-full rounded-xl border border-white/[0.09] bg-white/[0.03] px-3 py-2.5 text-neutral-100 outline-none focus:border-emerald-500"
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
            className="btn-glow w-full px-3 py-2.5 disabled:opacity-60"
          >
            {pending ? "A entrar..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
