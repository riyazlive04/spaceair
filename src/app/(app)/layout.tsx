import Link from "next/link";
import { cookies } from "next/headers";
import { Bell, LogOut } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { navCounts } from "@/lib/data";
import { logout, setBranch } from "@/lib/actions";
import { BRANCHES, ROLE_LABELS } from "@/lib/constants";
import { Nav } from "@/components/nav";
import { Flash, AutoSubmitSelect, ReplyPopup } from "@/components/client";
import { Logo } from "@/components/logo";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const counts = await navCounts(user);
  const allBranches = user.role === "owner" || user.role === "accounts";
  const branch = (await cookies()).get("sa_branch")?.value ?? "All";

  return (
    <div className="grid min-h-full grid-cols-[236px_minmax(0,1fr)] max-md:grid-cols-1">
      <aside className="sticky top-0 flex h-screen flex-col gap-4 overflow-y-auto border-r border-line bg-surface px-3 py-4 max-md:static max-md:h-auto max-md:border-b max-md:border-r-0 max-md:px-4">
        <Link href="/dashboard" className="flex flex-col gap-1 px-2" aria-label="SPACEAIR CRM home">
          <Logo height={42} />
          <span className="text-[11.5px] text-muted">MEP sales · AMC · service</span>
        </Link>
        <Nav role={user.role} counts={counts} />
        <div className="mt-auto border-t border-line px-2 pt-3 text-xs max-md:hidden">
          <div className="font-semibold text-ink">{user.name}</div>
          <div className="text-muted">
            {ROLE_LABELS[user.role]} · {user.branch}
          </div>
          <form action={logout} className="mt-2">
            <button className="inline-flex items-center gap-1.5 text-muted hover:text-ink" type="submit">
              <LogOut className="size-3.5" /> Switch user
            </button>
          </form>
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-line bg-surface/95 px-6 py-2.5 backdrop-blur max-md:static max-md:px-4">
          <span className="rounded bg-accent-soft px-2 py-1 font-mono text-[11px] font-medium text-accent">
            {allBranches ? "All branches access" : `${user.branch} branch`}
          </span>
          <div className="flex-1" />
          {allBranches && (
            <form action={setBranch} className="flex items-center gap-2 text-xs text-muted">
              <label htmlFor="branch-filter">Branch</label>
              <AutoSubmitSelect
                name="branch"
                label="Branch filter"
                defaultValue={branch}
                options={[{ value: "All", label: "All branches" }, ...BRANCHES.map((b) => ({ value: b, label: b }))]}
              />
            </form>
          )}
          <Link href="/notifications" className="btn relative" aria-label={`Inbox, ${counts.notifications} unread`}>
            <Bell className="size-4" />
            {counts.notifications > 0 && (
              <span className="rounded-full bg-crit px-1.5 font-mono text-[10.5px] text-white">{counts.notifications}</span>
            )}
          </Link>
          {user.role === "technician" || user.role === "service_manager" ? (
            <Link href="/service/new" className="btn btn-primary">+ New ticket</Link>
          ) : (
            <Link href="/enquiries/new" className="btn btn-primary">+ New enquiry</Link>
          )}
        </header>
        <main className="flex min-w-0 flex-col gap-5 px-6 pb-12 pt-5 max-md:px-4">{children}</main>
      </div>
      <Flash />
      <ReplyPopup />
    </div>
  );
}
