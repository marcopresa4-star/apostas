"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import Icon, { type IconName } from "@/components/Icon";
import { NAV_GROUPS } from "@/lib/nav";
import { toggleNavMode, toggleTheme } from "@/lib/prefs";

interface Entry {
  label: string;
  hint: string;
  icon: IconName;
  run: (go: (href: string) => void) => void;
}

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const ENTRIES: Entry[] = [
  ...NAV_GROUPS.flatMap((g) =>
    g.items.map<Entry>((it) => ({ label: it.label, hint: g.title, icon: it.icon, run: (go) => go(it.href) })),
  ),
  { label: "Mudar tema (escuro / claro / natalício)", hint: "Ação", icon: "sun", run: () => toggleTheme() },
  { label: "Recolher / expandir o menu", hint: "Ação", icon: "panel", run: () => toggleNavMode() },
];

// Ctrl/⌘+K: jump to any page or run an action in two keystrokes.
export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const show = (): void => {
      setQ("");
      setIdx(0);
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => {
          if (!o) {
            setQ("");
            setIdx(0);
          }
          return !o;
        });
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("apostas:palette", show);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("apostas:palette", show);
    };
  }, []);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const results = useMemo(() => {
    const n = plain(q.trim());
    return n === "" ? ENTRIES : ENTRIES.filter((e) => plain(`${e.label} ${e.hint}`).includes(n));
  }, [q]);

  if (!open) return null;

  const go = (href: string): void => {
    setOpen(false);
    router.push(href);
  };
  const choose = (e: Entry | undefined): void => {
    if (!e) return;
    setOpen(false);
    e.run(go);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[14vh]" role="dialog" aria-modal="true" aria-label="Pesquisar">
      <button aria-label="Fechar" className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="pop-in glass-accent relative w-full max-w-xl overflow-hidden !rounded-2xl">
        <div className="flex items-center gap-3 border-b border-white/10 px-4">
          <Icon name="search" className="h-5 w-5 shrink-0 text-emerald-300" />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIdx((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIdx((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                choose(results[idx]);
              }
            }}
            placeholder="Ir para… (ex.: value, bots, ao vivo)"
            className="h-14 w-full bg-transparent text-[15px] text-neutral-100 outline-none placeholder:text-neutral-500"
            style={{ boxShadow: "none" }}
          />
          <kbd className="rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-neutral-400">esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-neutral-500">Nada encontrado.</li>}
          {results.map((e, i) => (
            <li key={`${e.hint}-${e.label}`}>
              <button
                type="button"
                onMouseEnter={() => setIdx(i)}
                onClick={() => choose(e)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm ${
                  i === idx ? "bg-emerald-500/15 text-white" : "text-neutral-300"
                }`}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06] ring-1 ring-white/10">
                  <Icon name={e.icon} className="h-4 w-4" />
                </span>
                <span className="flex-1">{e.label}</span>
                <span className="text-[11px] uppercase tracking-wider text-neutral-500">{e.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
