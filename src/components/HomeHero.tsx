"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Icon, { type IconName } from "@/components/Icon";
import { CountUp } from "@/components/ui";

const SHORTCUTS: { href: string; icon: IconName; title: string; text: string; live?: boolean }[] = [
  { href: "/estatisticas/ao-vivo", icon: "live", title: "Ao vivo agora", text: "Tudo o que está a decorrer", live: true },
  { href: "/estatisticas", icon: "scale", title: "Comparar equipas", text: "Previsão e valor por jogo" },
  { href: "/value", icon: "gem", title: "Value Bets", text: "Onde as odds pagam bem" },
  { href: "/planeamento", icon: "plan", title: "Planeamento Live", text: "Prepara o dia de jogos" },
];

function greeting(h: number): string {
  if (h < 6) return "Boa madrugada";
  if (h < 13) return "Bom dia";
  if (h < 20) return "Boa tarde";
  return "Boa noite";
}

export default function HomeHero({ following, watching }: { following: number; watching: number }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setNow(new Date()), 0);
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

  const time = now?.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) ?? "--:--:--";
  const date = now?.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" }) ?? "";

  return (
    <section className="mb-5 max-w-[96rem]">
      <div className="home-bar">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
            {now ? greeting(now.getHours()) : "Olá"}, <span className="title-glow">hora de analisar.</span>
          </h1>
          <p className="mt-1 text-sm capitalize text-neutral-400">
            {date} · <span className="font-mono tabular-nums text-neutral-200">{time}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <div className="glass-sm px-3 py-1.5">
            <p className="font-display text-xl font-bold leading-tight text-amber-300"><CountUp value={following} /></p>
            <p className="text-xs text-neutral-400">★ A seguir</p>
          </div>
          <div className="glass-sm px-3 py-1.5">
            <p className="font-display text-xl font-bold leading-tight text-sky-300"><CountUp value={watching} /></p>
            <p className="text-xs text-neutral-400">Em acompanhamento</p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {SHORTCUTS.map((s) => (
          <Link key={s.href} href={s.href} className="chip-link" title={s.text}>
            <Icon name={s.icon} className={`h-4 w-4 ${s.live ? "text-red-400" : "text-sky-300"}`} />
            {s.title}
          </Link>
        ))}
      </div>
    </section>
  );
}
