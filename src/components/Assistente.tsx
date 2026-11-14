"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  SUGESTOES,
  diaMes,
  fair2,
  pct1,
  type JogoResposta,
  type RespostaAssistente,
  type TabelaResposta,
} from "@/lib/assistente";

// Floating assistant (top-right, every page): local Q&A over the site's own
// data — today's games, live games, results, table, round, one matchup's
// model odds, bots, pages. No LLM: the API route parses with rules and
// answers with real numbers only.

const RESULT_STYLE: Record<"V" | "E" | "D", string> = {
  V: "bg-emerald-500/15 text-emerald-300",
  E: "bg-neutral-500/15 text-neutral-300",
  D: "bg-red-500/15 text-red-300",
};

function FormChips({ form }: { form?: ("V" | "E" | "D")[] }) {
  if (!form || form.length === 0) return null;
  return (
    <span className="inline-flex gap-0.5 align-middle">
      {form.map((r, i) => (
        <span
          key={i}
          title={r === "V" ? "Vitória" : r === "E" ? "Empate" : "Derrota"}
          className={`inline-flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold ${RESULT_STYLE[r]}`}
        >
          {r}
        </span>
      ))}
    </span>
  );
}

function GameRow({ g }: { g: JogoResposta }) {
  const score = typeof g.hg === "number" && typeof g.ag === "number";
  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-100">
          {g.live && g.minute !== null && g.minute !== undefined && (
            <span className="mr-1.5 rounded bg-red-600/20 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-red-400">
              {g.minute}′
            </span>
          )}
          {g.finished && (
            <span className="mr-1.5 rounded bg-neutral-500/20 px-1.5 py-0.5 text-[10px] font-bold text-neutral-300">
              FT
            </span>
          )}
          {!g.live && !g.finished && g.time && (
            <span className="mr-1.5 tabular-nums text-neutral-500">{g.time.slice(0, 5)}</span>
          )}
          {g.home} <span className="text-neutral-600">vs</span> {g.away}
        </p>
        <span className="flex shrink-0 items-center gap-1.5">
          {score && (
            <span className="text-[13px] font-bold tabular-nums text-neutral-100">
              {g.hg}–{g.ag}
            </span>
          )}
          {g.resultado && (
            <span
              title={g.resultado === "V" ? "Vitória" : g.resultado === "E" ? "Empate" : "Derrota"}
              className={`inline-flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold ${RESULT_STYLE[g.resultado]}`}
            >
              {g.resultado}
            </span>
          )}
        </span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-[11px] text-neutral-500">
          {g.league}
          {g.date ? ` · ${diaMes(g.date)}` : ""}
        </p>
        {g.href ? (
          <Link href={g.href} className="shrink-0 text-[11px] font-medium text-emerald-400 hover:underline">
            {g.live ? "abrir" : "comparar"}
          </Link>
        ) : null}
      </div>
      {typeof g.pHome === "number" && typeof g.pDraw === "number" && typeof g.pAway === "number" && (
        <p className="mt-1 text-[11px] tabular-nums text-neutral-400">
          <span className="font-semibold text-emerald-400">{pct1(g.pHome)}</span> ·{" "}
          <span className="text-neutral-300">{pct1(g.pDraw)}</span> ·{" "}
          <span className="font-semibold text-sky-300">{pct1(g.pAway)}</span>{" "}
          <span className="text-neutral-600">(justas {fair2(g.pHome)}/{fair2(g.pAway)})</span>
        </p>
      )}
      {g.nota && <p className="mt-0.5 text-[11px] text-neutral-500">{g.nota}</p>}
    </div>
  );
}

