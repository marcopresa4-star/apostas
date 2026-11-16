"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon, { type IconName } from "@/components/Icon";

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Jogos", icon: "home" },
  { href: "/estatisticas", label: "Comparar", icon: "scale" },
  { href: "/estatisticas/ao-vivo", label: "Ao vivo", icon: "live" },
  { href: "/value", label: "Value", icon: "gem" },
];

// Thumb-reach navigation on phones; the centre "Ao vivo" button is the hero.
export default function MobileNav() {
  const pathname = usePathname();
  const tab = (t: (typeof TABS)[number], center = false) => {
    const active = pathname === t.href;
    if (center) {
      return (
        <Link key={t.href} href={t.href} className="relative -mt-6 flex flex-col items-center gap-1">
          <span className={`flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-rose-700 text-white shadow-[0_10px_30px_-6px_rgba(239,68,68,0.8)] ring-4 ring-[#050810] ${active ? "scale-105" : ""}`}>
            <Icon name={t.icon} className="h-6 w-6" />
          </span>
          <span className="text-xs font-semibold text-red-300">{t.label}</span>
        </Link>
      );
    }
    return (
      <Link key={t.href} href={t.href} className={`flex flex-1 flex-col items-center gap-1 py-1 ${active ? "text-sky-300" : "text-neutral-400"}`}>
        <Icon name={t.icon} className="h-5 w-5" />
        <span className="text-xs font-medium">{t.label}</span>
      </Link>
    );
  };
  return (
    <nav className="mobile-nav fixed inset-x-0 bottom-0 z-30 flex items-end justify-around border-t border-white/10 bg-[#050810]/90 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-2xl lg:hidden">
      {tab(TABS[0])}
      {tab(TABS[1])}
      {tab(TABS[2], true)}
      {tab(TABS[3])}
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("apostas:drawer"))}
        className="flex flex-1 flex-col items-center gap-1 py-1 text-neutral-400"
      >
        <Icon name="menu" className="h-5 w-5" />
        <span className="text-xs font-medium">Menu</span>
      </button>
    </nav>
  );
}
