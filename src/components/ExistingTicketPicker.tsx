"use client";

import { useEffect, useRef, useState } from "react";

export interface TicketOption {
  id: string;
  label: string;
  subtitle: string;
}

export default function ExistingTicketPicker({
  items,
  value,
  onSelect,
}: {
  items: TicketOption[];
  value: TicketOption | null;
  onSelect: (item: TicketOption | null) => void;
}) {
  const [query, setQuery] = useState(value?.label ?? "");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const filtered = items
    .filter((i) => i.label.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 30);

  function selectItem(item: TicketOption) {
    onSelect(item);
    setQuery(item.label);
    setOpen(false);
  }

  return (
    <div className="relative" ref={containerRef}>
      <label className="mb-1 block text-sm text-neutral-300">Jogo já registado</label>
      <input
        type="text"
        value={query}
        placeholder="Pesquisar por equipa..."
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (value) onSelect(null);
        }}
        onFocus={() => setOpen(true)}
        className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-emerald-500"
      />
      {open && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl">
          <ul className="max-h-56 overflow-y-auto">
            {filtered.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectItem(item)}
                  className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-neutral-800"
                >
                  <span className="text-neutral-200">{item.label}</span>
                  <span className="text-xs text-neutral-500">{item.subtitle}</span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-neutral-500">Sem resultados.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
