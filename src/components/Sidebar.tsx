"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/(app)/actions";

interface NavLink {
  kind: "link";
  href: string;
  label: string;
  icon: string;
  chip: string;
  active: string;
  adminOnly: boolean;
}

interface NavMenu {
  kind: "menu";
  id: string;
  label: string;
  icon: string;
  chip: string;
  active: string;
  adminOnly: boolean;
  items: { href: string; label: string; icon: string }[];
}

type NavEntry = NavLink | NavMenu;

const NAV: NavEntry[] = [
  {
    kind: "link",
    href: "/",
    label: "Jogos",
    icon: "🏠",
    chip: "bg-emerald-500/15 text-emerald-400",
    active: "bg-gradient-to-r from-emerald-600 to-emerald-500 shadow-lg shadow-emerald-600/30",
    adminOnly: true,
  },
  {
    kind: "menu",
    id: "est",
    label: "Estatísticas",
    icon: "🧮",
    chip: "bg-emerald-500/15 text-emerald-400",
    active: "bg-gradient-to-r from-emerald-600 to-emerald-500 shadow-lg shadow-emerald-600/30",
    adminOnly: true,
    items: [
      { href: "/estatisticas", label: "Comparar equipas", icon: "⚖️" },
      { href: "/estatisticas/jogos-dia", label: "Jogos por dia", icon: "📅" },
      { href: "/estatisticas/jornada", label: "Jogos da jornada", icon: "🗓️" },
      { href: "/estatisticas/live", label: "Calculadora live", icon: "🧮" },
      { href: "/estatisticas/classificacao", label: "Classificação e força", icon: "📊" },
    ],
  },
  {
    kind: "link",
    href: "/estatisticas/ao-vivo",
    label: "Ao vivo agora",
    icon: "🔴",
    chip: "bg-red-500/15 text-red-400",
    active: "bg-gradient-to-r from-red-600 to-red-500 shadow-lg shadow-red-600/30",
    adminOnly: true,
  },
  {
    kind: "link",
    href: "/feed",
    label: "Em direto",
    icon: "📡",
    chip: "bg-red-500/15 text-red-400",
    active: "bg-gradient-to-r from-red-600 to-red-500 shadow-lg shadow-red-600/30",
    adminOnly: true,
  },
  {
    kind: "menu",
    id: "fer",
    label: "Ferramentas",
    icon: "🛠️",
    chip: "bg-sky-500/15 text-sky-400",
    active: "bg-gradient-to-r from-sky-600 to-sky-500 shadow-lg shadow-sky-600/30",
    adminOnly: true,
    items: [
      { href: "/bots", label: "Bots", icon: "🤖" },
      { href: "/value", label: "Value Bets", icon: "💎" },
      { href: "/previsoes", label: "Previsões do dia", icon: "🔮" },
      { href: "/multiplas", label: "Múltiplas", icon: "🎲" },
    ],
  },
  {
    kind: "menu",
    id: "def",
    label: "Definições",
    icon: "⚙️",
    chip: "bg-neutral-500/15 text-neutral-400",
    active: "bg-gradient-to-r from-neutral-600 to-neutral-500 shadow-lg shadow-neutral-600/30",
    adminOnly: true,
    items: [
      { href: "/estatisticas/calibracao", label: "Calibração", icon: "🎯" },
      { href: "/estatisticas/mapa", label: "Mapa SofaScore", icon: "🗺️" },
    ],
  },
  {
    kind: "link",
    href: "/vista",
    label: "Vista Dinâmica",
    icon: "◧",
    chip: "bg-violet-500/15 text-violet-300",
    active: "bg-gradient-to-r from-violet-600 to-violet-500 shadow-lg shadow-violet-600/30",
    adminOnly: true,
  },
];

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Menu children have no sub-routes: exact match avoids lighting the parent
// on sibling pages that share the prefix (e.g. /estatisticas/ao-vivo).
function isActiveChild(pathname: string, href: string) {
  return pathname === href;
}

