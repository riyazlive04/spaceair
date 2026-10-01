import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { requireUser } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { PROJECT_PHASES, phaseLabel, ROLE_LABELS } from "@/lib/constants";
import { money, fmtDate, fmtShort, cn } from "@/lib/format";
import { completeTask, recordPayment } from "@/lib/actions";
import { Card, PageHeader, Pill, Timeline } from "@/components/ui";
import { Submit } from "@/components/client";

export default async function ProjectDetail(props: PageProps<"/projects/[id]">) {
  await requireUser();
  const { id } = await props.params;
  const p = await db.query.projects.findFirst({ where: eq(S.projects.id, id) });
  if (!p) notFound();
  const L = await lookups();
  const [tasks, acts, opp, payments] = await Promise.all([
    db.select().from(S.tasks).where(and(eq(S.tasks.entityType, "project"), eq(S.tasks.entityId, id))),
    db.select().from(S.activities).where(and(eq(S.activities.entityType, "project"), eq(S.activities.entityId, id))).orderBy(desc(S.activities.createdAt)),
    p.opportunityId ? db.query.opportunities.findFirst({ where: eq(S.opportunities.id, p.opportunityId) }) : undefined,
    db.select().from(S.payments).where(eq(S.payments.projectId, id)).orderBy(desc(S.payments.paidAt)),
  ]);
  const paid = payments.reduce((sum, x) => sum + x.amount, 0);
  const balance = p.value - paid;
  const cur = PROJECT_PHASES.findIndex((x) => x.key === p.phase);
  const done = p.checklist.filter((c) => c.done).length;

  return (
    <>
      <PageHeader
        title={`${p.code} · ${p.name}`}
        sub={<>{L.acctName(p.accountId)} · {p.branch} · order value {money(p.value)} · PM {L.userName(p.pmId)} · since {fmtDate(p.createdAt)}{p.opportunityId && <> · <Link className="link" href={`/opportunities/${p.opportunityId}`}>source deal</Link></>}{opp?.consultantId && <> · consultant {L.acctName(opp.consultantId)}</>}</>}
        actions={<Pill tone={p.phase === "closed" ? "good" : "info"}>{phaseLabel(p.phase)}</Pill>}
      />
      <Card>
        <ol className="grid grid-cols-6 gap-1.5 max-lg:grid-cols-3 max-sm:grid-cols-2" aria-label="Delivery phases">
          {PROJECT_PHASES.map((ph, i) => {
            const items = p.checklist.filter((c) => c.phase === ph.key);
            const n = items.filter((c) => c.done).length;
            const state = p.phase === "closed" || i < cur ? "done" : i === cur ? "now" : "next";
            return (
              <li key={ph.key} className={cn("rounded-md border px-2.5 py-2", state === "done" ? "border-accent bg-accent-soft" : state === "now" ? "border-accent bg-surface shadow-[inset_0_3px_0_var(--accent)]" : "border-line bg-surface-2")}>
                <div className="font-mono text-[10.5px] text-muted">{String(i + 1).padStart(2, "0")} · {ROLE_LABELS[ph.owner]}</div>
                <div className="text-[13px] font-semibold leading-tight">{ph.label}</div>
                <div className="mt-1 text-[11.5px] text-muted">{n}/{items.length} done</div>
              </li>
            );
          })}
        </ol>
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted"><span>Overall progress</span><span>{done}/{p.checklist.length} steps · {p.progress}%</span></div>
          <div className="h-2.5 rounded bg-surface-2"><div className="h-full rounded bg-accent" style={{ width: `${p.progress}%` }} /></div>
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <Card title="Billing" sub="Project value, payments received and outstanding balance">
          <div className="grid grid-cols-3 gap-2 text-center text-[13px]">
            <div><div className="text-muted text-[11px]">Value</div><div className="font-semibold">{money(p.value)}</div></div>
            <div><div className="text-muted text-[11px]">Paid</div><div className="font-semibold text-good">{money(paid)}</div></div>
            <div><div className="text-muted text-[11px]">Balance</div><div className={cn("font-semibold", balance > 0 && "text-crit")}>{money(balance)}</div></div>
          </div>
          <form action={recordPayment.bind(null, p.id)} className="mt-3 flex items-end gap-2">
            <label className="flex-1 text-xs text-muted">Amount received<input className="input mt-0.5" type="number" step="0.01" name="amount" required aria-label="Amount received" /></label>
            <label className="flex-1 text-xs text-muted">Note<input className="input mt-0.5" type="text" name="note" placeholder="e.g. against supply" aria-label="Note" /></label>
            <Submit className="btn-primary">Record</Submit>
          </form>
          {payments.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2">
              {payments.map((pay) => (
                <li key={pay.id} className="flex items-center justify-between gap-3 rounded-md border border-good bg-good-soft px-3 py-2">
                  <span className="text-[13px] text-ink-2">{fmtDate(pay.paidAt)}{pay.note ? <> · <span className="font-medium">{pay.note}</span></> : ""}</span>
                  <span className="font-mono text-[15px] font-semibold text-good">{money(pay.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          {balance > 0 && <Link href="/email-automation" className="link mt-3 block text-xs">Manage balance reminder recipients →</Link>}
        </Card>
        <div className="flex flex-col gap-4">
          <Card title="Tasks" sub="Created by automations as phases change">
            {tasks.map((t) => (
              <form key={t.id} action={completeTask.bind(null, t.id)} className="flex items-start gap-2 text-[13px]">
                <button type="submit" disabled={t.status === "done"} className={cn("mt-0.5 size-4 shrink-0 rounded border", t.status === "done" ? "border-good bg-good" : "border-line hover:border-accent")} aria-label="Complete" />
                <span className={cn("flex-1", t.status === "done" && "text-muted line-through")}>{t.title}<span className="text-muted"> · {L.userName(t.assignedTo)}</span></span>
                <span className="font-mono text-[11px] text-muted">{fmtShort(t.dueAt)}</span>
              </form>
            ))}
            {!tasks.length && <p className="text-xs text-muted">No tasks.</p>}
          </Card>
          <Card title="Timeline"><Timeline items={acts.map((a) => ({ at: a.createdAt, body: a.body, kind: a.kind }))} /></Card>
        </div>
      </div>
    </>
  );
}
