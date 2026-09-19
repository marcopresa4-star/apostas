"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getCommunityUnseen, markCommunitySeen } from "@/app/(app)/actions";

const POLL_MS = 15000;
const TOAST_MS = 10000;

const UnseenContext = createContext(0);

export function useCommunityUnseen() {
  return useContext(UnseenContext);
}

interface Toast {
  count: number;
  entered: number;
}

function toastText({ count, entered }: Toast) {
  if (entered === count) {
    return count === 1 ? "Entrei numa aposta live" : `Entrei em ${count} apostas live`;
  }
  return count === 1 ? "Nova aposta na Comunidade" : `${count} novas apostas na Comunidade`;
}

// Only mounted "enabled" for non-admin users (the admin is the one
// publishing, so notifying them of their own posts would be noise). Polls a
// tiny count query every 15s while the tab is visible (and on tab focus);
// shows a badge count via context (read by the Sidebar) and a toast when the
// count goes up. While the user is ON the Comunidade page, new posts are
// marked seen right away, the feed is refreshed so they appear without a
// manual reload, and the toast still says what just arrived.
export default function CommunityUnseenProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [unseen, setUnseen] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const lastCountRef = useRef(0);
  const onCommunityRef = useRef(false);
  const firstCheckRef = useRef(true);

  useEffect(() => {
    onCommunityRef.current = pathname.startsWith("/comunidade");
    if (!enabled || !onCommunityRef.current) return;

    async function markSeenNow() {
      await markCommunitySeen();
      lastCountRef.current = 0;
      setUnseen(0);
      setToast(null);
    }
    markSeenNow();
  }, [pathname, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function check() {
      // A hidden tab has nobody to notify; it checks again when it comes back.
      if (document.visibilityState === "hidden") return;

      const { count, entered } = await getCommunityUnseen();
      if (cancelled) return;

      const isFirstCheck = firstCheckRef.current;
      firstCheckRef.current = false;

      if (onCommunityRef.current) {
        if (count > 0) {
          await markCommunitySeen();
          if (cancelled) return;
          router.refresh();
          // Whatever was already unseen when the page opened is on screen
          // already, so only later arrivals get a toast.
          if (!isFirstCheck) setToast({ count, entered });
        }
        lastCountRef.current = 0;
        setUnseen(0);
        return;
      }

      if (count > lastCountRef.current) setToast({ count, entered });
      lastCountRef.current = count;
      setUnseen(count);
    }

    check();
    const id = setInterval(check, POLL_MS);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [enabled, router]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);

  return (
    <UnseenContext.Provider value={unseen}>
      {children}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 w-72">
          <Link
            href="/comunidade"
            className="flex items-center gap-3 rounded-xl border border-orange-600/50 bg-gradient-to-r from-orange-950 to-neutral-900 py-3 pl-4 pr-10 shadow-xl shadow-orange-900/30 transition hover:border-orange-500"
          >
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 animate-pulse items-center justify-center rounded-full bg-orange-500/20 text-lg"
            >
              📢
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-orange-200">{toastText(toast)}</p>
              <p className="text-xs text-orange-300/80">Toca para ver</p>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Fechar notificação"
            className="absolute right-2 top-2 rounded-lg p-1 text-orange-400/60 transition hover:bg-orange-500/10 hover:text-orange-300"
          >
            ✕
          </button>
        </div>
      )}
    </UnseenContext.Provider>
  );
}
