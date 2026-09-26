import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { requireUser } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { STAGES, LOST_REASONS, stageProb } from "@/lib/constants";
import { fmtDate, fmtShort, money, quoteTotals, cn } from "@/lib/format";
import { addActivity, createQuotation, moveStageForm, updateOpportunity, completeTask } from "@/lib/actions";
import { Card, Div, PageHeader, Pill, StagePill, Timeline, Empty } from "@/components/ui";
import { Submit } from "@/components/client";

const Q_TONE = { draft: "neutral", pending_approval: "warn", approved: "info", sent: "info", accepted: "good", rejected: "crit", superseded: "neutral" } as const;

export default async function OpportunityDetail(props: PageProps<"/opportunities/[id]">) {
  await requireUser();
  const { id } = await props.params;
  const o = await db.query.opportunities.findFirst({ where: eq(S.opportunities.id, id) });
  if (!o) notFound();
  const L = await lookups();
  const now = new Date();
  const [acts, quotes, tasks, contacts, project] = await Promise.all([
    db.select().from(S.activities).where(and(eq(S.activities.entityType, "opportunity"), eq(S.activities.entityId, id))).orderBy(desc(S.activities.createdAt)),
    db.select().from(S.quotations).where(eq(S.quotations.opportunityId, id)).orderBy(desc(S.quotations.revision)),
    db.select().from(S.tasks).where(and(eq(S.tasks.entityType, "opportunity"), eq(S.tasks.entityId, id))).orderBy(S.tasks.dueAt),
    db.select().from(S.contacts).where(eq(S.contacts.accountId, o.accountId)),
    db.query.projects.findFirst({ where: eq(S.projects.opportunityId, id) }),
  ]);
  const items = await Promise.all(quotes.map((q) => db.select().from(S.quoteItems).where(eq(S.quoteItems.quotationId, q.id))));
  const owners = L.users.filter((u) => ["sales", "branch_head"].includes(u.role));
  const overdue = o.nextActionDue && o.nextActionDue < now && !["won", "lost"].includes(o.stage);

  return (
    <>
      <PageHeader
        title={L.acctName(o.accountId)}
        sub={<><span className="font-mono">{o.code}</span> · {o.title}</>}
        actions={
          <>
            <StagePill stage={o.stage} />
            <form action={createQuotation.bind(null, o.id)}><Submit pendingText="Creating…">+ New quotation</Submit></form>
          </>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-4 max-lg:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Stage">
            <div className="flex flex-wrap gap-1.5">
              {STAGES.map((s) => {
                const idx = STAGES.findIndex((x) => x.key === o.stage);
                const me = STAGES.findIndex((x) => x.key === s.key);
                return (
                  <span key={s.key} className={cn("rounded-md px-2.5 py-1 text-xs font-medium", s.key === o.stage ? "bg-accent text-accent-ink" : me < idx && o.stage !== "lost" && s.key !== "lost" ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted")}>
                    {s.label}
                  </span>
                );
              })}
            </div>
            <form action={moveStageForm.bind(null, o.id)} className="flex flex-wrap items-center gap-2">
              <select name="stage" defaultValue={o.stage} className="input w-auto" aria-label="Stage">{STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
              <select name="lostReason" className="input w-auto" aria-label="Lost reason (only if lost)"><option value="">Lost reason (if lost)</option>{LOST_REASONS.map((r) => <option key={r}>{r}</option>)}</select>
              <Submit className="btn-primary">Update stage</Submit>
            </form>
          </Card>
          <Card title="Quotations" sub="BOQ-based, with a revision history and approvals by delegation">
            {quotes.map((q, i) => {
              const t = quoteTotals(items[i], q.discountPct, q.gstPct);
              return (
                <Link key={q.id} href={`/quotations/${q.id}`} className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2 hover:border-accent">
                  <span className="font-mono text-[12.5px]">{q.code} R{q.revision}</span>
                  <span className="flex-1 text-xs text-muted">{fmtDate(q.createdAt)}{q.kind === "amc_renewal" && " · AMC renewal"}</span>
                  <span className="font-mono text-[12.5px]">{money(t.net)}</span>
                  <Pill tone={Q_TONE[q.status]}>{q.status.replace("_", " ")}</Pill>
                </Link>
              );
            })}
            {!quotes.length && <Empty>No quotation yet. Click "New quotation" to start from a {o.division} BOQ template.</Empty>}
          </Card>
          <Card title="Log activity">
            <form action={addActivity.bind(null, "opportunity", o.id)} className="flex flex-wrap gap-2">
              <select name="kind" className="input w-auto" aria-label="Type"><option value="call">Call</option><option value="meeting">Meeting</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="note">Note</option></select>
              <input name="body" className="input min-w-[240px] flex-1" placeholder="e.g. Site survey done with FM; drawings expected Friday" aria-label="Activity" />
              <Submit className="btn-primary">Add</Submit>
            </form>
            <Timeline items={acts.map((a) => ({ at: a.createdAt, body: a.body, kind: a.kind, who: a.userId ? L.userName(a.userId) : undefined }))} />
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card title="Deal">
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-[13px]">
              <dt className="text-muted">Value</dt><dd className="font-semibold">{money(o.value)} <span className="font-normal text-muted">basic, excl. GST</span></dd>
              <dt className="text-muted">Weighted</dt><dd>{money((o.value * stageProb(o.stage)) / 100)} ({stageProb(o.stage)}%)</dd>
              <dt className="text-muted">Division</dt><dd><Div d={o.division} /></dd>
              {o.tonnage && (<><dt className="text-muted">Capacity</dt><dd>{o.tonnage} TR</dd></>)}
              <dt className="text-muted">Branch</dt><dd>{o.branch}</dd>
              <dt className="text-muted">Source</dt><dd>{o.source}</dd>
              <dt className="text-muted">Owner</dt><dd>{L.userName(o.ownerId)}</dd>
              <dt className="text-muted">Client</dt><dd><Link className="link" href={`/clients/${o.accountId}`}>{L.acctName(o.accountId)}</Link></dd>
              {o.lostReason && (<><dt className="text-muted">Lost reason</dt><dd className="text-crit">{o.lostReason}</dd></>)}
              {project && (<><dt className="text-muted">Project</dt><dd><Link className="link" href={`/projects/${project.id}`}>{project.code}</Link></dd></>)}
            </dl>
          </Card>
          <Card title="Next action" sub={overdue ? <span className="text-crit">Overdue: the owner and branch head are being reminded</span> : undefined}>
            <form action={updateOpportunity.bind(null, o.id)} className="flex flex-col gap-2">
              <label className="field">What<input className="input" name="nextAction" defaultValue={o.nextAction ?? ""} /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="field">When<input className="input" type="date" name="nextActionDue" defaultValue={o.nextActionDue?.toISOString().slice(0, 10)} /></label>
                <label className="field">Value (₹ L)<input className="input" type="number" step="0.1" name="value" defaultValue={Math.round(o.value / 1e3) / 100} /></label>
              </div>
              <label className="field">Owner<select className="input" name="ownerId" defaultValue={o.ownerId ?? ""}>{owners.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.branch}</option>)}</select></label>
              <Submit className="btn-primary self-start">Save</Submit>
            </form>
          </Card>
          <Card title="Tasks">
            {tasks.map((t) => (
              <form key={t.id} action={completeTask.bind(null, t.id)} className="flex items-start gap-2 text-[13px]">
                <button type="submit" disabled={t.status === "done"} className={cn("mt-0.5 size-4 shrink-0 rounded border", t.status === "done" ? "border-good bg-good" : "border-line hover:border-accent")} aria-label="Complete" />
                <span className={cn("flex-1", t.status === "done" && "text-muted line-through")}>{t.title}</span>
                <span className="font-mono text-[11px] text-muted">{fmtShort(t.dueAt)}</span>
              </form>
            ))}
            {!tasks.length && <p className="text-xs text-muted">No tasks.</p>}
          </Card>
          <Card title="Contacts">
            {contacts.map((c) => (
              <div key={c.id} className="text-[13px]"><div className="font-medium">{c.name}</div><div className="text-xs text-muted">{c.role} · {c.phone}</div></div>
            ))}
          </Card>
        </div>
      </div>
    </>
  );
}
