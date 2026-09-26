"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Inbox, KanbanSquare, Building2, FileText, BadgeCheck, HardHat, CalendarClock, Wrench,
  ListChecks, BarChart3, Workflow, Bell, Settings, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/format";

type Item = { href: string; label: string; icon: LucideIcon; roles?: string[]; badge?: keyof Counts; alert?: boolean };
type Counts = { notifications: number; tasks: number; approvals: number; enquiries: number; service: number };

const GROUPS: { label: string; items: Item[] }[] = [
  { label: "Overview", items: [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/tasks", label: "My tasks", icon: ListChecks, badge: "tasks" },
    { href: "/notifications", label: "Inbox", icon: Bell, badge: "notifications", alert: true },
  ] },
  { label: "Sales", items: [
    { href: "/enquiries", label: "Enquiries", icon: Inbox, roles: ["owner", "branch_head", "sales"], badge: "enquiries", alert: true },
    { href: "/pipeline", label: "Pipeline", icon: KanbanSquare, roles: ["owner", "branch_head", "sales", "estimator"] },
    { href: "/clients", label: "Clients", icon: Building2, roles: ["owner", "branch_head", "sales", "estimator", "service_manager", "accounts"] },
    { href: "/quotations", label: "Quotations", icon: FileText, roles: ["owner", "branch_head", "sales", "estimator", "accounts"] },
    { href: "/approvals", label: "Approvals", icon: BadgeCheck, roles: ["owner", "branch_head"], badge: "approvals", alert: true },
  ] },
  { label: "Delivery & service", items: [
    { href: "/projects", label: "Projects", icon: HardHat, roles: ["owner", "branch_head", "estimator", "accounts"] },
    { href: "/amc", label: "AMC contracts", icon: CalendarClock, roles: ["owner", "branch_head", "sales", "service_manager", "accounts"] },
    { href: "/service", label: "Service tickets", icon: Wrench, roles: ["owner", "branch_head", "service_manager", "technician"], badge: "service" },
  ] },
  { label: "Management", items: [
    { href: "/reports", label: "Reports", icon: BarChart3, roles: ["owner", "branch_head", "accounts"] },
    { href: "/automations", label: "Automations", icon: Workflow, roles: ["owner", "branch_head", "service_manager"] },
    { href: "/settings", label: "Settings", icon: Settings, roles: ["owner"] },
  ] },
];

export function Nav({ role, counts }: { role: string; counts: Counts }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-0.5 max-md:flex-row max-md:overflow-x-auto">
      {GROUPS.map((g) => {
        const items = g.items.filter((i) => !i.roles || i.roles.includes(role));
        if (!items.length) return null;
        return (
          <div key={g.label} className="flex flex-col gap-0.5 max-md:flex-row">
            <div className="label px-2.5 pb-1.5 pt-3 max-md:hidden">{g.label}</div>
            {items.map((i) => {
              const active = path === i.href || path.startsWith(i.href + "/") || (i.href === "/pipeline" && path.startsWith("/opportunities"));
              const n = i.badge ? counts[i.badge] : 0;
              return (
                <Link
                  key={i.href}
                  href={i.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 whitespace-nowrap rounded-md px-2.5 py-[7px] text-[13.5px] font-medium",
                    active ? "bg-accent-soft text-ink shadow-[inset_3px_0_0_var(--accent)]" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                  )}
                >
                  <i.icon className="size-4 shrink-0 opacity-80" aria-hidden />
                  <span className="flex-1">{i.label}</span>
                  {n > 0 && (
                    <span className={cn("rounded-full px-1.5 py-px font-mono text-[10.5px]", i.alert ? "bg-crit-soft text-crit" : "bg-surface-2 text-muted")}>{n}</span>
                  )}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
