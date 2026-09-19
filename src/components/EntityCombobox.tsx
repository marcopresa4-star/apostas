"use client";

import { useEffect, useRef, useState } from "react";
import { searchEntities } from "@/app/(app)/actions";

export type ComboItem = { id: string; name: string; countryName: string };
export type ComboCountry = { id: string; name: string };

interface EntityComboboxProps {
  label: string;
  placeholder: string;
  createLabel: string;
  // Small list shown before typing (the ones already in use); with
  // searchTable, what you type is searched on the server across the whole base.
  items: ComboItem[];
  searchTable?: "teams" | "competitions";
  countries: ComboCountry[];
  value: ComboItem | null;
  onSelect: (item: ComboItem) => void;
  createAction: (
    name: string,
    countryId: string
  ) => Promise<{ id: string; name: string; country_id: string }>;
  onCreated: (item: ComboItem) => void;
  deleteAction?: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  onDeleted?: (id: string) => void;
}

export default function EntityCombobox({
  label,
  placeholder,
  createLabel,
  items,
  searchTable,
  countries,
  value,
  onSelect,
  createAction,
  onCreated,
  deleteAction,
  onDeleted,
}: EntityComboboxProps) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newCountryId, setNewCountryId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  // Results of the server search, tagged with the text they answer so a slow
  // reply for an older text is never shown for a newer one.
  const [remote, setRemote] = useState<{ query: string; items: ComboItem[] } | null>(null);
  const requestRef = useRef(0);
  const trimmed = query.trim();

  useEffect(() => {
    if (!searchTable || !open || !trimmed) return;
    const requestId = ++requestRef.current;
    const timer = setTimeout(async () => {
      let found: ComboItem[] = [];
      try {
        found = await searchEntities(searchTable, trimmed);
      } catch {
        // Offline or a failed request: fall back to the local list below.
      }
      if (requestRef.current === requestId) setRemote({ query: trimmed, items: found });
    }, 200);
    return () => clearTimeout(timer);
  }, [searchTable, open, trimmed]);

  const lowered = trimmed.toLowerCase();
  const serverReady = Boolean(searchTable && trimmed && remote?.query === trimmed);
  const searching = Boolean(searchTable && trimmed && !serverReady);
  // While the server answers, the games' own teams still filter instantly.
  const filtered = serverReady
    ? remote!.items
    : (lowered ? items.filter((item) => item.name.toLowerCase().includes(lowered)) : items).slice(0, 30);

  const exactMatch = (serverReady ? remote!.items : items).some(
    (item) => item.name.toLowerCase() === lowered
  );

  function selectItem(item: ComboItem) {
    onSelect(item);
    setQuery(item.name);
    setOpen(false);
    setCreating(false);
    setError(null);
  }

  async function handleDelete(item: ComboItem) {
    if (!deleteAction) return;
    if (!confirm(`Remover "${item.name}" da base de dados?`)) return;
    setDeletingId(item.id);
    setError(null);
    try {
      const res = await deleteAction(item.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDeleted?.(item.id);
      setRemote((prev) => (prev ? { ...prev, items: prev.items.filter((i) => i.id !== item.id) } : prev));
      if (value?.id === item.id) {
        onSelect({ id: "", name: "", countryName: "" });
        setQuery("");
      }
    } catch {
      setError("Não foi possível remover. Tenta novamente.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleCreate() {
    const name = query.trim();
    if (!name) {
      setError("Escreve um nome.");
      return;
    }
    if (!newCountryId) {
      setError("Seleciona o país.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createAction(name, newCountryId);
      const countryName =
        countries.find((c) => c.id === newCountryId)?.name ?? "";
      const item: ComboItem = {
        id: created.id,
        name: created.name,
        countryName,
      };
      onCreated(item);
      selectItem(item);
    } catch {
      setError("Não foi possível criar. Tenta novamente.");
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
          setCreating(false);
          if (value) onSelect({ id: "", name: "", countryName: "" });
        }}
        onFocus={() => setOpen(true)}
        className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-emerald-500"
      />

      {open && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl">
          {!creating ? (
            <>
              <ul className="max-h-56 overflow-y-auto">
                {filtered.map((item) => (
                  <li key={item.id} className="flex items-center">
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectItem(item)}
                      className="flex min-w-0 flex-1 items-center justify-between px-3 py-2 text-left text-sm text-neutral-200 hover:bg-neutral-800"
                    >
                      <span className="truncate">{item.name}</span>
                      <span className="ml-2 shrink-0 text-xs text-neutral-500">
                        {item.countryName}
                      </span>
                    </button>
                    {deleteAction && (
                      <button
                        type="button"
                        title={`Remover ${item.name}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleDelete(item)}
                        disabled={deletingId !== null}
                        className="shrink-0 px-2 py-2 text-neutral-600 hover:text-red-400 disabled:opacity-50"
                      >
                        {deletingId === item.id ? "…" : "✕"}
                      </button>
                    )}
                  </li>
                ))}
                {filtered.length === 0 && (
                  <li className="px-3 py-2 text-sm text-neutral-500">
                    {searching ? "A procurar…" : "Sem resultados."}
                  </li>
                )}
              </ul>
              {error && (
                <p className="border-t border-neutral-800 px-3 py-2 text-xs text-red-400">
                  {error}
                </p>
              )}
              {query.trim() && !exactMatch && !searching && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setCreating(true);
                    setError(null);
                  }}
                  className="w-full border-t border-neutral-800 px-3 py-2 text-left text-sm font-medium text-emerald-400 hover:bg-neutral-800"
                >
                  + {createLabel} &ldquo;{query.trim()}&rdquo;
                </button>
              )}
            </>
          ) : (
            <div className="p-3">
              <p className="mb-2 text-sm text-neutral-300">
                {createLabel} <span className="font-medium">&ldquo;{query.trim()}&rdquo;</span>
              </p>
              <select
                value={newCountryId}
                onMouseDown={(e) => e.stopPropagation()}
                onChange={(e) => setNewCountryId(e.target.value)}
                className="mb-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
              >
                <option value="">Seleciona o país...</option>
                {countries.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={handleCreate}
                  disabled={saving}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
                >
                  {saving ? "A criar..." : "Criar e selecionar"}
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setCreating(false);
                    setError(null);
                  }}
                  className="rounded-lg px-3 py-1.5 text-sm text-neutral-400 hover:text-white"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
