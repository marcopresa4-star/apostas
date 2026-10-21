"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Bot } from "@/lib/bots";
import { clearAlertsAction, createTestBotAction, deleteBotAction, toggleBotAction } from "@/app/(app)/bots/actions";
import BotForm from "@/components/BotForm";

export interface BotRow extends Bot {
  created_at: string;
}

export interface AlertRow {
  id: string;
  bot_id: string;
  market: string;
  text: string;
  minute: number;
  home: string;
  away: string;
  hg: number;
  ag: number;
  hit: boolean | null;
  created_at: string;
}

interface Fired extends AlertRow {
  bot_name: string;
  silent: boolean;
}

interface DiagRow {
  eventId: number;
  home: string;
  away: string;
  minute: number;
  hg: number;
  ag: number;
  fail: string;
}

// Shows the automatic watcher's heartbeat (last pass + games seen),
// refreshing every few seconds. Stale = no open tab is watching.
function WatchHeartbeat() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  let at: number | null = null;
  let games: number | null = null;
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem("apostas:bots-watch") : null;
    if (raw) {
      const p = JSON.parse(raw) as { at?: unknown; games?: unknown };
      if (typeof p.at === "number") at = p.at;
      if (typeof p.games === "number") games = p.games;
    }
  } catch {
    // No heartbeat yet.
  }
  if (now === null || at === null) return null;
  const secs = Math.max(0, Math.round((now - at) / 1000));
  const stale = secs > 180;
  const age = secs < 10 ? "agora mesmo" : secs < 60 ? `há ${secs}s` : `há ${Math.floor(secs / 60)}min`;
  return (
    <span className={`text-xs ${stale ? "text-amber-300" : "text-neutral-500"}`}>
      Passagem automática {age}
      {games !== null && ` · ${games} jogo${games === 1 ? "" : "s"} vistos`}
      {stale && " — sem separador a vigiar?"}
    </span>
  );
}

