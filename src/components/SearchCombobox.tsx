"use client";

import { useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/app/(app)/analise/actions";

interface SearchItem {
  id: number;
  name: string;
}

export default function SearchCombobox<T extends SearchItem>({
  label,
  placeholder,
  value,
  onSelect,
  searchAction,
  renderSubtitle,
}: {
  label: string;
  placeholder: string;
  value: T | null;
  onSelect: (item: T | null) => void;
  searchAction: (query: string) => Promise<ActionResult<T[]>>;
  renderSubtitle?: (item: T) => string;
}) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 3) return;

    const handle = setTimeout(() => {
      setLoading(true);
      setError(null);
      searchAction(q)
        .then((r) => {
          if (r.ok) setResults(r.data);
          else setError(r.error);
        })
        .catch(() => setError("Pesquisa falhou."))
        .finally(() => setLoading(false));
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open]);

  function selectItem(item: T) {
    onSelect(item);
    setQuery(item.name);
    setOpen(false);
  }

  return (
    <div className="relative" ref={containerRef}>
      <label className="mb-1 block text-sm text-neutral-300">{label}</label>
      <input
        type="text"
        value={query}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (value) onSelect(null);
        }}
        onFocus={() => setOpen(true)}
        className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-emerald-500"
      />

      {open && query.trim().length >= 3 && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl">
          {loading && <p className="px-3 py-2 text-sm text-neutral-500">A procurar...</p>}
          {error && <p className="px-3 py-2 text-sm text-red-400">{error}</p>}
          {!loading && !error && (
            <ul className="max-h-56 overflow-y-auto">
              {results.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectItem(item)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-neutral-200 hover:bg-neutral-800"
                  >
                    <span>{item.name}</span>
                    {renderSubtitle && (
                      <span className="text-xs text-neutral-500">{renderSubtitle(item)}</span>
                    )}
                  </button>
                </li>
              ))}
              {results.length === 0 && (
                <li className="px-3 py-2 text-sm text-neutral-500">Sem resultados.</li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