export default function Sidebar({
  userEmail,
  isAdmin,
}: {
  userEmail: string | null;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  // Embedded panels (Vista Dinâmica iframes) hide the sign-out button: the
  // top-level tab owns the session. Post-mount so hydration matches.
  const [embed, setEmbed] = useState(false);
  useEffect(() => {
    try {
      setEmbed(new URLSearchParams(window.location.search).get("embed") === "1");
    } catch {
      // No URL access: show everything.
    }
  }, []);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  // A new page always closes the menu.
  useEffect(() => {
    setOpen(null);
  }, [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  // The nav scrolls horizontally: an absolutely-positioned panel would be
  // clipped, so dropdowns are viewport-fixed from the button rect and close
  // on any scroll.
  useEffect(() => {
    if (open === null) return;
    const close = (): void => setOpen(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open ]);
  const toggle = (id: string): void => {
    if (open === id) {
      setOpen(null);
      return;
    }
    const el = btnRefs.current[id];
    if (el) {
      const r = el.getBoundingClientRect();
      setPos({ left: Math.max(8, r.left), top: r.bottom + 4 });
    }
    setOpen(id);
  };

  const visible = NAV.filter((item) => isAdmin || !item.adminOnly);
  const pill =
    "flex shrink-0 items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-medium whitespace-nowrap transition";

  return (
    <header className="sticky top-0 z-30 border-b border-neutral-800/80 bg-neutral-900/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-[96rem] items-center gap-3 px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-lg font-semibold text-neutral-100">
          <span aria-hidden className="text-xl">⚽</span>
          <span className="hidden whitespace-nowrap sm:inline">Apostas</span>
        </Link>
        <nav className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {visible.map((item) => {
            if (item.kind === "link") {
              const active = isActivePath(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${pill} ${
                    active ? `${item.active} text-white` : "text-neutral-400 hover:bg-neutral-800/80 hover:text-white"
                  }`}
                >
                  <span aria-hidden className={`flex h-6 w-6 items-center justify-center rounded-lg text-xs ${active ? "bg-white/15" : item.chip}`}>
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              );
            }
            const active = item.items.some((s) => isActiveChild(pathname, s.href));
            const isOpen = open === item.id;
            return (
              <div key={item.id} className="relative shrink-0">
                <button
                  ref={(el) => {
                    btnRefs.current[item.id] = el;
                  }}
                  type="button"
                  onClick={() => toggle(item.id)}
                  aria-expanded={isOpen}
                  className={`${pill} ${
                    active || isOpen
                      ? `${item.active} text-white`
                      : "text-neutral-400 hover:bg-neutral-800/80 hover:text-white"
                  }`}
                >
                  <span aria-hidden className={`flex h-6 w-6 items-center justify-center rounded-lg text-xs ${active || isOpen ? "bg-white/15" : item.chip}`}>
                    {item.icon}
                  </span>
                  {item.label}
                  <span aria-hidden className={`text-[10px] transition-transform ${isOpen ? "rotate-180" : ""}`}>▾</span>
                </button>
                {isOpen && pos && (
                  <div
                    className="fixed z-50 w-60 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950/98 py-1 shadow-2xl backdrop-blur-md"
                    style={{ left: pos.left, top: pos.top }}
                  >
                    {item.items.map((s) => {
                      const sub = isActiveChild(pathname, s.href);
                      return (
                        <Link
                          key={s.href}
                          href={s.href}
                          className={`flex items-center gap-2.5 px-3 py-2 text-sm transition ${
                            sub ? "bg-emerald-500/15 font-medium text-emerald-300" : "text-neutral-300 hover:bg-neutral-800 hover:text-white"
                          }`}
                        >
                          <span aria-hidden className="text-sm">{s.icon}</span>
                          {s.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        {open !== null && (
          <button aria-label="Fechar menu" className="fixed inset-0 z-20 cursor-default" onClick={() => setOpen(null)} />
        )}
        {userEmail && (
          <p className="hidden max-w-48 truncate text-xs text-neutral-500 lg:block" title={userEmail}>
            {userEmail}
          </p>
        )}
        {!embed && (
          <form action={signOut}>
            <button
              type="submit"
              title="Sair"
              className="shrink-0 rounded-xl px-3 py-1.5 text-sm text-neutral-400 transition hover:bg-red-950/40 hover:text-red-300"
            >
              🚪 <span className="hidden sm:inline">Sair</span>
            </button>
          </form>
        )}
      </div>
    </header>
  );
}
