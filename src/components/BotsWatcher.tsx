"use client";

import { useEffect, useRef } from "react";

// Global bot watcher: lives in the layout, so it polls on EVERY site page
// (not just /bots) while enabled bots exist. Fired alerts raise a browser
// Notification (unless silent, or permission not granted). Layout-level state
// survives navigation, so games are not re-checked from scratch per page.
// Still needs a site tab open somewhere: closed browser = nothing runs.
export default function BotsWatcher({ enabled }: { enabled: boolean }) {
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    const check = async (): Promise<void> => {
      try {
        const res = await fetch("/api/bots/check", { method: "POST", cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as {
          fired?: { id: string; silent: boolean; text: string }[];
        };
        for (const f of body.fired ?? []) {
          if (seen.current.has(f.id)) continue;
          seen.current.add(f.id);
          if (!f.silent && typeof Notification !== "undefined" && Notification.permission === "granted") {
            try {
              new Notification(f.text);
            } catch {
              // Permission revoked mid-session: the Bots page keeps the alert.
            }
          }
        }
      } catch {
        // Scraper offline or network down: next minute retries.
      }
    };
    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, [enabled]);

  return null;
}
