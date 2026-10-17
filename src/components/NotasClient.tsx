"use client";

// Free-text notepad (Ferramentas → Notas): autosave with a short debounce,
// a pending-visibility flush (tab hidden or blurred = save now, typed text
// must not die in the debounce window) and one retry button on failure.
// One row in user_notes per user; no tactical board, just the pad.
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { saveNotaAction } from "@/app/(app)/notas/actions";

const DEBOUNCE_MS = 900;
const MAX = 100_000;

export default function NotasClient({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  const [state, setState] = useState<"limpa" | "guardar" | "guardado" | "falhou">("limpa");
  const [savedAt, setSavedAt] = useState("");
  const [error, setError] = useState("");
  const dirty = useRef(false);
  const textRef = useRef(text);
  textRef.current = text;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveNow = async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setState("guardar");
    const got = await saveNotaAction(textRef.current);
    if (got.ok) {
      dirty.current = false;
      setState("guardado");
      const n = new Date();
      setSavedAt(`${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`);
      setError("");
      return true;
    }
    setState("falhou");
    setError(got.error);
    return false;
  };

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    const next = e.target.value.slice(0, MAX);
    setText(next);
    dirty.current = true;
    setState("guardar");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void saveNow();
    }, DEBOUNCE_MS);
  };

  useEffect(() => {
    const flush = (): void => {
      if (dirty.current) void saveNow();
    };
    const onHidden = (): void => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("blur", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("blur", flush);
      if (timer.current) clearTimeout(timer.current);
    };
    // saveNow is a stable-by-construction closure over refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const label =
    state === "guardado"
      ? `Guardado ✓ ${savedAt}`
      : state === "guardar"
        ? "A guardar…"
        : state === "falhou"
          ? "Falhou o guardar"
          : "";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <p
          className={`text-xs ${
            state === "falhou" ? "text-red-400" : state === "guardado" ? "text-emerald-400" : "text-neutral-500"
          }`}
        >
          {label || (text.length > 0 ? "Sem alterações" : "\u00a0")}
        </p>
        <button
          type="button"
          onClick={() => void saveNow()}
          title="Guardar já"
          className="shrink-0 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:border-emerald-500 hover:text-emerald-300"
        >
          Guardar
        </button>
      </div>
      <textarea
        value={text}
        onChange={onChange}
        maxLength={MAX}
        spellCheck
        placeholder="Escreve aqui as tuas notas: jogos a seguir, ideias de apostas, lembretes…"
        className="min-h-[38rem] w-full flex-1 resize-y rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-emerald-500"
      />
      {state === "falhou" && (
        <button
          type="button"
          onClick={() => void saveNow()}
          className="self-start rounded-lg border border-red-500/50 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/40"
        >
          Tentar de novo — {error}
        </button>
      )}
      <p className="text-[11px] text-neutral-600">
        {text.length}/{MAX} caracteres · fica na tua conta no Supabase (mesmo texto no telemóvel e no PC).
      </p>
    </div>
  );
}
