"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOut } from "@/app/(app)/actions";

const NAV_ITEMS = [
  {
    href: "/",
    label: "Dashboard",
    icon: "🏠",
    chip: "bg-emerald-500/15 text-emerald-400",
    active: "bg-gradient-to-r from-emerald-600 to-emerald-500 shadow-lg shadow-emerald-600/30",
    adminOnly: true,
  },
  {
    href: "/apostas",
    label: "Apostas",
    icon: "🎟️",
    chip: "bg-emerald-500/15 text-emerald-400",
    active: "bg-gradient-to-r from-emerald-600 to-emerald-500 shadow-lg shadow-emerald-600/30",
    adminOnly: true,
  },
  {
    href: "/live",
    label: "Live",
    icon: "📡",
    chip: "bg-sky-500/15 text-sky-400",
    active: "bg-gradient-to-r from-sky-600 to-sky-500 shadow-lg shadow-sky-600/30",
    pulse: true,
    adminOnly: true,
  },
  {
    href: "/analise",
    label: "Análise",
    icon: "📊",
    chip: "bg-violet-500/15 text-violet-400",
    active: "bg-gradient-to-r from-violet-600 to-violet-500 shadow-lg shadow-violet-600/30",
    adminOnly: true,
  },
  {
    href: "/comunidade",
    label: "Comunidade",
    icon: "🌐",
    chip: "bg-orange-500/15 text-orange-400",
    active: "bg-gradient-to-r from-orange-600 to-orange-500 shadow-lg shadow-orange-600/30",
    adminOnly: false,
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
  collapsible = false,
}: {
  item: (typeof NAV_ITEMS)[number];
  active: boolean;
  onClick?: () => void;
  collapsible?: boolean;
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
      <span
        className={
          collapsible
            ? "whitespace-nowrap opacity-0 transition-opacity duration-200 group-hover/sidebar:opacity-100 group-focus-within/sidebar:opacity-100"
            : "whitespace-nowrap"
        }
      >
        {item.label}
      </span>
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
  const homeHref = isAdmin ? "/" : "/comunidade";
  const visibleItems = NAV_ITEMS.filter((item) => isAdmin || !item.adminOnly);

  return (
    <>
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

      {/* Desktop sidebar — collapsed to an icon rail, expands on hover */}
      <aside className="group/sidebar fixed inset-y-0 left-0 z-20 hidden w-16 flex-col overflow-hidden border-r border-neutral-800/80 bg-neutral-900/80 backdrop-blur-md transition-[width] duration-300 ease-in-out hover:w-56 focus-within:w-56 md:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-48 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/30 via-transparent to-transparent"
        />
        <Link
          href={homeHref}
          className="flex items-center gap-2 px-5 py-5 text-lg font-semibold text-neutral-100"
        >
          <span aria-hidden className="text-xl">⚽</span>
          <span className="whitespace-nowrap opacity-0 transition-opacity duration-200 group-hover/sidebar:opacity-100 group-focus-within/sidebar:opacity-100">
            Apostas
          </span>
        </Link>
        <nav className="flex-1 space-y-1.5 px-3">
          {visibleItems.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={isActivePath(pathname, item.href)}
              collapsible
            />
          ))}
        </nav>
        <div className="border-t border-neutral-800/80 p-3">
          {userEmail && (
            <p
              className="mb-2 truncate whitespace-nowrap px-1 text-xs text-neutral-500 opacity-0 transition-opacity duration-200 group-hover/sidebar:opacity-100 group-focus-within/sidebar:opacity-100"
              title={userEmail}
            >
              {userEmail}
            </p>
          )}
          <form action={signOut}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-neutral-400 transition hover:bg-red-950/40 hover:text-red-300"
            >
              <span aria-hidden>🚪</span>
              <span className="whitespace-nowrap opacity-0 transition-opacity duration-200 group-hover/sidebar:opacity-100 group-focus-within/sidebar:opacity-100">
                Sair
              </span>
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
