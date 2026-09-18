"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/comunidade", label: "🎟️ Apostas" },
  { href: "/comunidade/analise", label: "📊 Análise" },
];

export default function CommunityTabs() {
  const pathname = usePathname();

  return (
    <nav className="mb-6 flex gap-2">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              active
                ? "bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/40"
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
