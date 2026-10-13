"use client";

import { useEffect, useState } from "react";

const VIEWS: { href: string; label: string }[] = [
  { href: "/estatisticas/jogos-dia", label: "Jogos por dia" },
  { href: "/feed", label: "Em direto" },
  { href: "/estatisticas/ao-vivo", label: "Ao vivo agora" },
  { href: "/estatisticas/live", label: "Calculadora live" },
  { href: "/estatisticas", label: "Comparar equipas" },
  { href: "/estatisticas/jornada", label: "Jogos da jornada" },
  { href: "/estatisticas/classificacao", label: "Classificação e força" },
  { href: "/value", label: "Value Bets" },
  { href: "/previsoes", label: "Previsões do dia" },
  { href: "/multiplas", label: "Múltiplas" },
  { href: "/bots", label: "Bots" },
];

const LS_KEY = "apostas:vista";

const withEmbed = (href: string): string => (href.includes("?") ? `${href}&embed=1` : `${href}?embed=1`);

function Panel({
  side,
  value,
  onChange,
}: {
  side: string;
  value: string;
  onChange: (href: string) => void;
}) {
  const view = VIEWS.find((v) => v.href === value) ?? VIEWS[0];
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{side}</span>
        <select
          value={view.href}
          onChange={(e) => onChange(e.target.value)}
          title={`Conteúdo do painel ${side}`}
          className="min-w-0 flex-1 truncate rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-200 outline-none"
        >
          {VIEWS.map((v) => (
            <option key={v.href} value={v.href}>
              {v.label}
            </option>
          ))}
        </select>
        <a
          href={view.href}
          target="_blank"
          rel="noreferrer"
          title={`Abrir ${view.label} num separador`}
          className="shrink-0 rounded-lg border border-neutral-700 px-2 py-1.5 text-xs text-neutral-400 hover:text-neutral-200"
        >
          ↗
        </a>
      </div>
      <iframe
        key={view.href}
        src={withEmbed(view.href)}
        title={view.label}
        className="min-h-[32rem] w-full flex-1 border-0"
        style={{ height: "calc(100vh - 16rem)" }}
      />
    </div>
  );
}

// Split screen: two live site panels side by side, each with its own view.
// Same-origin iframes share the session; embedded frames don't run the
// global watchers (the top-level tab already does).
export default function VistaClient() {
  const [left, setLeft] = useState(VIEWS[0].href);
  const [right, setRight] = useState(VIEWS[1].href);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as { left?: string; right?: string };
      if (typeof p.left === "string" && VIEWS.some((v) => v.href === p.left)) setLeft(p.left);
      if (typeof p.right === "string" && VIEWS.some((v) => v.href === p.right)) setRight(p.right);
    } catch {
      // No saved split.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify({ left, right }));
    } catch {
      // Private mode: split just doesn't persist.
    }
  }, [left, right]);

  return (
    // Break out of the page max-width: the split uses the full viewport.
    <div className="relative left-1/2 w-screen max-w-[100vw] -translate-x-1/2 px-1">
      <div className="flex min-h-0 flex-col gap-2 lg:h-[calc(100vh-9rem)] lg:flex-row">
      <Panel side="Esquerda" value={left} onChange={setLeft} />
      <div className="flex shrink-0 items-center justify-center">
        <button
          type="button"
          onClick={() => {
            setLeft(right);
            setRight(left);
          }}
          title="Trocar os painéis"
          className="rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-300 transition hover:border-neutral-500 hover:text-white"
        >
          ⇄
        </button>
      </div>
      <Panel side="Direita" value={right} onChange={setRight} />
      </div>
    </div>
  );
}
