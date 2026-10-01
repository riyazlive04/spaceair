import { redirect } from "next/navigation";
import Link from "next/link";
import { inArray, desc, eq } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { requireUser } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { money, fmtDateTime, localDateInput, localTimeInput, cn } from "@/lib/format";
import { bulkScheduleReminders, createBroadcast, createPersonalizedBroadcast, discardPersonalizedRows, updateBroadcast, deleteBroadcast } from "@/lib/actions";
import type { PersonalizedRow } from "@/lib/recipients-import";
import { Card, PageHeader, Empty, Pill } from "@/components/ui";
import { Submit, SelectAllCheckbox } from "@/components/client";
import { isGoogleOAuthConfigured } from "@/lib/google-oauth";

export const metadata = { title: "Email automation" };

export default async function EmailAutomation(props: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  if (user.role !== "owner") redirect("/dashboard");
  const sp = await props.searchParams;
  const L = await lookups();
  const [mailAccounts, projects, payments, broadcasts, broadcastRecipients, broadcastReplies, rowsSetting] = await Promise.all([
    db.select().from(S.googleMailAccount),
    db.select().from(S.projects).where(inArray(S.projects.status, ["handover", "execution"])),
    db.select().from(S.payments),
    db.select().from(S.broadcasts).orderBy(desc(S.broadcasts.createdAt)).limit(5),
    db.select().from(S.broadcastRecipients),
    db.select().from(S.broadcastReplies),
    sp.rows ? db.query.settings.findFirst({ where: eq(S.settings.key, `broadcast-rows:${sp.rows}`) }) : undefined,
  ]);
  const recipientsByBroadcast = new Map<string, typeof broadcastRecipients>();
  for (const r of broadcastRecipients) recipientsByBroadcast.set(r.broadcastId, [...(recipientsByBroadcast.get(r.broadcastId) ?? []), r]);
  const repliesByRecipient = new Map<string, typeof broadcastReplies>();
  for (const rep of broadcastReplies) repliesByRecipient.set(rep.recipientId, [...(repliesByRecipient.get(rep.recipientId) ?? []), rep]);
  const previewRows = (rowsSetting?.value as PersonalizedRow[] | undefined) ?? [];
  const oauthConfigured = isGoogleOAuthConfigured();
  const paidByProject = new Map<string, number>();
  for (const pay of payments) paidByProject.set(pay.projectId, (paidByProject.get(pay.projectId) ?? 0) + pay.amount);
  const due = projects
    .map((p) => ({ p, paid: paidByProject.get(p.id) ?? 0, balance: p.value - (paidByProject.get(p.id) ?? 0) }))
    .filter((x) => x.balance > 0)
    .sort((a, b) => b.balance - a.balance);

  return (
    <>
      <PageHeader
        title="Email automation"
        sub="The Gmail connection, balance payment reminders and who receives them, in one place."
      />
      {sp.error && <p className="card border-crit text-[13px] text-crit">{sp.error}</p>}
      <Card title="Email sending" sub="Connect one or more Gmail accounts. Each project's balance reminders can be sent from whichever one you choose.">
        {sp.googleMailConnected && <p className="mb-2 text-[13px] text-good">Connected as {sp.googleMailConnected}.</p>}
        {sp.googleMailError && <p className="mb-2 text-[13px] text-crit">Could not connect: {sp.googleMailError}</p>}
        {!oauthConfigured ? (
          <p className="text-[13px] text-muted">
            Set <code>GOOGLE_OAUTH_CLIENT_ID</code> and <code>GOOGLE_OAUTH_CLIENT_SECRET</code> in the environment to enable this.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {mailAccounts.map((a) => (
              <div key={a.id} className="flex items-center gap-3 text-[13px]">
                <span className="font-mono">{a.email}</span>
                <form action="/api/auth/google-mail/disconnect" method="post">
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit" className="btn-secondary">Disconnect</button>
                </form>
              </div>
            ))}
            <a className="btn btn-primary self-start" href="/api/auth/google-mail/authorize">{mailAccounts.length ? "Connect another account" : "Connect Google Mail"}</a>
          </div>
        )}
      </Card>

      {!mailAccounts.length ? (
        <Card title="Broadcast &amp; personalized emails" sub="One-off emails not tied to a project's balance.">
          <p className="text-[13px] text-muted">Connect a Gmail account above first.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 max-xl:grid-cols-1">
          <Card
            className="border-t-4 border-t-accent"
            title={
              <span className="inline-flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-md bg-accent/15 text-[15px] text-accent">✦</span>
                Personalized emails
              </span>
            }
            sub="Upload a file — one row, one fully distinct email. Own name, subject, body, CC/BCC and send time per recipient. No project code, no shared content."
          >
            {sp.pickSheet ? (
              <div className="rounded-lg border border-line bg-surface-2 p-3">
                <h3 className="label">This workbook has several sheets — which one?</h3>
                <p className="mt-0.5 mb-2 text-[12.5px] text-muted">Only one sheet is read at a time. Pick the sheet with your recipients.</p>
                <div className="flex flex-wrap gap-2">
                  {(sp.sheets ?? "").split(",").filter(Boolean).map((name) => (
                    <form key={name} action="/api/broadcast/parse-recipients" method="post">
                      <input type="hidden" name="upload" value={sp.pickSheet} />
                      <input type="hidden" name="sheet" value={name} />
                      <button type="submit" className="btn">{name}</button>
                    </form>
                  ))}
                </div>
              </div>
            ) : previewRows.length > 0 ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2">
                  <p className="text-[12.5px]">
                    <span className="font-semibold text-accent">{previewRows.length} email{previewRows.length === 1 ? "" : "s"}</span> parsed — edit any field below, then queue.
                  </p>
                  <form action={discardPersonalizedRows.bind(null, sp.rows ?? "")}>
                    <button type="submit" className="btn-sm">Reset — clear this upload</button>
                  </form>
                </div>
                <form action={createPersonalizedBroadcast} className="flex flex-col gap-3">
                  <input type="hidden" name="rows" value={sp.rows} />
                  <div className="flex flex-col gap-3">
                    {previewRows.map((r, i) => (
                      <details key={i} className="group rounded-lg border border-line bg-surface-2 p-3 open:bg-surface">
                        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 text-[12.5px] [&::-webkit-details-marker]:hidden">
                          <span className="font-medium">{r.name || r.email} <span className="text-muted font-normal">· {r.email}</span></span>
                          <span className="flex items-center gap-2 text-muted">
                            <span className="max-w-[220px] truncate">{r.subject}</span>
                            <span className="transition-transform group-open:rotate-180">▾</span>
                          </span>
                        </summary>
                        <div className="mt-3 flex flex-col gap-2">
                          <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1">
                            <label className="field text-[11.5px]">Name<input className="input" type="text" name={`row_${i}_name`} defaultValue={r.name ?? ""} aria-label="Name" /></label>
                            <label className="field text-[11.5px]">Email<input className="input" type="email" name={`row_${i}_email`} defaultValue={r.email} required aria-label="Email" /></label>
                          </div>
                          <label className="field text-[11.5px]">Subject<input className="input" type="text" name={`row_${i}_subject`} defaultValue={r.subject} required aria-label="Subject" /></label>
                          <label className="field text-[11.5px]">Body<textarea className="input" name={`row_${i}_body`} rows={5} defaultValue={r.body} required aria-label="Body" /></label>
                          <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1">
                            <label className="field text-[11.5px]">CC<input className="input" type="text" name={`row_${i}_cc`} defaultValue={r.cc ?? ""} aria-label="CC" /></label>
                            <label className="field text-[11.5px]">BCC<input className="input" type="text" name={`row_${i}_bcc`} defaultValue={r.bcc ?? ""} aria-label="BCC" /></label>
                          </div>
                          <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1">
                            <label className="field text-[11.5px]">Send date (blank = ASAP)<input className="input" type="date" name={`row_${i}_date`} defaultValue={r.date ?? ""} aria-label="Send date" /></label>
                            <label className="field text-[11.5px]">Send time<input className="input" type="time" name={`row_${i}_time`} defaultValue={r.time ?? "09:00"} aria-label="Send time" /></label>
                          </div>
                        </div>
                      </details>
                    ))}
                  </div>
                  <input type="hidden" name="count" value={previewRows.length} />
                  {mailAccounts.length > 1 && (
                    <div className="rounded-lg border border-line bg-surface-2 p-3">
                      <label className="field text-[11.5px]">
                        Send all {previewRows.length} of these from
                        <select className="input" name="accountId" defaultValue={mailAccounts[0].id} required aria-label="Sending account">
                          {mailAccounts.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
                        </select>
                      </label>
                      <p className="mt-1 text-[11px] text-muted">You have {mailAccounts.length} Gmail accounts connected — pick which one sends this whole batch. To split a batch across accounts, upload and queue it in two passes, one per account.</p>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <Submit className="btn-primary" pendingText="Queuing…">Queue all {previewRows.length} emails</Submit>
                  </div>
                </form>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-line bg-surface-2 p-6 text-center">
                <span className="grid size-10 place-items-center rounded-full bg-accent/15 text-[18px] text-accent">⇪</span>
                <p className="text-[12.5px] text-muted">
                  Columns: <b>Email</b>, <b>Subject</b>, <b>Body</b>, plus optional <b>Name</b>, <b>CC</b>, <b>BCC</b>, <b>Date</b>, <b>Time</b>. Each row becomes its own distinct email — you&apos;ll preview everything before it&apos;s queued.
                </p>
                <form action="/api/broadcast/parse-recipients" method="post" encType="multipart/form-data" className="flex w-full flex-wrap items-end justify-center gap-3">
                  <label className="field flex-1">Personalized emails file (.xlsx / .csv)<input className="input py-2" type="file" name="file" accept=".xlsx,.csv" required /></label>
                  <Submit className="btn-primary" pendingText="Reading…">Load from file</Submit>
                </form>
              </div>
            )}
          </Card>

          <Card
            className="border-t-4 border-t-line"
            title={
              <span className="inline-flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-md bg-surface-2 text-[15px]">✉</span>
                Broadcast emails
              </span>
            }
            sub="One shared subject/body/CC/BCC sent to a list of recipients you type or paste in. Sent gradually in the background to stay within Gmail's sending limits."
          >
            <form action={createBroadcast} className="flex flex-col gap-3">
              {mailAccounts.length > 1 && (
                <div className="rounded-lg border border-line bg-surface-2 p-3">
                  <label className="field text-[11.5px]">
                    Send this broadcast from
                    <select className="input" name="accountId" defaultValue={mailAccounts[0].id} required aria-label="Sending account">
                      {mailAccounts.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
                    </select>
                  </label>
                  <p className="mt-1 text-[11px] text-muted">You have {mailAccounts.length} Gmail accounts connected — pick which one sends this batch. To split recipients across accounts, create two broadcasts, one per account.</p>
                </div>
              )}
              <label className="field text-[11.5px]">
                Recipients — one email per line (or comma-separated), all getting the same subject/body below.
                <textarea className="input" name="recipients" rows={6} placeholder={"client1@example.com\nclient2@example.com"} required aria-label="Recipients" />
              </label>
              <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
                <label className="field text-[11.5px]">CC — comma-separated, optional<input className="input" type="text" name="cc" placeholder="accounts@spaceair.in" aria-label="CC" /></label>
                <label className="field text-[11.5px]">BCC — comma-separated, optional<input className="input" type="text" name="bcc" aria-label="BCC" /></label>
              </div>
              <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
                <label className="field text-[11.5px]">Send date (optional — leave blank to send ASAP)<input className="input" type="date" name="date" aria-label="Send date" /></label>
                <label className="field text-[11.5px]">Send time<input className="input" type="time" name="time" defaultValue="09:00" aria-label="Send time" /></label>
              </div>
              <label className="field text-[11.5px]">Subject<input className="input" type="text" name="subject" required aria-label="Subject" /></label>
              <label className="field text-[11.5px]">Body<textarea className="input min-h-[180px]" name="body" rows={7} required aria-label="Body" /></label>
              <Submit className="btn-primary self-start" pendingText="Queuing…">Queue broadcast</Submit>
            </form>
          </Card>
        </div>
      )}

      <Card title="Sent broadcasts" sub={`${broadcasts.length} most recent broadcast${broadcasts.length === 1 ? "" : "s"} — personalized imports and shared-content broadcasts both land here.`}>
          {!broadcasts.length && <Empty>No broadcasts sent yet.</Empty>}
          {broadcasts.map((b) => {
            const rs = recipientsByBroadcast.get(b.id) ?? [];
            const sent = rs.filter((r) => r.status === "sent").length;
            const failed = rs.filter((r) => r.status === "failed").length;
            const queuedRows = rs.filter((r) => r.status === "queued");
            const queued = queuedRows.length;
            const editable = queued > 0;
            const dateStr = localDateInput(b.sendAfter);
            const timeStr = localTimeInput(b.sendAfter);
            const replies = rs.flatMap((r) => (repliesByRecipient.get(r.id) ?? []).map((rep) => ({ ...rep, recipientEmail: r.email })));
            const personalized = rs.some((r) => r.subject != null);
            const account = mailAccounts.find((a) => a.id === b.accountId) ?? mailAccounts[0];
            const isDone = queued === 0 && rs.length > 0;
            return (
              <details key={b.id} id={`broadcast-${b.id}`} className="group border-t border-line py-3 text-[13px] first:border-0 first:pt-0">
                <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full text-[14px]", personalized ? "bg-accent/15 text-accent" : "bg-surface-2")}>
                      {personalized ? "✦" : "✉"}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-semibold">{b.subject}</span>
                        {personalized && <Pill tone="info">personalized</Pill>}
                        {isDone ? <Pill tone="good">done</Pill> : <Pill tone="warn">in progress</Pill>}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-muted">
                        <span>{rs.length} recipient{rs.length === 1 ? "" : "s"}</span>
                        {account && <span className="font-mono">{account.email}</span>}
                        {replies.length > 0 && <span className="font-medium text-accent">{replies.length} {replies.length === 1 ? "reply" : "replies"}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-mono text-[11px] text-muted">{fmtDateTime(b.createdAt)}</span>
                    {(editable || replies.length > 0) && <span className="text-muted transition-transform group-open:rotate-180">▾</span>}
                  </div>
                </summary>
                {b.sendAfter > new Date() && queued > 0 && (
                  <p className="mt-1 text-[11.5px] text-muted">Scheduled from {fmtDateTime(b.sendAfter)}</p>
                )}
                <div className="mt-2 flex gap-2">
                  <Pill tone="good">{sent} sent</Pill>
                  {queued > 0 && <Pill tone="warn">{queued} queued</Pill>}
                  {failed > 0 && <Pill tone="crit">{failed} failed</Pill>}
                  {replies.length > 0 && <Pill tone="info">{replies.length} {replies.length === 1 ? "reply" : "replies"}</Pill>}
                </div>
                {replies.length > 0 && (
                  <div className="mt-2 flex flex-col gap-2">
                    {replies.map((rep) => (
                      <div key={rep.id} id={`reply-${rep.id}`} className="rounded-md border border-line bg-surface-2 p-2 scroll-mt-20 target:border-accent target:ring-2 target:ring-accent">
                        <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
                          <span className="font-medium text-ink-2">{rep.fromAddress || rep.recipientEmail}</span>
                          <span>{fmtDateTime(rep.receivedAt)}</span>
                        </div>
                        {rep.subject && <div className="mt-0.5 text-[11.5px] font-medium">{rep.subject}</div>}
                        <div className="mt-0.5 whitespace-pre-wrap text-[12px] text-ink-2">{rep.body.slice(0, 800)}</div>
                      </div>
                    ))}
                  </div>
                )}
                {personalized && queued > 0 && (
                  <div className="mt-3 rounded-lg border border-line bg-surface-2 p-3">
                    <p className="text-[11.5px] text-muted">
                      Personalized broadcast — each queued recipient has its own subject/body/send time, so bulk editing isn&apos;t available here.
                    </p>
                    <form action={deleteBroadcast.bind(null, b.id)} className="mt-2">
                      <button type="submit" className="text-[11.5px] text-crit hover:underline">Delete this broadcast (removes all queued recipients)</button>
                    </form>
                  </div>
                )}
                {editable && !personalized && (
                  <div className="mt-3 flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-3">
                    <form action={updateBroadcast.bind(null, b.id)} className="flex flex-col gap-2">
                      <label className="field text-[11.5px]">
                        Recipients still queued (edit or remove — already-sent ones can&apos;t be un-sent)
                        <textarea className="input" name="recipients" rows={4} defaultValue={queuedRows.map((r) => r.email).join("\n")} aria-label="Queued recipients" />
                      </label>
                      <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1">
                        <label className="field text-[11.5px]">CC<input className="input" type="text" name="cc" defaultValue={b.cc ?? ""} aria-label="CC" /></label>
                        <label className="field text-[11.5px]">BCC<input className="input" type="text" name="bcc" defaultValue={b.bcc ?? ""} aria-label="BCC" /></label>
                      </div>
                      <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1">
                        <label className="field text-[11.5px]">Send date<input className="input" type="date" name="date" defaultValue={dateStr} aria-label="Send date" /></label>
                        <label className="field text-[11.5px]">Send time<input className="input" type="time" name="time" defaultValue={timeStr} aria-label="Send time" /></label>
                      </div>
                      <label className="field text-[11.5px]">Subject<input className="input" type="text" name="subject" defaultValue={b.subject} required aria-label="Subject" /></label>
                      <label className="field text-[11.5px]">Body<textarea className="input" name="body" rows={5} defaultValue={b.body} required aria-label="Body" /></label>
                      <div className="flex gap-2">
                        <Submit className="btn-primary btn-sm">Save changes</Submit>
                      </div>
                    </form>
                    <form action={deleteBroadcast.bind(null, b.id)}>
                      <button type="submit" className="text-[11.5px] text-crit hover:underline">Delete this broadcast (removes all queued recipients)</button>
                    </form>
                  </div>
                )}
              </details>
            );
          })}
      </Card>

      <Card title={`Projects with a balance due (${due.length})`} sub="Select several projects to schedule the same reminder date/time across all of them at once, or click one to open its own page.">
        {!due.length && <Empty>No project has an outstanding balance.</Empty>}
        {due.length > 0 && (
          <form action={bulkScheduleReminders} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface-2 p-3">
              <label className="flex items-center gap-2 text-[12.5px] font-medium">
                <SelectAllCheckbox itemName="projectId" label="Select all projects" />
                Select all
              </label>
              <label className="field text-[11.5px]">Date<input className="input" type="date" name="date" required aria-label="Bulk reminder date" /></label>
              <label className="field text-[11.5px]">Time<input className="input" type="time" name="time" defaultValue="09:00" aria-label="Bulk reminder time" /></label>
              <Submit className="btn-primary" pendingText="Scheduling…">Schedule for selected</Submit>
            </div>
            <div className="flex flex-col gap-2">
              {due.map(({ p, paid, balance }, i) => (
                <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-accent bg-surface-2 p-4">
                  <input type="checkbox" name="projectId" value={p.id} className="size-4" aria-label={`Select ${p.code}`} />
                  <Link href={`/email-automation/${p.id}`} className="flex flex-1 flex-wrap items-center justify-between gap-2 hover:brightness-95">
                    <div>
                      <span className="mr-2 rounded bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-accent">Project {i + 1}</span>
                      <span className="font-mono text-xs text-accent">{p.code}</span>
                      <div className="text-[15px] font-semibold">{p.name} · {L.acctName(p.accountId)}</div>
                    </div>
                    <div className="flex gap-4 text-center text-[12.5px]">
                      <div><div className="text-muted text-[10.5px]">Value</div><div className="font-mono">{money(p.value)}</div></div>
                      <div><div className="text-muted text-[10.5px]">Paid</div><div className="font-mono">{money(paid)}</div></div>
                      <div><div className="text-muted text-[10.5px]">Balance</div><div className="font-mono text-crit">{money(balance)}</div></div>
                    </div>
                  </Link>
                </div>
              ))}
            </div>
          </form>
        )}
      </Card>
    </>
  );
}
