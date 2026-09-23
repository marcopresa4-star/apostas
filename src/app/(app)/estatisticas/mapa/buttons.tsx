"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { autoAlignAllTeamsAction, autoAlignTeamsAction, autoMapAllAction, auditIntlMapsAction, bootstrapIntlTeamsAction, deleteSofaMapAction, deleteSofaTeamAction, repairWrongIntlAction, saveSofaTeamAction, saveSofaTournamentAction } from "./actions";
import type { SofaCandidate } from "@/lib/sofaHistory";

const SAVE =
  "rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60";

export function SaveMapButton({ leagueCode: liga, candidate }: { leagueCode: string; candidate: SofaCandidate }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <span className="text-right">
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await saveSofaTournamentAction(liga, candidate.uniqueId ?? 0, candidate.name, candidate.slug);
            if (result.ok) router.refresh();
            else setError(result.error);
          })
        }
        className={SAVE}
      >
        {isPending ? "A guardar…" : "Mapear"}
      </button>
      {error && <span className="mt-1 block text-[11px] text-red-400">{error}</span>}
    </span>
  );
}

export function DeleteMapButton({ leagueCode }: { leagueCode: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await deleteSofaMapAction(leagueCode);
          router.refresh();
        })
      }
      className="text-xs text-neutral-500 hover:text-red-400 hover:underline disabled:opacity-60"
    >
      Remover
    </button>
  );
}

export function AutoMapAllButton() {  const [isPending, startTransition] = useTransition();
  const [report, setReport] = useState<{ mapped: number; skipped: string[] } | null>(null);
  const router = useRouter();
  return (
    <span>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setReport(null);
            const result = await autoMapAllAction();
            setReport({ mapped: result.mapped.length, skipped: result.skipped.map((s) => s.label) });
            router.refresh();
          })
        }
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
      >
        {isPending ? "A mapear… (pode demorar um minuto)" : "Mapear todas automaticamente"}
      </button>
      {report && (
        <span className="mt-1 block text-xs text-neutral-400">
          Mapeadas {report.mapped} ligas.
          {report.skipped.length > 0 ? ` Por mapear à mão: ${report.skipped.join("; ")}.` : " Nada por mapear à mão."}
        </span>
      )}
    </span>
  );
}

export function AlignTeamsButton({ leagueCode }: { leagueCode: string }) {
  const [isPending, startTransition] = useTransition();
  const [report, setReport] = useState<{ aligned: number; pending: string[] } | null>(null);
  const router = useRouter();
  return (
    <span>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setReport(null);
            const result = await autoAlignTeamsAction(leagueCode);
            if (result.ok) setReport({ aligned: result.aligned.length, pending: result.pending });
            else setReport({ aligned: 0, pending: [result.error] });
            router.refresh();
          })
        }
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
      >
        {isPending ? "A alinhar…" : "Alinhar equipas automaticamente"}
      </button>
      {report && (
        <span className="mt-1 block text-xs text-neutral-400">
          Alinhadas {report.aligned}.
          {report.pending.length > 0 ? ` Por ligar à mão: ${report.pending.join(", ")}.` : ""}
        </span>
      )}
    </span>
  );
}

export function SaveTeamButton({ localSlug, localName, candidate }: { localSlug: string; localName: string; candidate: SofaCandidate }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <span className="text-right">
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await saveSofaTeamAction(localSlug, localName, candidate.id, candidate.name, candidate.slug);
            if (result.ok) router.refresh();
            else setError(result.error);
          })
        }
        className={SAVE}
      >
        {isPending ? "A guardar…" : "Ligar"}
      </button>
      {error && <span className="mt-1 block text-[11px] text-red-400">{error}</span>}
    </span>
  );
}

export function DeleteTeamButton({ localSlug }: { localSlug: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            try {
              await deleteSofaTeamAction(localSlug);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Falhou.");
            }
            router.refresh();
          })
        }
        className="text-xs text-neutral-500 hover:text-red-400 hover:underline disabled:opacity-60"
      >
        Desligar
      </button>
      {error && <span className="block text-[11px] text-red-400">{error}</span>}
    </span>
  );
}