function MiniTable({ t }: { t: TabelaResposta }) {
  return (
    <div className="overflow-hidden rounded-lg border border-white/[0.07]">
      <p className="border-b border-white/[0.07] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-semibold text-neutral-300">
        {t.titulo}
      </p>
      <table className="w-full text-[11px] tabular-nums">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-neutral-600">
            <th className="py-1 pl-2.5 pr-1 text-left font-medium">#</th>
            <th className="px-1 py-1 text-left font-medium">Equipa</th>
            <th className="px-1 py-1 text-right font-medium">J</th>
            <th className="px-1 py-1 text-right font-medium">DG</th>
            <th className="px-1 py-1 text-right font-medium">Pts</th>
            <th className="py-1 pl-1 pr-2.5 text-left font-medium">Forma</th>
          </tr>
        </thead>
        <tbody>
          {t.linhas.map((l) => (
            <tr
              key={`${l.pos}-${l.team}`}
              className={l.destaque ? "bg-emerald-500/[0.08] text-neutral-100" : "text-neutral-400"}
            >
              <td className="py-1 pl-2.5 pr-1 text-neutral-500">{l.pos}</td>
              <td className={`max-w-[8.5rem] truncate px-1 py-1 ${l.destaque ? "font-semibold" : ""}`}>{l.team}</td>
              <td className="px-1 py-1 text-right text-neutral-500">{l.jogos}</td>
              <td className="px-1 py-1 text-right text-neutral-500">{l.dg > 0 ? `+${l.dg}` : l.dg}</td>
              <td className="px-1 py-1 text-right font-semibold text-neutral-200">{l.pontos}</td>
              <td className="py-1 pl-1 pr-2.5">
                <FormChips form={l.forma} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Msg {
  from: "eu" | "bot";
  resposta?: RespostaAssistente;
  erro?: string;
}

type Ctx = { equipa?: string; liga?: string; dia?: string };

export default function Assistente() {
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [aCarregar, setACarregar] = useState(false);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (aberto) inputRef.current?.focus();
  }, [aberto]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, aCarregar, aberto]);

  useEffect(() => {
    if (!aberto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aberto]);

  const perguntar = async (texto: string) => {
    const pergunta = texto.trim();
    if (!pergunta || aCarregar) return;
    setQ("");
    setMsgs((m) => [...m, { from: "eu", resposta: { resumo: pergunta, jogos: [], links: [] } }]);
    setACarregar(true);
    try {
      const res = await fetch("/api/assistente", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pergunta, contexto: ctx }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as RespostaAssistente;
      setMsgs((m) => [...m, { from: "bot", resposta: data }]);
      if (data.contexto) setCtx(data.contexto);
    } catch {
      setMsgs((m) => [...m, { from: "bot", erro: "Não consegui responder agora. Tenta de novo." }]);
    } finally {
      setACarregar(false);
    }
  };

  const limpar = () => {
    setMsgs([]);
    setCtx(null);
    setQ("");
    inputRef.current?.focus();
  };

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col items-end">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-label="Assistente"
        aria-expanded={aberto}
        className="logo-pulse flex h-11 w-11 items-center justify-center rounded-full border border-emerald-400/50 bg-gradient-to-br from-emerald-500/30 to-sky-500/20 text-lg text-emerald-100 shadow-lg shadow-black/50 backdrop-blur-md transition hover:scale-110 hover:border-emerald-300"
      >
        {aberto ? "✕" : "◔"}
      </button>
      {aberto && (
        <div className="mt-2 flex max-h-[75vh] w-[min(92vw,25rem)] flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0a0f18]/90 shadow-2xl shadow-black/60 backdrop-blur-2xl">
          <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-4 py-2.5">
            <p className="text-[13px] font-semibold text-neutral-200">
              Assistente <span className="font-normal text-neutral-500">· jogos e modelo</span>
            </p>
            {msgs.length > 0 && (
              <button
                type="button"
                onClick={limpar}
                className="text-[11px] font-medium text-neutral-500 transition hover:text-neutral-200"
              >
                Nova conversa
              </button>
            )}
          </div>
          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3" aria-live="polite">
            {msgs.length === 0 && (
              <div className="flex flex-wrap gap-1.5">
                {SUGESTOES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => perguntar(s)}
                    className="rounded-full border border-white/[0.09] px-2.5 py-1 text-xs text-neutral-300 transition hover:border-emerald-500 hover:text-neutral-100"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {msgs.map((m, i) =>
              m.from === "eu" ? (
                <p key={i} className="ml-8 rounded-xl bg-emerald-600/20 px-3 py-2 text-[13px] text-neutral-100">
                  {m.resposta?.resumo}
                </p>
              ) : (
                <div key={i} className="mr-4 space-y-1.5">
                  {m.erro ? (
                    <p className="rounded-xl bg-red-950 px-3 py-2 text-[13px] text-red-300">{m.erro}</p>
                  ) : (
                    <>
                      <p className="rounded-xl bg-white/[0.03] px-3 py-2 text-[13px] leading-relaxed text-neutral-200">
                        {m.resposta?.resumo}
                      </p>
                      {m.resposta?.tabela && <MiniTable t={m.resposta.tabela} />}
                      {m.resposta?.jogos.map((g, j) => <GameRow key={`${g.eventId ?? j}|${g.home}|${g.away}`} g={g} />)}
                      {m.resposta && m.resposta.notas && m.resposta.notas.length > 0 && (
                        <ul className="space-y-0.5 px-1 text-[11px] leading-relaxed text-neutral-500">
                          {m.resposta.notas.map((n, k) => (
                            <li key={k}>{n}</li>
                          ))}
                        </ul>
                      )}
                      {m.resposta && m.resposta.links.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 px-1">
                          {m.resposta.links.map((l) => (
                            <Link key={l.href} href={l.href} className="btn-glow rounded-full px-2.5 py-1 text-xs">
                              {l.label}
                            </Link>
                          ))}
                        </div>
                      )}
                      {m.resposta && m.resposta.sugestoes && m.resposta.sugestoes.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 px-1">
                          {m.resposta.sugestoes.slice(0, 4).map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => perguntar(s)}
                              className="rounded-full border border-white/[0.09] px-2.5 py-1 text-[11px] text-neutral-400 transition hover:border-emerald-500 hover:text-neutral-100"
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            )}
            {aCarregar && <p className="text-xs text-neutral-500">A pensar…</p>}
          </div>
          <form
            className="flex gap-2 border-t border-white/[0.07] p-2"
            onSubmit={(e) => {
              e.preventDefault();
              perguntar(q);
            }}
          >
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Pergunta-me por jogos, equipas, jornada…"
              aria-label="Pergunta ao assistente"
              className="min-w-0 flex-1 rounded-lg border border-white/[0.09] bg-white/[0.03] px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-emerald-500"
            />
            <button type="submit" disabled={aCarregar} className="btn-glow shrink-0 px-3 py-2 text-sm disabled:opacity-50">
              ➤
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
