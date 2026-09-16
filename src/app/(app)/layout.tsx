import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen flex-col bg-neutral-950">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-64 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/20 via-neutral-950 to-neutral-950"
      />
      <header className="sticky top-0 z-20 border-b border-neutral-800/80 bg-neutral-900/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-1.5 text-lg font-semibold text-neutral-100">
            <span aria-hidden>⚽</span> Apostas
          </Link>
          <nav className="flex items-center gap-2 text-sm sm:gap-4">
            <Link
              href="/apostas/nova"
              className="whitespace-nowrap rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-500"
            >
              <span className="sm:hidden">+ Nova</span>
              <span className="hidden sm:inline">+ Nova aposta</span>
            </Link>
            {user && (
              <form action={signOut}>
                <button
                  type="submit"
                  className="text-neutral-400 transition hover:text-white"
                  title={user.email ?? undefined}
                >
                  Sair
                </button>
              </form>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