export function BootstrapIntlButton() {
  const [isPending, startTransition] = useTransition();
  const [report, setReport] = useState<{ mapped: number; pending: string[]; repaired: number } | null>(null);
  const router = useRouter();
  return (
    <span>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setReport(null);
            const result = await bootstrapIntlTeamsAction();
            setReport({ mapped: result.mapped.length, pending: result.pending, repaired: result.repaired });
            router.refresh();
          })
        }
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
      >
        {isPending ? "A ligar seleções… (pode demorar uns minutos)" : "Ligar seleções automaticamente"}
      </button>
      {report && (
        <span className="mt-1 block max-w-2xl text-xs leading-relaxed text-neutral-400">
          {report.mapped} seleções ligadas
          {report.repaired > 0 ? ` (${report.repaired} trocadas desligadas primeiro)` : ""}.{" "}
          {report.pending.length > 0 ? `Por ligar à mão: ${report.pending.join(", ")}.` : "Nada por ligar à mão."}
        </span>
      )}
    </span>
  );
}

export function RepairWrongIntlButton() {
  const [isPending, startTransition] = useTransition();
  const [fixed, setFixed] = useState<number | null>(null);
  const router = useRouter();
  return (
    <span>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setFixed(null);
            const result = await repairWrongIntlAction();
            setFixed(result.fixed);
            router.refresh();
          })
        }
        className="rounded-lg border border-red-800 bg-red-950 px-4 py-2 text-sm font-medium text-red-300 transition hover:bg-red-900 disabled:opacity-60"
      >
        {isPending ? "A corrigir…" : "Desligar as 8 trocadas"}
      </button>
      {fixed !== null && (
        <span className="mt-1 block text-xs text-neutral-400">
          {fixed === 0 ? "Nada por corrigir." : `${fixed} desligadas. Carrega a seguir em Ligar seleções para as refazer bem.`}
        </span>
      )}
    </span>
  );
}

export function AuditIntlButton() {
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState<
    { local: string; sofa: string; id: number; tournaments: string[]; youthShare: number; flag: string | null }[] | null
  >(null);
  return (
    <span>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setRows(null);
            const result = await auditIntlMapsAction();
            setRows(result.rows);
          })
        }
        className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-200 transition hover:bg-neutral-800 disabled:opacity-60"
      >
        {isPending ? "A auditar… (vários minutos)" : "Auditar ligações"}
      </button>
      {rows && (
        <span className="mt-2 block max-w-3xl rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-xs leading-relaxed">
          {rows.length === 0 ? (
            <span className="text-emerald-400">Nenhuma ligação suspeita: tudo a seleções principais.</span>
          ) : (
            rows.map((r) => (
              <span key={`${r.local}-${r.id}`} className="block border-b border-neutral-800/50 py-1 text-neutral-300">
                <span className="font-medium text-red-300">{r.local}</span> → {r.sofa} (id {r.id}) · {r.flag}
                {r.tournaments.length > 0 && <span className="text-neutral-500"> · {r.tournaments.join(" · ")}</span>}
              </span>
            ))
          )}
        </span>
      )}
    </span>
  );
}

export function AutoAlignAllTeamsButton() {
  const [isPending, startTransition] = useTransition();
  const [report, setReport] = useState<
    { total: number; pending: { label: string; teams: string[] }[] } | null
  >(null);
  const router = useRouter();
  return (
    <span>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setReport(null);
            const result = await autoAlignAllTeamsAction();
            const total = result.leagues.reduce((n, l) => n + l.aligned, 0);
            setReport({
              total,
              pending: result.leagues
                .filter((l) => l.pending.length > 0 || l.error)
                .map((l) => ({
                  label: l.label,
                  teams: l.error ? [`(${l.error})`] : l.pending,
                })),
            });
            router.refresh();
          })
        }
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
      >
        {isPending ? "A alinhar tudo… (pode demorar vários minutos)" : "Alinhar equipas de todas as ligas"}
      </button>
      {report && (
        <span className="mt-1 block max-w-2xl text-xs leading-relaxed text-neutral-400">
          {report.total} equipas ligadas no total.{" "}
          {report.pending.length > 0
            ? report.pending.map((p) => `${p.label}: ${p.teams.join(", ")}`).join(" · ")
            : "Nada por ligar à mão."}
        </span>
      )}
    </span>
  );
}
