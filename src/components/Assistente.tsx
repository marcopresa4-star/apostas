"use client";

import Link from "next/link";
import { useState } from "react";
import {
  SUGESTOES,
  diaMes,
  fair2,
  pct1,
  type JogoResposta,
  type RespostaAssistente,
} from "@/lib/assistente";

// Floating assistant (top-right, every page): local Q&A over the site's own
// data — today's games, live games, one matchup's model odds, bots, pages.
// No LLM: the API route parses with rules and answers with real numbers only.
function GameRow({ g }: { g: JogoResposta }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-100">
          {g.live && g.minute !== null && g.minute !== undefined && (
            <span className="mr-1.5 rounded bg-red-600/20 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-red-400">
              {g.minute}′
            </span>
          )}
          {g.time && <span className="mr-1.5 tabular-nums text-neutral-500">{g.time.slice(0, 5)}</span>}
          {g.home} <span className="text-neutral-600">vs</span> {g.away}
        </p>
        {typeof g.hg === "number" && typeof g.ag === "number" && (
          <span className="shrink-0 text-[13px] font-bold tabular-nums text-neutral-100">
            {g.hg}–{g.ag}
          </span>
        )}
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-[11px] text-neutral-500">
          {g.league}
          {g.date ? ` · ${diaMes(g.date)}` : ""}
        </p>
        {g.href ? (
          <Link href={g.href} className="shrink-0 text-[11px] font-medium text-emerald-400 hover:underline">
            comparar
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
    </div>
  );
}

interface Msg {
  from: "eu" | "bot";
  resposta?: RespostaAssistente;
  erro?: string;
}

export default function Assistente() {
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [aCarregar, setACarregar] = useState(false);

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
        body: JSON.stringify({ pergunta }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as RespostaAssistente;
      setMsgs((m) => [...m, { from: "bot", resposta: data }]);
    } catch {
      setMsgs((m) => [...m, { from: "bot", erro: "Não consegui responder agora. Tenta de novo." }]);
    } finally {
      setACarregar(false);
    }
  };

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col items-end">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-label="Assistente"
        className="flex h-11 w-11 items-center justify-center rounded-full border border-emerald-700/60 bg-neutral-900 text-lg shadow-lg shadow-black/50 transition hover:border-emerald-500"
      >
        {aberto ? "✕" : "◔"}
      </button>
      {aberto && (
        <div className="mt-2 flex max-h-[75vh] w-[min(92vw,24rem)] flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-white/[0.04] shadow-2xl shadow-black/60">
          <p className="border-b border-white/[0.07] px-4 py-2.5 text-[13px] font-semibold text-neutral-200">
            Assistente <span className="font-normal text-neutral-500">· jogos e modelo</span>
          </p>
          <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
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
                      {m.resposta?.jogos.map((g, j) => <GameRow key={`${g.eventId ?? j}|${g.home}|${g.away}`} g={g} />)}
                      {m.resposta && m.resposta.links.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 px-1">
                          {m.resposta.links.map((l) => (
                            <Link
                              key={l.href}
                              href={l.href}
                              className="rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500"
                            >
                              {l.label}
                            </Link>
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
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Pergunta-me por jogos…"
              className="min-w-0 flex-1 rounded-lg border border-white/[0.09] bg-white/[0.03] px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-emerald-500"
            />
            <button
              type="submit"
              disabled={aCarregar}
              className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              ➤
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
