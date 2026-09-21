"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/estatisticas", label: "Comparar equipas" },
  { href: "/estatisticas/jornada", label: "Jogos da jornada" },
  { href: "/estatisticas/classificacao", label: "Classificação e força" },
  { href: "/estatisticas/fiabilidade", label: "Fiabilidade" },
  { href: "/estatisticas/live", label: "Calculadora live" },
];

export default function EstatisticasTabs() {
  const pathname = usePathname();

  return (
    <nav className="mb-6 flex flex-wrap gap-2">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              active
                ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40"
                : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
