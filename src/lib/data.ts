import { and, eq, inArray, count } from "drizzle-orm";
import { db, schema as S } from "@/db";
import type { User } from "@/db/schema";

export async function lookups() {
  const [users, accounts] = await Promise.all([db.select().from(S.users), db.select().from(S.accounts)]);
  const u = new Map(users.map((x) => [x.id, x]));
  const a = new Map(accounts.map((x) => [x.id, x]));
  return {
    users,
    accounts,
    userName: (id?: string | null) => (id ? u.get(id)?.name ?? "—" : "Unassigned"),
    user: (id?: string | null) => (id ? u.get(id) : undefined),
    acct: (id?: string | null) => (id ? a.get(id) : undefined),
    acctName: (id?: string | null) => (id ? a.get(id)?.name ?? "—" : "—"),
  };
}

/** Badge counts for the sidebar. */
export async function navCounts(u: User) {
  const [n] = await db.select({ n: count() }).from(S.notifications).where(and(eq(S.notifications.userId, u.id), eq(S.notifications.read, false)));
  const [t] = await db.select({ n: count() }).from(S.tasks).where(and(eq(S.tasks.assignedTo, u.id), eq(S.tasks.status, "open")));
  const pend = await db.select().from(S.approvals).where(eq(S.approvals.status, "pending"));
  const approvals = pend.filter((a) => u.role === "owner" ? a.approverRole === "owner" : a.approverRole === u.role && (!a.branch || a.branch === u.branch)).length;
  const [e] = await db
    .select({ n: count() })
    .from(S.enquiries)
    .where(u.role === "sales" ? and(eq(S.enquiries.status, "new"), eq(S.enquiries.assignedTo, u.id)) : u.role === "owner" ? eq(S.enquiries.status, "new") : and(eq(S.enquiries.status, "new"), eq(S.enquiries.branch, u.branch)));
  const [tk] = await db
    .select({ n: count() })
    .from(S.tickets)
    .where(u.role === "technician" ? and(eq(S.tickets.technicianId, u.id), inArray(S.tickets.status, ["open", "assigned", "in_progress"])) : inArray(S.tickets.status, ["open", "assigned", "in_progress"]));
  return { notifications: n.n, tasks: t.n, approvals, enquiries: e.n, service: tk.n };
}
