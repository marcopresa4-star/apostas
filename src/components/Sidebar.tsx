"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/(app)/actions";

const NAV_ITEMS = [
  {
    href: "/",
    label: "Jogos",
    icon: "🏠",
    chip: "bg-emerald-500/15 text-emerald-400",
    active: "bg-gradient-to-r from-emerald-600 to-emerald-500 shadow-lg shadow-emerald-600/30",
    adminOnly: true,
  },
  {
    href: "/estatisticas",
    label: "Estatísticas",
    icon: "🧮",
    chip: "bg-emerald-500/15 text-emerald-400",
    active: "bg-gradient-to-r from-emerald-600 to-emerald-500 shadow-lg shadow-emerald-600/30",
    adminOnly: true,
  },
  {
    href: "/bots",
    label: "Bots",
    icon: "🤖",
    chip: "bg-sky-500/15 text-sky-400",
    active: "bg-gradient-to-r from-sky-600 to-sky-500 shadow-lg shadow-sky-600/30",
    adminOnly: true,
  },
  {
    href: "/value",
    label: "Value Bets",
    icon: "💎",
    chip: "bg-emerald-500/15 text-emerald-400",
    active: "bg-gradient-to-r from-emerald-600 to-emerald-500 shadow-lg shadow-emerald-600/30",
    adminOnly: true,
  },
  {
    href: "/previsoes",
    label: "Previsões do dia",
    icon: "🔮",
    chip: "bg-violet-500/15 text-violet-300",
    active: "bg-gradient-to-r from-violet-600 to-violet-500 shadow-lg shadow-violet-600/30",
    adminOnly: true,
  },
  {
    href: "/feed",
    label: "Em direto",
    icon: "📡",
    chip: "bg-red-500/15 text-red-400",
    active: "bg-gradient-to-r from-red-600 to-red-500 shadow-lg shadow-red-600/30",
    adminOnly: true,
  },
  {
    href: "/estatisticas/ao-vivo",
    label: "Ao vivo agora",
    icon: "🔴",
    chip: "bg-red-500/15 text-red-400",
    active: "bg-gradient-to-r from-red-600 to-red-500 shadow-lg shadow-red-600/30",
    adminOnly: true,
  },
];

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Sidebar({
  userEmail,
  isAdmin,
}: {
  userEmail: string | null;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const visibleItems = NAV_ITEMS.filter((item) => isAdmin || !item.adminOnly);

  return (
    <header className="sticky top-0 z-30 border-b border-neutral-800/80 bg-neutral-900/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-[96rem] items-center gap-3 px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-lg font-semibold text-neutral-100">
          <span aria-hidden className="text-xl">⚽</span>
          <span className="hidden whitespace-nowrap sm:inline">Apostas</span>
        </Link>
        <nav className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {visibleItems.map((item) => {
            const active = isActivePath(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-medium whitespace-nowrap transition ${
                  active ? `${item.active} text-white` : "text-neutral-400 hover:bg-neutral-800/80 hover:text-white"
                }`}
              >
                <span aria-hidden className={`flex h-6 w-6 items-center justify-center rounded-lg text-xs ${active ? "bg-white/15" : item.chip}`}>
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        {userEmail && (
          <p className="hidden max-w-48 truncate text-xs text-neutral-500 lg:block" title={userEmail}>
            {userEmail}
          </p>
        )}
        <form action={signOut}>
          <button
            type="submit"
            title="Sair"
            className="shrink-0 rounded-xl px-3 py-1.5 text-sm text-neutral-400 transition hover:bg-red-950/40 hover:text-red-300"
          >
            🚪 <span className="hidden sm:inline">Sair</span>
          </button>
        </form>
      </div>
    </header>
  );
}
