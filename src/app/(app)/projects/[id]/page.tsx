import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { requireUser } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { money, fmtDate, fmtShort, cn } from "@/lib/format";
import { toggleChecklist, updateProject, completeTask } from "@/lib/actions";
import { Card, PageHeader, Pill } from "@/components/ui";
import { Submit } from "@/components/client";

export default async function ProjectDetail(props: PageProps<"/projects/[id]">) {
  await requireUser();
  const { id } = await props.params;
  const p = await db.query.projects.findFirst({ where: eq(S.projects.id, id) });
  if (!p) notFound();
  const L = await lookups();
  const tasks = await db.select().from(S.tasks).where(and(eq(S.tasks.entityType, "project"), eq(S.tasks.entityId, id)));
  return (
    <>
      <PageHeader
        title={`${p.code} · ${p.name}`}
        sub={<>{L.acctName(p.accountId)} · {p.branch} · order value {money(p.value)} · PM {L.userName(p.pmId)} · since {fmtDate(p.createdAt)}{p.opportunityId && <> · <Link className="link" href={`/opportunities/${p.opportunityId}`}>source deal</Link></>}</>}
        actions={<Pill tone={p.status === "completed" ? "good" : "info"}>{p.status}</Pill>}
      />
      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <Card title="Handover checklist" sub="Sales → Projects → Accounts, with nothing lost in between">
          {p.checklist.map((c, i) => (
            <form key={i} action={toggleChecklist.bind(null, p.id, i)}>
              <button type="submit" className="flex w-full items-center gap-2.5 rounded-md px-1 py-1 text-left text-[13px] hover:bg-surface-2">
                <span className={cn("grid size-4 place-items-center rounded border text-[10px]", c.done ? "border-good bg-good text-white" : "border-line")}>{c.done ? "✓" : ""}</span>
                <span className={c.done ? "text-muted line-through" : ""}>{c.item}</span>
              </button>
            </form>
          ))}
        </Card>
        <div className="flex flex-col gap-4">
          <Card title="Execution progress">
            <div className="h-3 rounded bg-surface-2"><div className="h-full rounded bg-accent" style={{ width: `${p.progress}%` }} /></div>
            <form action={updateProject.bind(null, p.id)} className="flex items-end gap-2">
              <label className="field">Progress %<input className="input w-28" type="number" name="progress" min="0" max="100" defaultValue={p.progress} /></label>
              <Submit className="btn-primary">Update</Submit>
            </form>
          </Card>
          <Card title="Handover tasks" sub="Created automatically when the PO arrived">
            {tasks.map((t) => (
              <form key={t.id} action={completeTask.bind(null, t.id)} className="flex items-start gap-2 text-[13px]">
                <button type="submit" disabled={t.status === "done"} className={cn("mt-0.5 size-4 shrink-0 rounded border", t.status === "done" ? "border-good bg-good" : "border-line hover:border-accent")} aria-label="Complete" />
                <span className={cn("flex-1", t.status === "done" && "text-muted line-through")}>{t.title}<span className="text-muted"> · {L.userName(t.assignedTo)}</span></span>
                <span className="font-mono text-[11px] text-muted">{fmtShort(t.dueAt)}</span>
              </form>
            ))}
            {!tasks.length && <p className="text-xs text-muted">No tasks.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
