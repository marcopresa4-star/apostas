import { createClient } from "@/lib/supabase/server";
import Sidebar from "@/components/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen bg-neutral-950">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-64 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/20 via-neutral-950 to-neutral-950"
      />
      <Sidebar userEmail={user?.email ?? null} />
      <div className="flex min-h-screen flex-col md:pl-16">
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">{children}</main>
      </div>
    </div>
  );
}
