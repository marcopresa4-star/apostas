"use client";

import { useEffect, useRef, useState } from "react";

export interface TagItem {
  id: string;
  name: string;
}

export default function CategoryCombobox({
  label,
  placeholder,
  items,
  value,
  onSelect,
  createAction,
  onCreated,
}: {
  label: string;
  placeholder: string;
  items: TagItem[];
  value: TagItem | null;
  onSelect: (item: TagItem | null) => void;
  createAction: (name: string) => Promise<TagItem>;
  onCreated: (item: TagItem) => void;
}) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
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
    .filter((i) => i.name.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 30);
  const exactMatch = items.some((i) => i.name.toLowerCase() === query.trim().toLowerCase());

  function selectItem(item: TagItem) {
    onSelect(item);
    setQuery(item.name);
    setOpen(false);
  }

  async function handleCreate() {
    const name = query.trim();
    if (!name) return;
    setSaving(true);
    try {
      const created = await createAction(name);
      onCreated(created);
      selectItem(created);
    } finally {
      setSaving(false);
    }
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
      {open && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl">
          <ul className="max-h-56 overflow-y-auto">
            {filtered.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectItem(item)}
                  className="block w-full px-3 py-2 text-left text-sm text-neutral-200 hover:bg-neutral-800"
                >
                  {item.name}
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-neutral-500">Sem resultados.</li>
            )}
          </ul>
          {query.trim() && !exactMatch && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleCreate}
              disabled={saving}
              className="w-full border-t border-neutral-800 px-3 py-2 text-left text-sm font-medium text-emerald-400 hover:bg-neutral-800 disabled:opacity-60"
            >
              {saving ? "A criar..." : `+ Criar categoria "${query.trim()}"`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
