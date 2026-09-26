import { createClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/requireAdmin";
import Sidebar from "@/components/Sidebar";
import WatchWatcher from "@/components/WatchWatcher";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isAdmin = await getIsAdmin();

  return (
    <div className="min-h-screen bg-neutral-950">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-64 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/20 via-neutral-950 to-neutral-950"
      />
      <Sidebar userEmail={user?.email ?? null} isAdmin={isAdmin} />
      <WatchWatcher />
      <div className="flex min-h-screen flex-col md:pl-56">
        {/* A page holding a wide table marks itself with data-wide to get more room. */}
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 has-[[data-wide]]:max-w-[96rem]">{children}</main>
      </div>
    </div>
  );
}
