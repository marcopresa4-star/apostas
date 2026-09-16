"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOut } from "@/app/(app)/actions";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: "🏠" },
  { href: "/apostas", label: "Apostas", icon: "🎟️" },
  { href: "/live", label: "Live", icon: "🔴" },
];

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Sidebar({ userEmail }: { userEmail: string | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-neutral-800/80 bg-neutral-900/80 px-4 py-3 backdrop-blur-md md:hidden">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-lg font-semibold text-neutral-100"
          onClick={() => setOpen(false)}
        >
          <span aria-hidden>⚽</span> Apostas
        </Link>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          className="rounded-lg p-1.5 text-xl text-neutral-300 hover:bg-neutral-800"
        >
          {open ? "✕" : "☰"}
        </button>
      </div>

      {open && (
        <nav className="border-b border-neutral-800 bg-neutral-900 px-3 py-2 md:hidden">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
                isActivePath(pathname, item.href)
                  ? "bg-emerald-600 text-white"
                  : "text-neutral-300 hover:bg-neutral-800"
              }`}
            >
              <span aria-hidden>{item.icon}</span> {item.label}
            </Link>
          ))}
          <form action={signOut}>
            <button
              type="submit"
              className="mt-1 block w-full rounded-lg px-3 py-2 text-left text-sm text-neutral-400 hover:bg-neutral-800"
            >
              Sair
            </button>
          </form>
        </nav>
      )}

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-56 flex-col border-r border-neutral-800/80 bg-neutral-900/80 backdrop-blur-md md:flex">
        <Link href="/" className="flex items-center gap-1.5 px-5 py-4 text-lg font-semibold text-neutral-100">
          <span aria-hidden>⚽</span> Apostas
        </Link>
        <nav className="flex-1 space-y-1 px-3">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActivePath(pathname, item.href)
                  ? "bg-emerald-600 text-white"
                  : "text-neutral-300 hover:bg-neutral-800"
              }`}
            >
              <span aria-hidden>{item.icon}</span> {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-neutral-800 p-3">
          {userEmail && (
            <p className="mb-2 truncate px-1 text-xs text-neutral-500" title={userEmail}>
              {userEmail}
            </p>
          )}
          <form action={signOut}>
            <button
              type="submit"
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
            >
              Sair
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
