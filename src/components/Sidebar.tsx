"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "@/app/(app)/actions";
import SearchPalette from "./SearchPalette";

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
    chip: "bg-amber-500/15 text-amber-400",
    active: "bg-gradient-to-r from-amber-600 to-amber-500 shadow-lg shadow-amber-600/30",
    adminOnly: true,
  },
  {
    href: "/apostas",
    label: "Apostas",
    icon: "🎯",
    chip: "bg-sky-500/15 text-sky-400",
    active: "bg-gradient-to-r from-sky-600 to-sky-500 shadow-lg shadow-sky-600/30",
    adminOnly: true,
  },
];

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  item,
  active,
  onClick,
}: {
  item: (typeof NAV_ITEMS)[number] & { pulse?: boolean };
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={`group relative flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
        active
          ? `${item.active} text-white`
          : "text-neutral-400 hover:translate-x-0.5 hover:bg-neutral-800/80 hover:text-white"
      }`}
    >
      <span
        className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm transition-colors ${
          active ? "bg-white/15" : item.chip
        }`}
      >
        <span aria-hidden>{item.icon}</span>
        {item.pulse && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-red-500 ring-2 ring-neutral-900"
          />
        )}
      </span>
      <span className="whitespace-nowrap">{item.label}</span>
      {active && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1 rounded-r-full bg-white/40"
        />
      )}
    </Link>
  );
}

export default function Sidebar({
  userEmail,
  isAdmin,
}: {
  userEmail: string | null;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const homeHref = "/";
  const visibleItems = NAV_ITEMS.filter((item) => isAdmin || !item.adminOnly);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-neutral-800/80 bg-neutral-900/80 px-4 py-3 backdrop-blur-md md:hidden">
        <Link
          href={homeHref}
          className="flex items-center gap-1.5 text-lg font-semibold text-neutral-100"
          onClick={() => setOpen(false)}
        >
          <span aria-hidden>⚽</span> Apostas
        </Link>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          className="rounded-lg p-1.5 text-xl text-neutral-300 transition hover:bg-neutral-800"
        >
          {open ? "✕" : "☰"}
        </button>
      </div>

      {open && (
        <nav className="space-y-1 border-b border-neutral-800 bg-neutral-900 px-3 py-3 md:hidden">
          {visibleItems.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={isActivePath(pathname, item.href)}
              onClick={() => setOpen(false)}
            />
          ))}
          <form action={signOut}>
            <button
              type="submit"
              className="mt-1 block w-full rounded-xl px-3 py-2.5 text-left text-sm text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
            >
              🚪 Sair
            </button>
          </form>
        </nav>
      )}

      {/* Desktop sidebar — always open (the layout reserves its 14rem) */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-56 flex-col overflow-hidden border-r border-neutral-800/80 bg-neutral-900/80 backdrop-blur-md md:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-48 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/30 via-transparent to-transparent"
        />
        <Link
          href={homeHref}
          className="flex items-center gap-2 px-5 py-5 text-lg font-semibold text-neutral-100"
        >
          <span aria-hidden className="text-xl">⚽</span>
          <span className="whitespace-nowrap">Apostas</span>
        </Link>
        <nav className="flex-1 space-y-1.5 px-3">
          {visibleItems.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={isActivePath(pathname, item.href)}
            />
          ))}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-neutral-400 transition-all duration-200 hover:translate-x-0.5 hover:bg-neutral-800/80 hover:text-white"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-neutral-800 text-sm transition-colors">
              <span aria-hidden>🔍</span>
            </span>
            <span className="whitespace-nowrap">Pesquisar</span>
            <kbd className="ml-auto rounded border border-neutral-700 px-1.5 text-[10px] text-neutral-500">⌘K</kbd>
          </button>
        </nav>
        <div className="border-t border-neutral-800/80 p-3">
          {userEmail && (
            <p className="mb-2 truncate whitespace-nowrap px-1 text-xs text-neutral-500" title={userEmail}>
              {userEmail}
            </p>
          )}
          <form action={signOut}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-neutral-400 transition hover:bg-red-950/40 hover:text-red-300"
            >
              <span aria-hidden>🚪</span>
              <span className="whitespace-nowrap">Sair</span>
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
