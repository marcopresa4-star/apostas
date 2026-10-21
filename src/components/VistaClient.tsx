"use client";

import { useState } from "react";

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
  { href: "/notas", label: "Notas" },
  { href: "/bots", label: "Bots" },
  { href: "/planeamento", label: "Planeamento Live" },
];

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
  // Empty until chosen: mounting an iframe loads the whole page behind it
  // (Jogos por dia takes minutes on cold cache), so nothing loads unasked.
  const view = VIEWS.find((v) => v.href === value) ?? null;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden glass">
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-3 py-2">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{side}</span>
        <select
          value={view?.href ?? ""}
          onChange={(e) => onChange(e.target.value)}
          title={`Conteúdo do painel ${side}`}
          className="min-w-0 flex-1 truncate rounded-lg border border-white/[0.09] bg-white/[0.03] px-2 py-1.5 text-xs text-neutral-200 outline-none"
        >
          <option value="">Escolher o que vai aqui…</option>
          {VIEWS.map((v) => (
            <option key={v.href} value={v.href}>
              {v.label}
            </option>
          ))}
        </select>
        {view && (
          <a
            href={view.href}
            target="_blank"
            rel="noreferrer"
            title={`Abrir ${view.label} num separador`}
            className="shrink-0 rounded-lg border border-white/[0.09] px-2 py-1.5 text-xs text-neutral-400 hover:text-neutral-200"
          >
            ↗
          </a>
        )}
      </div>
      {view ? (
        <iframe
          key={view.href}
          src={withEmbed(view.href)}
          title={view.label}
          className="min-h-[32rem] w-full flex-1 border-0"
          style={{ height: "calc(100vh - 16rem)" }}
        />
      ) : (
        <p className="flex min-h-[16rem] flex-1 items-center justify-center px-4 text-center text-sm text-neutral-600">
          Escolhe em cima o que vai neste painel — nada carrega sem pedires.
        </p>
      )}
    </div>
  );
}

// Split screen: two live site panels side by side, each with its own view.
// Same-origin iframes share the session; embedded frames don't run the
// global watchers (the top-level tab already does). Panels start EMPTY and
// only load after choosing: mounting an iframe loads the whole page behind
// it, so nothing heavy runs unasked.
export default function VistaClient() {
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");

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
          className="rounded-xl border border-white/[0.09] bg-white/[0.04] px-3 py-2 text-sm text-neutral-300 transition hover:border-white/[0.18] hover:text-white"
        >
          ⇄
        </button>
      </div>
      <Panel side="Direita" value={right} onChange={setRight} />
      </div>
    </div>
  );
}
