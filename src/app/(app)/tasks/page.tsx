import Link from "next/link";
import { asc } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { requireUser } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { fmtShort, cn } from "@/lib/format";
import { completeTask, createTask } from "@/lib/actions";
import { Card, PageHeader, Tabs, Empty, Pill } from "@/components/ui";
import { Submit } from "@/components/client";

export const metadata = { title: "Tasks" };
const LINK: Record<string, string> = { opportunity: "/opportunities/", enquiry: "/enquiries/", project: "/projects/", amc: "/amc/", ticket: "/service/" };

export default async function Tasks(props: PageProps<"/tasks">) {
  const user = await requireUser();
  const tab = String((await props.searchParams).tab ?? "Mine");
  const L = await lookups();
  const now = new Date();
  const all = await db.select().from(S.tasks).orderBy(asc(S.tasks.dueAt));
  const team = user.role === "owner" ? all : all.filter((t) => L.user(t.assignedTo)?.branch === user.branch);
  const list = (tab === "Mine" ? all.filter((t) => t.assignedTo === user.id) : team).filter((t) => (tab === "Done" ? t.status === "done" : t.status === "open"));
  const overdue = list.filter((t) => t.dueAt && t.dueAt < now && t.status === "open");
  const canSeeTeam = ["owner", "branch_head", "service_manager"].includes(user.role);

  return (
    <>
      <PageHeader title="Tasks" sub="Most tasks are created by automations (first response, follow-ups, handover, renewals), so nobody has to remember to assign work." />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs current={tab} items={[{ href: "?tab=Mine", label: "Mine" }, ...(canSeeTeam ? [{ href: "?tab=Team", label: "Team" }] : []), { href: "?tab=Done", label: "Done" }]} />
        {overdue.length > 0 && <Pill tone="crit">{overdue.length} overdue</Pill>}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-4 max-lg:grid-cols-1">
        <Card>
          {list.map((t) => (
            <div key={t.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 border-t border-line pt-2.5 text-[13px] first:border-0 first:pt-0">
              <form action={completeTask.bind(null, t.id)}>
                <button type="submit" disabled={t.status === "done"} className={cn("mt-0.5 size-4 rounded border", t.status === "done" ? "border-good bg-good" : "border-line hover:border-accent")} aria-label={`Complete ${t.title}`} />
              </form>
              <div>
                {t.entityType && t.entityId && LINK[t.entityType] ? <Link className="hover:underline" href={LINK[t.entityType] + t.entityId}>{t.title}</Link> : t.title}
                <div className="text-xs text-muted">
                  {tab !== "Mine" && <>{L.userName(t.assignedTo)} · </>}
                  {t.source === "automation" ? <span className="font-semibold text-accent">created by automation</span> : "manual"}
                  {t.priority === "high" && <span className="text-crit"> · high priority</span>}
                </div>
              </div>
              <span className={cn("font-mono text-[11.5px]", t.dueAt && t.dueAt < now && t.status === "open" ? "text-crit" : "text-muted")}>{fmtShort(t.dueAt)}</span>
            </div>
          ))}
          {!list.length && <Empty>Nothing here.</Empty>}
        </Card>
        <Card title="Add a task">
          <form action={createTask} className="flex flex-col gap-2">
            <input className="input" name="title" required placeholder="e.g. Share LG submittals with PMC" aria-label="Task" />
            <select className="input" name="assignedTo" defaultValue={user.id} aria-label="Assign to">{L.users.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.branch}</option>)}</select>
            <div className="flex gap-2">
              <input className="input" type="date" name="dueAt" aria-label="Due date" />
              <select className="input" name="priority" aria-label="Priority"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select>
            </div>
            <Submit className="btn-primary">Add task</Submit>
          </form>
        </Card>
      </div>
    </>
  );
}
