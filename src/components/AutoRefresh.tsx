"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Refreshes the page on its own while there is pending work: the first
// evaluation of the day building league history in the background, and
// leagues recovering from failed reads. Nothing new is analysed — the
// page just picks up partial caches the background run keeps writing.
export default function AutoRefresh({ active, seconds = 45 }: { active: boolean; seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(timer);
  }, [active, seconds, router]);
  return null;
}