// Absolute birth time plus, after mount, the age ("há 1h05m"): the list is
// history, and the age makes staleness obvious at a glance. Absolute first
// so server and hydration renders match.
function AlertTime({ iso }: { iso: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const abs = `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}`;
  if (now === null) return <>{abs}</>;
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  const rel = mins < 1 ? "agora" : mins < 60 ? `há ${mins} min` : `há ${Math.floor(mins / 60)}h${mins % 60 !== 0 ? `${mins % 60}m` : ""}`;
  return (
    <>
      {abs} · {rel}
    </>
  );
}

// Polls the server check while watching: fired alerts arrive here, the
// browser notifies (unless the bot is silent), and the list grows. Nothing
// runs with this page closed — stated on the page, not hidden.
export default function BotsClient({
  bots,
  alerts,
  leagues,
}: {
  bots: BotRow[];
  alerts: AlertRow[];
  leagues: { code: string; label: string }[];
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BotRow | null>(null);
  const [extra, setExtra] = useState<Fired[]>([]);
  const [checking, setChecking] = useState(false);
  const [offline, setOffline] = useState(false);
  const [lastCheck, setLastCheck] = useState<string | null>(null);
  const [passing, setPassing] = useState<Record<string, { checked: number; passing: number }>>({});
  const [diag, setDiag] = useState<Record<string, DiagRow[]>>({});
  const [sort, setSort] = useState("padrao");
  // Alerts panel filter: which bots' alerts are shown ("all" or one bot id).
  const [botFilter, setBotFilter] = useState("all");
  // "denied" until mounted: Notification only exists in the browser, and
  // reading it during hydration would mismatch the server render for users
  // who already granted permission.
  const [perm, setPerm] = useState<string>("denied");
  useEffect(() => {
    if (typeof Notification !== "undefined") setPerm(Notification.permission);
  }, []);
  const seen = useRef<Set<string>>(new Set());
  // The global watcher (layout) polls on every page; this button is only the
  // manual trigger. No auto-poll here, or every check would run twice.

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/bots/check", { method: "POST", cache: "no-store" });
      if (!res.ok) {
        setOffline(true);
        return;
      }
      setOffline(false);
      const body = (await res.json()) as { fired?: Fired[]; stats?: Record<string, { checked: number; passing: number }>; diag?: Record<string, DiagRow[]> };
      if (body.stats) setPassing(body.stats);
      if (body.diag) setDiag(body.diag);
      const fresh = (body.fired ?? []).filter((f) => !seen.current.has(f.id));
      for (const f of fresh) seen.current.add(f.id);
      if (fresh.length > 0) {
        setExtra((prev) => [...fresh, ...prev].slice(0, 40));
        for (const f of fresh) {
          if (!f.silent && perm === "granted") {
            try {
              new Notification(f.text);
            } catch {
              // Permission revoked mid-session: the list keeps the alert.
            }
          }
          // Same in-site toast as the global watcher (bottom-right, every page).
          if (!f.silent) {
            try {
              window.dispatchEvent(new CustomEvent("apostas:bot-alert", { detail: { ...f, link: "/bots", sticky: true } }));
            } catch {
              // No listeners: the list keeps the alert.
            }
          }
        }
        router.refresh();
      }
      setLastCheck(new Date().toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" }));
    } catch {
      setOffline(true);
    } finally {
      setChecking(false);
    }
  }, [perm, router]);

  useEffect(() => {
    // Seed the seen set so a fresh page load does not re-notify old alerts.
    for (const a of alerts) seen.current.add(a.id);
  }, [alerts]);

  useEffect(() => {
    // Alerts the global watcher found while we watch: refresh the list live
    // (the toast is handled by BotToasts in the layout).
    const onAlert = (): void => {
      router.refresh();
    };
    // Same-tab broadcast.
    window.addEventListener("apostas:bot-alert", onAlert);
    // Another tab found alerts (window events never cross tabs, storage does).
    const onStorage = (e: StorageEvent): void => {
      if (e.key === "apostas:bots-ping") router.refresh();
    };
    window.addEventListener("storage", onStorage);
    // Coming back to the tab: catch up without a manual refresh.
    const onVisible = (): void => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("apostas:bot-alert", onAlert);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  const askPerm = async () => {
    try {
      const r = await Notification.requestPermission();
      setPerm(r);
    } catch {
      setPerm("denied");
    }
  };

  const all = [...extra, ...alerts].filter((a, i, arr) => arr.findIndex((x) => x.id === a.id) === i).slice(0, 40);
  const shown = botFilter === "all" ? all : all.filter((a) => a.bot_id === botFilter);
  // Bot names come from the bots list; late-fired rows carry theirs too (the
  // toast event may name a bot that no longer exists — still label it).
  const botName = (id: string): string => {
    const b = bots.find((x) => x.id === id);
    if (b) return b.name;
    const fired = extra.find((x) => x.bot_id === id);
    return fired && "bot_name" in fired ? (fired as { bot_name?: string }).bot_name ?? "" : "";
  };
  const byBot = new Map<string, AlertRow[]>();
  for (const a of [...extra, ...alerts]) {
    const list = byBot.get(a.bot_id) ?? [];
    list.push(a);
    byBot.set(a.bot_id, list);
  }
  const hitRate = (id: string): string | null => {
    const list = (byBot.get(id) ?? []).filter((a) => a.hit !== null);
    if (list.length === 0) return null;
    return `${Math.round((list.filter((a) => a.hit).length / list.length) * 100)}% (${list.length})`;
  };
  const ordered = [...bots].sort((a, b) => {
    if (sort === "alertas") return (byBot.get(b.id)?.length ?? 0) - (byBot.get(a.id)?.length ?? 0);
    return 0;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-500"
        >
          + Novo bot
        </button>
        <button
          type="button"
          onClick={check}
          disabled={checking}
          className="rounded-lg border border-white/[0.09] px-4 py-2 text-sm text-neutral-300 transition hover:border-white/[0.18] disabled:opacity-50"
        >
          {checking ? "A verificar…" : "Verificar agora"}
        </button>
        <button
          type="button"
          title="Cria um bot que dispara em qualquer jogo ao vivo (sem condições): para confirmar que os alertas chegam. Apaga-o depois do teste."
          onClick={async () => {
            const existing = bots.find((b) => b.name === "🔔 Teste de alertas");
            if (existing) {
              if (!existing.enabled) await toggleBotAction(existing.id, true);
            } else {
              await createTestBotAction();
            }
            router.refresh();
          }}
          className="rounded-lg border border-dashed border-neutral-600 px-4 py-2 text-sm text-neutral-400 transition hover:border-emerald-500 hover:text-neutral-200"
        >
          🔔 Bot de teste
        </button>
        <button
          type="button"
          title="Mostra um toast de exemplo no canto inferior direito (só testa o canto, não cria alerta)."
          onClick={() => {
            try {
              window.dispatchEvent(
                new CustomEvent("apostas:bot-alert", {
                  detail: { id: `demo-${Date.now()}`, bot_name: "Demonstração", text: "Isto é um teste — o canto funciona." },
                })
              );
            } catch {
              // Sem ouvintes: nada a fazer.
            }
          }}
          className="text-xs text-neutral-500 underline-offset-2 hover:text-neutral-300 hover:underline"
        >
          testar canto
        </button>
        {perm !== "granted" && (
          <button
            type="button"
            onClick={askPerm}
            className="rounded-lg border border-white/[0.09] px-4 py-2 text-sm text-neutral-300 transition hover:border-white/[0.18]"
          >
            Ativar notificações
          </button>
        )}
        <span className="text-xs text-neutral-500">
          {offline ? "Scraper desligado." : lastCheck ? `Última verificação ${lastCheck}.` : "Por verificar."}{" "}
          {bots.some((b) => b.enabled)
            ? "Vigilância ativa em todas as páginas."
            : "Sem bots ativos: nada a vigiar."}{" "}
          {perm === "granted" ? "Notificações ligadas." : "Notificações desligadas (só a lista)."}
        </span>
        <WatchHeartbeat />
      </div>

      <div className="glass p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-neutral-200">
            Os teus bots · {bots.filter((b) => b.enabled).length} ativos
          </h2>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded-lg border border-white/[0.09] bg-white/[0.03] px-2 py-1.5 text-xs text-neutral-300 outline-none"
          >
            <option value="padrao">Ordenar: padrão</option>
            <option value="alertas">Ordenar: mais alertas</option>
          </select>
        </div>
        {ordered.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-3xl">🤖</p>
            <p className="mt-2 text-sm font-medium text-neutral-300">Sem bots criados</p>
            <p className="text-xs text-neutral-500">Clica em “Novo bot” para criar o teu primeiro bot.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {ordered.map((b) => {
              const rate = hitRate(b.id);
              const pass = passing[b.id];
              const rows = diag[b.id] ?? [];
              return (
                <div key={b.id} className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-neutral-100">
                        {b.enabled ? "● " : "○ "}
                        {b.name}
                        {b.silent && <span className="ml-2 text-[11px] font-normal text-neutral-500">silencioso</span>}
                      </p>
                      <p className="text-[11px] text-neutral-500">
                        {(byBot.get(b.id)?.length ?? 0)} alertas
                        {rate !== null && ` · acerto ${rate}`}
                        {pass !== undefined && ` · ${pass.passing}/${pass.checked} jogos cumprem agora`}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(b);
                        setFormOpen(true);
                      }}
                      className="rounded-lg border border-white/[0.09] px-3 py-1.5 text-xs text-neutral-300 hover:border-white/[0.18]"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleBotAction(b.id, !b.enabled)}
                      className="rounded-lg border border-white/[0.09] px-3 py-1.5 text-xs text-neutral-300 hover:border-white/[0.18]"
                    >
                      {b.enabled ? "Pausar" : "Ativar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Apagar "${b.name}" e os seus alertas?`)) deleteBotAction(b.id);
                      }}
                      className="rounded-lg border border-white/[0.09] px-3 py-1.5 text-xs text-red-300 hover:border-red-800"
                    >
                      Apagar
                    </button>
                    </div>
                  </div>
                  {rows.length > 0 && (
                    <details className="mt-2 border-t border-white/[0.07] pt-2">
                      <summary className="cursor-pointer text-[11px] font-medium text-neutral-400 hover:text-neutral-200">
                        Ver jogos ({rows.length}) — porque cumprem ou não
                      </summary>
                      <div className="mt-1.5 space-y-1">
                        {rows.map((r) => (
                          <p key={`${r.eventId}`} className="truncate text-[11px] text-neutral-400">
                            <span className="text-neutral-200">
                              {r.home} vs {r.away} · {r.minute}&apos; · {r.hg}–{r.ag}
                            </span>{" "}
                            — {r.fail === "" ? <span className="font-semibold text-emerald-400">cumpre ✓</span> : r.fail}
                          </p>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="glass p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-neutral-200">
            Alertas dos bots · {botFilter === "all" ? all.length : shown.length}
          </h2>
          <span className="flex items-center gap-2">
            <select
              value={botFilter}
              onChange={(e) => setBotFilter(e.target.value)}
              className="rounded-lg border border-white/[0.09] bg-white/[0.03] px-2 py-1.5 text-xs text-neutral-300 outline-none"
              title="Escolhe de que bots ver os alertas"
            >
              <option value="all">Todos os bots</option>
              {bots.map((b) => (
                <option key={b.id} value={b.id}>
                  Só {b.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                if (all.length > 0 && confirm("Limpar todos os alertas?")) clearAlertsAction();
              }}
              className="rounded-lg border border-white/[0.09] px-3 py-1.5 text-xs text-neutral-300 hover:border-white/[0.18]"
            >
              Limpar
            </button>
          </span>
        </div>
        {all.length === 0 ? (
          <p className="py-6 text-center text-xs text-neutral-500">Os alertas dos bots aparecem aqui.</p>
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-xs text-neutral-500">Sem alertas deste bot — vê «Todos os bots».</p>
        ) : (
          <div className="space-y-1.5 text-sm">
            {shown.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-3 py-2">
                <p className="min-w-0 truncate text-neutral-200">
                  <span className={a.hit === true ? "font-bold text-emerald-400" : a.hit === false ? "font-bold text-red-400" : "text-neutral-500"}>
                    {a.hit === true ? "✓ " : a.hit === false ? "✗ " : ""}
                  </span>
                  {botFilter === "all" && botName(a.bot_id) && (
                    <span className="mr-1.5 rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-neutral-300">
                      {botName(a.bot_id)}
                    </span>
                  )}
                  {a.text}
                </p>
                <span className="shrink-0 text-[11px] text-neutral-500">
                  <AlertTime iso={a.created_at} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {formOpen && (
        <BotForm
          leagues={leagues}
          initial={editing}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
