"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Icon, { type IconName } from "@/components/Icon";
import { CountUp } from "@/components/ui";

const SHORTCUTS: { href: string; icon: IconName; title: string; text: string; hue: string }[] = [
  { href: "/estatisticas/ao-vivo", icon: "live", title: "Ao vivo agora", text: "Tudo o que está a decorrer", hue: "from-red-500/25" },
  { href: "/estatisticas", icon: "scale", title: "Comparar equipas", text: "Previsão e valor por jogo", hue: "from-emerald-500/25" },
  { href: "/value", icon: "gem", title: "Value Bets", text: "Onde as odds pagam bem", hue: "from-cyan-500/25" },
  { href: "/planeamento", icon: "plan", title: "Planeamento Live", text: "Prepara o dia de jogos", hue: "from-violet-500/25" },
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
    <section className="mb-6 max-w-[96rem]">
      <div className="hero-banner relative overflow-hidden rounded-3xl border border-white/10 p-6 sm:p-8">
        <div aria-hidden className="hero-orb hero-orb-a" />
        <div aria-hidden className="hero-orb hero-orb-b" />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              Painel ativo
            </p>
            <h1 className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
              {now ? greeting(now.getHours()) : "Olá"},<br />
              <span className="title-glow">hora de analisar.</span>
            </h1>
            <p className="mt-3 max-w-xl text-sm text-neutral-300/90">
              Segue jogos em direto, compara equipas e encontra valor antes do apito. O widget de cada jogo aparece aqui à hora do jogo.
            </p>
          </div>
          <div className="shrink-0 text-left sm:text-right">
            <p className="font-mono text-4xl font-semibold tabular-nums tracking-tight text-white sm:text-5xl">{time}</p>
            <p className="mt-1 text-sm capitalize text-neutral-400">{date}</p>
            <div className="mt-4 flex gap-3 sm:justify-end">
              <div className="tile rounded-2xl px-4 py-2.5 text-left">
                <p className="font-display text-2xl font-bold text-amber-300"><CountUp value={following} /></p>
                <p className="text-[10px] uppercase tracking-wider text-neutral-400">★ A seguir</p>
              </div>
              <div className="tile rounded-2xl px-4 py-2.5 text-left">
                <p className="font-display text-2xl font-bold text-emerald-300"><CountUp value={watching} /></p>
                <p className="text-[10px] uppercase tracking-wider text-neutral-400">Em acompanhamento</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {SHORTCUTS.map((s) => (
          <Link key={s.href} href={s.href} className="tile group relative overflow-hidden rounded-2xl p-4">
            <span aria-hidden className={`absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br ${s.hue} to-transparent blur-2xl transition-all duration-500 group-hover:scale-150`} />
            <span className="relative flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.07] text-emerald-300 ring-1 ring-white/10 transition group-hover:-rotate-6 group-hover:scale-110"><Icon name={s.icon} className="h-6 w-6" /></span>
              <span>
                <span className="block font-display text-[15px] font-semibold text-white">{s.title}</span>
                <span className="block text-xs text-neutral-400">{s.text}</span>
              </span>
              <Icon name="arrow" className="ml-auto h-5 w-5 text-neutral-500 transition group-hover:translate-x-1 group-hover:text-emerald-300" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
