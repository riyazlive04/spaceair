import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { requireUser } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { money, fmtDate, fmtDateTime, ago } from "@/lib/format";
import {
  saveReminderMessage,
  scheduleReminder,
  deleteReminder,
  recordPayment,
  applyReminderTemplate,
  pauseReminders,
  markReplyAction,
  addMilestone,
  deleteMilestone,
} from "@/lib/actions";
import { defaultReminderSubject, defaultReminderBody, fillReminderTemplate } from "@/lib/reminder-template";
import { Card, PageHeader, Empty, Pill } from "@/components/ui";
import { Submit } from "@/components/client";

export const metadata = { title: "Balance reminder" };

export default async function ProjectReminder(props: PageProps<"/email-automation/[projectId]">) {
  const user = await requireUser();
  if (user.role !== "owner") redirect("/dashboard");
  const { projectId } = await props.params;
  const sp = await props.searchParams;
  const L = await lookups();

  const p = await db.query.projects.findFirst({ where: eq(S.projects.id, projectId) });
  if (!p) notFound();

  const [mailAccounts, payments, reminders, contact, templates, milestones, audit, bccRow] = await Promise.all([
    db.select().from(S.googleMailAccount),
    db.select().from(S.payments).where(eq(S.payments.projectId, projectId)),
    db.select().from(S.paymentReminders).where(eq(S.paymentReminders.projectId, projectId)),
    db.query.contacts.findFirst({ where: eq(S.contacts.accountId, p.accountId) }),
    db.select().from(S.reminderTemplates),
    db.select().from(S.paymentMilestones).where(eq(S.paymentMilestones.projectId, projectId)),
    db.select().from(S.reminderAudit).where(eq(S.reminderAudit.projectId, projectId)).orderBy(desc(S.reminderAudit.createdAt)).limit(20),
    sp.bcc ? db.query.settings.findFirst({ where: eq(S.settings.key, `broadcast-recipients:${sp.bcc}`) }) : undefined,
  ]);
  const uploadedBcc = ((bccRow?.value as string[] | undefined) ?? []).join(", ");

  const paid = payments.reduce((s, x) => s + x.amount, 0);
  const balance = p.value - paid;
  const rs = reminders.sort((a, b) => a.sendAt.getTime() - b.sendAt.getTime());
  const allReplies = rs.length ? await Promise.all(rs.map((r) => db.select().from(S.emailReplies).where(eq(S.emailReplies.reminderId, r.id)))) : [];
  const repliesByReminder = new Map<string, (typeof allReplies)[number]>();
  rs.forEach((r, i) => repliesByReminder.set(r.id, allReplies[i] ?? []));

  const subjectTemplate = p.reminderSubject ?? defaultReminderSubject(p.code);
  const bodyTemplate = p.reminderBody ?? defaultReminderBody(contact?.name ?? "Sir/Madam", p.name, p.code);
  const subjectPreview = fillReminderTemplate(subjectTemplate, { value: p.value, balance });
  const bodyPreview = fillReminderTemplate(bodyTemplate, { value: p.value, balance });
  const now = new Date();
  const isPaused = !!p.reminderPausedUntil && p.reminderPausedUntil > now;
  const milestonesSorted = milestones.slice().sort((a, b) => a.sort - b.sort);
  const milestonesTotal = milestonesSorted.reduce((s, m) => s + m.amount, 0);

  return (
    <>
      <PageHeader
        title={`${p.code} · ${p.name}`}
        sub={<>{L.acctName(p.accountId)} · <Link className="link" href={`/projects/${p.id}`}>Open project page</Link></>}
        actions={<Link href="/email-automation" className="link text-[13px]">← Back to Email automation</Link>}
      />

      {isPaused && (
        <Card className="border-warn">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[13px]">
              <span className="font-semibold text-warn">Reminders paused</span> until {fmtDate(p.reminderPausedUntil)}
              {p.reminderPauseReason ? ` — ${p.reminderPauseReason}` : ""}
            </div>
            <form action={pauseReminders.bind(null, p.id)}>
              <Submit className="btn-sm">Resume now</Submit>
            </form>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
        <Card title="Value"><div className="text-[22px] font-semibold font-mono">{money(p.value)}</div></Card>
        <Card title="Paid"><div className="text-[22px] font-semibold font-mono text-good">{money(paid)}</div></Card>
        <Card title="Balance"><div className="text-[22px] font-semibold font-mono text-crit">{money(balance)}</div></Card>
      </div>

      <Card title="Record a payment" sub="Marks the amount received against this project. Updates Paid/Balance immediately.">
        <form action={recordPayment.bind(null, p.id)} className="flex items-end gap-2">
          <label className="field text-[11.5px]">Amount received<input className="input" type="number" step="0.01" name="amount" required aria-label="Amount received" /></label>
          <label className="field flex-1 text-[11.5px]">Note<input className="input" type="text" name="note" placeholder="e.g. against supply" aria-label="Note" /></label>
          <Submit className="btn-primary">Record</Submit>
        </form>
        {payments.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
            {payments
              .slice()
              .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime())
              .map((pay) => (
                <li key={pay.id} className="flex items-center justify-between gap-3 rounded-md border border-good bg-good-soft px-3 py-2">
                  <span className="text-[13px] text-ink-2">{fmtDate(pay.paidAt)}{pay.note ? <> · <span className="font-medium">{pay.note}</span></> : ""}</span>
                  <span className="font-mono text-[15px] font-semibold text-good">{money(pay.amount)}</span>
                </li>
              ))}
          </ul>
        )}
        <div className="mt-3 border-t border-line pt-3">
          <a className="link text-xs" href={`/api/projects/${p.id}/statement`}>Download statement of account (PDF) →</a>
          <span className="ml-2 text-[11.5px] text-muted">also attached automatically to every scheduled reminder email</span>
        </div>
      </Card>

      <Card title="Payment milestones" sub="Optional breakdown of the order value for your own tracking — the balance above is always value minus actual payments received.">
        {milestonesSorted.length > 0 && (
          <ul className="mb-3 flex flex-col gap-1.5">
            {milestonesSorted.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface-2 px-3 py-2 text-[13px]">
                <span>{m.label}{m.dueDate ? <span className="text-muted"> · due {fmtDate(m.dueDate)}</span> : ""}</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono">{money(m.amount)}</span>
                  <form action={deleteMilestone.bind(null, m.id)}><button type="submit" className="text-[11px] text-crit hover:underline">remove</button></form>
                </div>
              </li>
            ))}
            {milestonesTotal !== p.value && (
              <li className="text-[11.5px] text-muted">Milestones total {money(milestonesTotal)}, order value is {money(p.value)}.</li>
            )}
          </ul>
        )}
        <form action={addMilestone.bind(null, p.id)} className="flex flex-wrap items-end gap-2">
          <label className="field text-[11.5px]">Label<input className="input" type="text" name="label" placeholder="e.g. Against supply" required aria-label="Milestone label" /></label>
          <label className="field text-[11.5px]">Amount<input className="input" type="number" step="0.01" name="amount" required aria-label="Milestone amount" /></label>
          <label className="field text-[11.5px]">Due date<input className="input" type="date" name="dueDate" aria-label="Milestone due date" /></label>
          <Submit className="btn-sm">Add</Submit>
        </form>
      </Card>

      <Card title="Scheduled reminders" sub="Fires automatically at the date/time set, if a balance is still outstanding and reminders aren't paused.">
        {rs.length > 0 ? (
          <ul className="flex flex-col gap-2 text-[13px]">
            {rs.map((r) => {
              const rReplies = repliesByReminder.get(r.id) ?? [];
              return (
                <li key={r.id}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={r.sentAt ? "text-muted line-through" : ""}>{fmtDateTime(r.sendAt)}</span>
                    {r.sentAt ? <span className="text-[11px] text-good">sent</span> : (
                      <form action={deleteReminder.bind(null, r.id)}><button type="submit" className="text-[11px] text-crit hover:underline">remove</button></form>
                    )}
                  </div>
                  {rReplies.map((rep) => (
                    <div key={rep.id} id={`reply-${rep.id}`} className="mt-1 rounded-md border border-line bg-surface-2 p-2 scroll-mt-20 target:border-accent target:ring-2 target:ring-accent">
                      <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
                        <span className="font-medium text-ink-2">{rep.fromAddress}</span>
                        <span>{fmtDateTime(rep.receivedAt)}</span>
                      </div>
                      {rep.subject && <div className="mt-0.5 text-[11.5px] font-medium">{rep.subject}</div>}
                      <div className="mt-0.5 whitespace-pre-wrap text-[12px] text-ink-2">{rep.body.slice(0, 800)}</div>
                      {rep.action ? (
                        <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                          <Pill tone={rep.action === "disputed" ? "crit" : rep.action === "promised" ? "warn" : "neutral"}>
                            {rep.action === "promised" ? `Promised by ${rep.actionDate ? fmtDate(rep.actionDate) : "—"}` : rep.action === "disputed" ? "Disputed" : "Noted"}
                          </Pill>
                          {rep.actionNote && <span className="text-muted">{rep.actionNote}</span>}
                        </div>
                      ) : (
                        <form action={markReplyAction.bind(null, rep.id)} className="mt-1.5 flex flex-wrap items-end gap-1.5">
                          <select className="input w-auto py-1 text-[11.5px]" name="action" aria-label="Mark reply" defaultValue="">
                            <option value="" disabled>Mark as…</option>
                            <option value="promised">Promised to pay by</option>
                            <option value="disputed">Disputed</option>
                            <option value="noted">Just a note</option>
                          </select>
                          <input className="input w-auto py-1 text-[11.5px]" type="date" name="actionDate" aria-label="Promised date" />
                          <input className="input w-auto flex-1 py-1 text-[11.5px]" type="text" name="actionNote" placeholder="Note" aria-label="Note" />
                          <Submit className="btn-sm">Save</Submit>
                        </form>
                      )}
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>No reminders scheduled yet.</Empty>
        )}
        <form action={scheduleReminder.bind(null, p.id)} className="mt-3 flex items-end gap-2">
          <label className="field text-[11.5px]">Date<input className="input" type="date" name="date" required aria-label="Reminder date" /></label>
          <label className="field text-[11.5px]">Time<input className="input" type="time" name="time" defaultValue="09:00" aria-label="Reminder time" /></label>
          <Submit className="btn-primary">Add</Submit>
        </form>
        {!isPaused && (
          <form action={pauseReminders.bind(null, p.id)} className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
            <label className="field text-[11.5px]">Pause reminders until<input className="input" type="date" name="date" required aria-label="Pause until" /></label>
            <label className="field flex-1 text-[11.5px]">Reason<input className="input" type="text" name="reason" placeholder="e.g. client on leave" aria-label="Pause reason" /></label>
            <Submit className="btn-sm">Pause</Submit>
          </form>
        )}
      </Card>

      <Card
        title="Reminder email"
        sub="Editable per project — shows today's real value/balance below. Save updates the wording; the amount will always be current the next time this page loads or a reminder sends, even after payments are recorded."
      >
        {sp.error && <p className="mb-3 text-[13px] text-crit">{sp.error}</p>}
        {templates.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2 border-b border-line pb-3">
            {templates.map((t) => (
              <form key={t.id} action={applyReminderTemplate.bind(null, p.id, t.id)}>
                <button type="submit" className="btn-sm">{t.name}</button>
              </form>
            ))}
          </div>
        )}
        <form action="/api/broadcast/parse-recipients" method="post" encType="multipart/form-data" className="mb-3 flex flex-wrap items-end gap-3 border-b border-line pb-3">
          <input type="hidden" name="back" value={`/email-automation/${p.id}`} />
          <input type="hidden" name="field" value="bcc" />
          <label className="field flex-1 text-[11.5px]">
            Load many BCC recipients from a file (.xlsx / .csv)
            <input className="input py-2" type="file" name="file" accept=".xlsx,.csv" required />
          </label>
          <Submit className="btn-sm" pendingText="Reading…">Load into BCC</Submit>
        </form>
        <form action={saveReminderMessage.bind(null, p.id)} className="flex flex-col gap-3">
          {mailAccounts.length > 1 && (
            <label className="field text-[11.5px]">
              Send from
              <select className="input" name="reminderAccountId" defaultValue={p.reminderAccountId ?? ""} aria-label="Sending account">
                <option value="">{mailAccounts[0]?.email} (default)</option>
                {mailAccounts.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
              </select>
            </label>
          )}
          <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
            <label className="field text-[11.5px]">To<input className="input" type="text" name="reminderTo" defaultValue={p.reminderTo ?? contact?.email ?? ""} placeholder="client@example.com" aria-label="To" /></label>
            <label className="field text-[11.5px]">CC — comma-separated for several<textarea className="input" rows={2} name="reminderCc" defaultValue={p.reminderCc ?? ""} placeholder="accounts@spaceair.in, pm@spaceair.in" aria-label="CC" /></label>
            <label className="field text-[11.5px]">BCC — comma-separated for many<textarea className="input" rows={2} name="reminderBcc" defaultValue={uploadedBcc || (p.reminderBcc ?? "")} aria-label="BCC" /></label>
          </div>
          <label className="field text-[11.5px]">Subject<input className="input" type="text" name="reminderSubject" defaultValue={subjectPreview} aria-label="Subject" /></label>
          <label className="field text-[11.5px]">Body<textarea className="input min-h-[420px] text-[14px] leading-relaxed" name="reminderBody" rows={18} defaultValue={bodyPreview} aria-label="Body" /></label>
          <Submit className="btn-primary self-start">Save email</Submit>
        </form>
      </Card>

      {audit.length > 0 && (
        <Card title="Reminder history" sub="Who changed this project's reminder settings, and when.">
          <ul className="flex flex-col">
            {audit.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 border-t border-line py-2 text-[13px] first:border-0 first:pt-0">
                <span>{a.summary}{a.userId ? <span className="text-muted"> · {L.userName(a.userId)}</span> : ""}</span>
                <span className="font-mono text-[11px] text-muted">{ago(a.createdAt, now)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
