"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/estatisticas", label: "Comparar equipas" },
  { href: "/estatisticas/jornada", label: "Jogos da jornada" },
  { href: "/estatisticas/classificacao", label: "Classificação e força" },
  { href: "/estatisticas/live", label: "Calculadora live" },
  { href: "/estatisticas/calibracao", label: "Calibração" },
  { href: "/estatisticas/ao-vivo", label: "Ao vivo agora" },
  { href: "/estatisticas/mapa", label: "Mapa SofaScore" },
];

export default function EstatisticasTabs() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-14 z-10 -mx-4 mb-6 flex gap-2 overflow-x-auto bg-neutral-950/90 px-4 py-2 backdrop-blur-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              active
                ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40"
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
