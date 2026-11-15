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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/conde-icon.png"
          alt=""
          aria-hidden
          className="mb-4 h-16 w-16 rounded-2xl bg-gradient-to-br from-red-500/25 to-emerald-500/15 object-cover ring-1 ring-white/20"
        />
        <h1 className="hero-title mb-1 text-neutral-100">
          <span className="title-glow">Conde Analysis</span>
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
