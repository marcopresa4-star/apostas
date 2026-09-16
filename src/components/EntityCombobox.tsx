"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionResult } from "@/lib/actionResult";

export type ComboItem = { id: string; name: string; countryName: string };
export type ComboCountry = { id: string; name: string };
type RemoteItem = { id: number; name: string; country: string };

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
  /** When provided, results are searched live from an external source
   * (e.g. API-Football) instead of filtering the local `items` list. */
  remoteSearch?: (query: string) => Promise<ActionResult<RemoteItem[]>>;
  /** Resolves a picked remote result into a row in our own database
   * (creating it if needed) — required when `remoteSearch` is set. */
  resolveRemote?: (name: string, apiCountry: string) => Promise<ActionResult<ComboItem>>;
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
  remoteSearch,
  resolveRemote,
}: EntityComboboxProps) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newCountryId, setNewCountryId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [remoteResults, setRemoteResults] = useState<RemoteItem[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<number | null>(null);

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

  useEffect(() => {
    if (!open || !remoteSearch) return;
    const q = query.trim();
    if (q.length < 3) return;

    const handle = setTimeout(() => {
      setRemoteLoading(true);
      setRemoteError(null);
      remoteSearch(q)
        .then((res) => {
          if (res.ok) setRemoteResults(res.data);
          else setRemoteError(res.error);
        })
        .catch(() => setRemoteError("Pesquisa falhou."))
        .finally(() => setRemoteLoading(false));
    }, 400);
    return () => clearTimeout(handle);
  }, [query, open, remoteSearch]);

  const filtered = useMemo(() => {
    if (remoteSearch) return [];
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 30);
    return items.filter((item) => item.name.toLowerCase().includes(q)).slice(0, 30);
  }, [items, query, remoteSearch]);

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

  async function handleSelectRemote(item: RemoteItem) {
    if (!resolveRemote) return;
    setResolvingId(item.id);
    setRemoteError(null);
    try {
      const res = await resolveRemote(item.name, item.country);
      if (!res.ok) {
        setRemoteError(res.error);
        return;
      }
      onCreated(res.data);
      selectItem(res.data);
    } catch {
      setRemoteError("Não foi possível selecionar. Tenta novamente.");
    } finally {
      setResolvingId(null);
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
        className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-emerald-500"
      />

      {open && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl">
          {!creating ? (
            <>
              {remoteSearch ? (
                <ul className="max-h-56 overflow-y-auto">
                  {query.trim().length < 3 && (
                    <li className="px-3 py-2 text-sm text-neutral-500">
                      Escreve pelo menos 3 letras...
                    </li>
                  )}
                  {query.trim().length >= 3 && remoteLoading && (
                    <li className="px-3 py-2 text-sm text-neutral-500">A procurar...</li>
                  )}
                  {remoteError && (
                    <li className="px-3 py-2 text-sm text-red-400">{remoteError}</li>
                  )}
                  {!remoteLoading &&
                    !remoteError &&
                    remoteResults.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleSelectRemote(item)}
                          disabled={resolvingId !== null}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                        >
                          <span>{item.name}</span>
                          <span className="text-xs text-neutral-500">
                            {resolvingId === item.id ? "A adicionar..." : item.country}
                          </span>
                        </button>
                      </li>
                    ))}
                  {!remoteLoading &&
                    !remoteError &&
                    query.trim().length >= 3 &&
                    remoteResults.length === 0 && (
                      <li className="px-3 py-2 text-sm text-neutral-500">Sem resultados.</li>
                    )}
                </ul>
              ) : (
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
                        <span className="text-xs text-neutral-500">{item.countryName}</span>
                      </button>
                    </li>
                  ))}
                  {filtered.length === 0 && (
                    <li className="px-3 py-2 text-sm text-neutral-500">Sem resultados.</li>
                  )}
                </ul>
              )}
              {query.trim() && !exactMatch && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setCreating(true)}
                  className="w-full border-t border-neutral-800 px-3 py-2 text-left text-sm font-medium text-emerald-400 hover:bg-neutral-800"
                >
                  + {createLabel} manualmente &ldquo;{query.trim()}&rdquo;
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
