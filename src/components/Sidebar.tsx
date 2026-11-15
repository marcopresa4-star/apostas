"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { signOut } from "@/app/(app)/actions";
import Icon from "@/components/Icon";
import { useHtmlAttr } from "@/components/ui";
import { NAV_GROUPS } from "@/lib/nav";
import { toggleNavMode, toggleTheme } from "@/lib/prefs";

// Every link is a leaf (no sub-routes), so an exact match is enough and avoids
// lighting "/estatisticas" on its sibling pages.
const isActive = (pathname: string, href: string) => pathname === href;

export default function Sidebar({
  userEmail,
  isAdmin,
}: {
  userEmail: string | null;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const theme = useHtmlAttr("theme");
  // Embedded panels (Vista Dinâmica iframes) drop the whole chrome: the
  // top-level tab owns navigation and the session. Server snapshot is false so
  // hydration matches.
  const embed = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return new URLSearchParams(window.location.search).get("embed") === "1";
      } catch {
        return false;
      }
    },
    () => false,
  );
  useEffect(() => {
    if (embed) document.documentElement.dataset.embed = "1";
  }, [embed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setDrawer(false);
    };
    const open = (): void => setDrawer(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("apostas:drawer", open);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("apostas:drawer", open);
    };
  }, []);

  if (!isAdmin || embed) return null;

  const initial = (userEmail ?? "?").charAt(0).toUpperCase();
  const light = theme === "light";
  const natal = theme === "natal";
  // The button shows what the NEXT click gives: dark → light → natal → dark.
  const next = light ? { label: "Natal", icon: "tree" as const } : natal ? { label: "Escuro", icon: "moon" as const } : { label: "Claro", icon: "sun" as const };

  return (
    <>
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-white/[0.06] bg-[#060a11]/80 px-4 backdrop-blur-2xl lg:hidden">
        <button
          type="button"
          aria-label="Abrir menu"
          aria-expanded={drawer}
          onClick={() => setDrawer(true)}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05]"
        >
          <Icon name="menu" />
        </button>
        <Link href="/" className="flex items-center gap-2 font-display text-lg font-bold">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/conde-icon.png" alt="" aria-hidden className="h-8 w-8 rounded-lg object-cover" />
          <span className="title-glow">Conde Analysis</span>
        </Link>
        <button
          type="button"
          aria-label="Pesquisar"
          onClick={() => window.dispatchEvent(new Event("apostas:palette"))}
          className="ml-auto mr-14 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05]"
        >
          <Icon name="search" className="h-4 w-4" />
        </button>
      </header>

      {drawer && (
        <button
          aria-label="Fechar menu"
          className="fixed inset-0 z-40 cursor-default bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setDrawer(false)}
        />
      )}

      <aside
        className={`side fixed inset-y-0 left-0 z-50 flex flex-col border-r border-white/[0.07] bg-[#050810]/90 shadow-[20px_0_60px_-30px_rgba(0,0,0,0.9)] backdrop-blur-2xl transition-[transform,width] duration-300 ease-out lg:translate-x-0 ${
          drawer ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-emerald-400/50 via-transparent to-sky-400/40" />

        <div className="rail-center flex h-16 shrink-0 items-center justify-between px-5">
          <Link href="/" className="group flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/conde-icon.png"
              alt=""
              aria-hidden
              className="h-11 w-11 shrink-0 rounded-2xl bg-gradient-to-br from-red-500/25 to-emerald-500/15 object-cover ring-1 ring-white/25 transition-transform group-hover:rotate-[-8deg] group-hover:scale-110"
            />
            <span className="rail-hide leading-none">
              <span className="title-glow block font-display text-xl font-bold tracking-tight">Conde Analysis</span>
            </span>
          </Link>
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setDrawer(false)}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-white/10 lg:hidden"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>

        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("apostas:palette"))}
            title="Pesquisar (Ctrl/⌘ K)"
            className="rail-center flex w-full items-center gap-2.5 rounded-xl border border-white/[0.09] bg-white/[0.04] px-3 py-2 text-left text-[13px] text-neutral-400 hover:border-emerald-400/40 hover:text-white"
          >
            <Icon name="search" className="h-4 w-4 shrink-0" />
            <span className="rail-hide flex-1">Pesquisar…</span>
            <kbd className="rail-hide rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-neutral-400">⌘K</kbd>
          </button>
        </div>

        <nav className="hover-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4 pt-1">
          {NAV_GROUPS.map((g) => (
            <div key={g.title}>
              <p className="rail-hide mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">{g.title}</p>
              <span aria-hidden className="rail-only mx-3 mb-1.5 block h-px bg-white/10" />
              <ul className="space-y-0.5">
                {g.items.map((it) => {
                  const active = isActive(pathname, it.href);
                  return (
                    <li key={it.href}>
                      <Link
                        href={it.href}
                        title={it.label}
                        aria-current={active ? "page" : undefined}
                        onClick={() => setDrawer(false)}
                        className={`rail-center group relative flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2 text-[13.5px] font-medium ${
                          active ? "text-white" : "text-neutral-400 hover:text-white"
                        }`}
                      >
                        {active && (
                          <>
                            <span aria-hidden className={`absolute inset-0 bg-gradient-to-r ${g.tone}`} />
                            <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-gradient-to-b from-emerald-300 to-cyan-400 shadow-[0_0_12px_rgba(52,211,153,0.9)]" />
                          </>
                        )}
                        <span aria-hidden className="absolute inset-0 rounded-xl bg-white/0 transition group-hover:bg-white/[0.05]" />
                        <span
                          aria-hidden
                          className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 transition group-hover:scale-110 ${
                            active ? "bg-white/15 text-emerald-200 ring-white/25" : "bg-white/[0.04] ring-white/[0.08]"
                          }`}
                        >
                          <Icon name={it.icon} className="h-[18px] w-[18px]" />
                          {it.live && (
                            <span className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-70" />
                              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                            </span>
                          )}
                        </span>
                        <span className="rail-hide relative">{it.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="shrink-0 space-y-2 border-t border-white/[0.07] p-3">
          <div className="rail-col flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleTheme}
              title={`Mudar para tema ${next.label.toLowerCase()}`}
              className="flex h-9 flex-1 items-center justify-center gap-2 rounded-xl border border-white/[0.09] bg-white/[0.04] text-xs text-neutral-300 hover:border-amber-300/40 hover:text-white"
            >
              <Icon name={next.icon} className="h-4 w-4" />
              <span className="rail-hide">{next.label}</span>
            </button>
            <button
              type="button"
              onClick={toggleNavMode}
              title="Recolher / expandir o menu"
              className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.09] bg-white/[0.04] text-neutral-300 hover:border-emerald-400/40 hover:text-white lg:flex"
            >
              <Icon name="panel" className="h-4 w-4" />
            </button>
          </div>
          <div className="glass-sm rail-center flex items-center gap-3 p-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-sky-500 text-sm font-bold text-white ring-2 ring-white/20">
              {initial}
            </span>
            <p className="rail-hide min-w-0 flex-1 truncate text-xs text-neutral-300" title={userEmail ?? ""}>
              {userEmail ?? "Sem sessão"}
            </p>
            <form action={signOut} className="rail-hide">
              <button
                type="submit"
                title="Sair"
                className="rounded-lg p-1.5 text-neutral-400 hover:bg-red-950/50 hover:text-red-300"
              >
                <Icon name="logout" className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}
