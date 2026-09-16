"use client";

import { useMemo, useState } from "react";

export type ComboItem = { id: string; name: string; countryName: string };
export type ComboCountry = { id: string; name: string };

interface EntityComboboxProps {
  label: string;
  placeholder: string;
  createLabel: string;
  items: ComboItem[];
  countries: ComboCountry[];
  value: ComboItem | null;
  onSelect: (item: ComboItem) => void;
  createAction: (
    name: string,
    countryId: string
  ) => Promise<{ id: string; name: string; country_id: string }>;
  onCreated: (item: ComboItem) => void;
}

export default function EntityCombobox({
  label,
  placeholder,
  createLabel,
  items,
  countries,
  value,
  onSelect,
  createAction,
  onCreated,
}: EntityComboboxProps) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newCountryId, setNewCountryId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 30);
    return items
      .filter((item) => item.name.toLowerCase().includes(q))
      .slice(0, 30);
  }, [items, query]);

  const exactMatch = items.some(
    (item) => item.name.toLowerCase() === query.trim().toLowerCase()
  );

  function selectItem(item: ComboItem) {
    onSelect(item);
    setQuery(item.name);
    setOpen(false);
    setCreating(false);
    setError(null);
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
    <div className="relative">
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
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-emerald-500"
      />

      {open && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl">
          {!creating ? (
            <>
              <ul className="max-h-56 overflow-y-auto">
                {filtered.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectItem(item)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-neutral-200 hover:bg-neutral-800"
                    >
                      <span>{item.name}</span>
                      <span className="text-xs text-neutral-500">
                        {item.countryName}
                      </span>
                    </button>
                  </li>
                ))}
                {filtered.length === 0 && (
                  <li className="px-3 py-2 text-sm text-neutral-500">
                    Sem resultados.
                  </li>
                )}
              </ul>
              {query.trim() && !exactMatch && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setCreating(true)}
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
                  onClick={() => setCreating(false)}
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
