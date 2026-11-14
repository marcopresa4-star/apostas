import type { IconName } from "@/components/Icon";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  live?: boolean;
}

export interface NavGroup {
  title: string;
  tone: string; // gradient painted behind the active item of the group
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Principal",
    tone: "from-emerald-500/30 via-emerald-500/10 to-transparent",
    items: [
      { href: "/", label: "Jogos", icon: "home" },
      { href: "/resumo", label: "Resumo do dia", icon: "news" },
      { href: "/estatisticas/ao-vivo", label: "Ao vivo agora", icon: "live", live: true },
      { href: "/feed", label: "Em direto", icon: "broadcast", live: true },
      { href: "/vista", label: "Vista Dinâmica", icon: "layout" },
    ],
  },
  {
    title: "Estatísticas",
    tone: "from-sky-500/30 via-sky-500/10 to-transparent",
    items: [
      { href: "/estatisticas", label: "Comparar equipas", icon: "scale" },
      { href: "/estatisticas/equipa", label: "Análise equipa", icon: "search" },
      { href: "/estatisticas/jogos-dia", label: "Jogos por dia", icon: "calendar" },
      { href: "/estatisticas/jornada", label: "Jogos da jornada", icon: "rounds" },
      { href: "/estatisticas/live", label: "Calculadora live", icon: "calc" },
      { href: "/estatisticas/classificacao", label: "Classificação e força", icon: "chart" },
    ],
  },
  {
    title: "Ferramentas",
    tone: "from-sky-500/30 via-sky-500/10 to-transparent",
    items: [
      { href: "/bots", label: "Bots", icon: "bot" },
      { href: "/planeamento", label: "Planeamento Live", icon: "plan" },
      { href: "/notas", label: "Notas", icon: "note" },
      { href: "/value", label: "Value Bets", icon: "gem" },
      { href: "/previsoes", label: "Previsões do dia", icon: "sparkle" },
      { href: "/multiplas", label: "Múltiplas", icon: "dice" },
    ],
  },
  {
    title: "Sistema",
    tone: "from-neutral-400/25 via-neutral-400/10 to-transparent",
    items: [
      { href: "/estatisticas/calibracao", label: "Calibração", icon: "target" },
      { href: "/estatisticas/mapa", label: "Mapa SofaScore", icon: "map" },
    ],
  },
];
