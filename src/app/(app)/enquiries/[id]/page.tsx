import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { requireUser } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { ago, fmtDateTime, money, HOUR } from "@/lib/format";
import { convertEnquiry, disqualifyEnquiry, reassignEnquiry, respondEnquiry } from "@/lib/actions";
import { Card, Div, PageHeader, Pill, Timeline } from "@/components/ui";
import { Reveal, Submit, AutoSubmitSelect } from "@/components/client";

export default async function EnquiryDetail(props: PageProps<"/enquiries/[id]">) {
  await requireUser();
  const { id } = await props.params;
  const e = await db.query.enquiries.findFirst({ where: eq(S.enquiries.id, id) });
  if (!e) notFound();
  const L = await lookups();
  const now = new Date();
  const acts = await db.select().from(S.activities).where(and(eq(S.activities.entityType, "enquiry"), eq(S.activities.entityId, id))).orderBy(desc(S.activities.createdAt));
  const msgs = await db.select().from(S.outbox).where(and(eq(S.outbox.relatedType, "enquiry"), eq(S.outbox.relatedId, id)));
  const open = ["new", "contacted", "qualified"].includes(e.status);
  const hrs = (now.getTime() - e.createdAt.getTime()) / HOUR;
  const sales = L.users.filter((u) => ["sales", "branch_head"].includes(u.role) && u.branch === e.branch);

  return (
    <>
      <PageHeader
        title={e.company}
        sub={<><span className="font-mono">{e.code}</span> · received {ago(e.createdAt, now)} via {e.source}</>}
        actions={
          open ? (
            <form action={convertEnquiry.bind(null, e.id)}>
              <Submit className="btn-primary" pendingText="Converting…">Convert to opportunity</Submit>
            </form>
          ) : e.opportunityId ? (
            <Link className="btn" href={`/opportunities/${e.opportunityId}`}>Open opportunity →</Link>
          ) : null
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-4 max-lg:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Requirement">
            <p className="text-[15px]">{e.requirement}</p>
            <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-2 text-[13px]">
              <dt className="text-muted">Contact</dt><dd>{e.contactName} · {e.phone ?? "—"} · {e.email ?? "—"}</dd>
              <dt className="text-muted">Division</dt><dd><Div d={e.division} /></dd>
              <dt className="text-muted">Branch</dt><dd>{e.branch}</dd>
              <dt className="text-muted">Estimated value</dt><dd>{e.estValue ? money(e.estValue) : "—"}</dd>
              <dt className="text-muted">Existing client</dt><dd>{e.accountId ? <Link className="link" href={`/clients/${e.accountId}`}>{L.acctName(e.accountId)}</Link> : "No: new client"}</dd>
              <dt className="text-muted">Status</dt><dd><Pill tone={e.status === "new" ? (hrs > 4 ? "crit" : "info") : e.status === "converted" ? "good" : "neutral"}>{e.status}</Pill>{e.disqualifyReason && <span className="ml-2 text-muted">{e.disqualifyReason}</span>}</dd>
              <dt className="text-muted">First response</dt><dd>{e.firstResponseAt ? `${fmtDateTime(e.firstResponseAt)} (${Math.max(0, Math.round(((e.firstResponseAt.getTime() - e.createdAt.getTime()) / HOUR) * 10) / 10)} h)` : <span className={hrs > 4 ? "text-crit" : ""}>Pending for {Math.round(hrs)} h</span>}</dd>
            </dl>
          </Card>
          {open && (
            <Card title="Log a response">
              <form action={respondEnquiry.bind(null, e.id)} className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  <select name="kind" className="input w-auto" aria-label="Channel"><option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="meeting">Meeting</option></select>
                  <input name="note" className="input min-w-[240px] flex-1" placeholder="e.g. Spoke to Arvind; site visit Tuesday 11 am" aria-label="Note" />
                  <Submit className="btn-primary">Log</Submit>
                </div>
              </form>
            </Card>
          )}
          <Card title="Timeline"><Timeline items={acts.map((a) => ({ at: a.createdAt, body: a.body, kind: a.kind, who: a.userId ? L.userName(a.userId) : undefined }))} /></Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card title="Owner">
            <div className="text-[15px] font-medium">{L.userName(e.assignedTo)}</div>
            {open && (
              <form action={reassignEnquiry.bind(null, e.id)} className="flex items-center gap-2 text-xs text-muted">
                Re-assign
                <AutoSubmitSelect name="userId" label="Re-assign to" defaultValue={e.assignedTo ?? ""} options={[{ value: "", label: "—" }, ...sales.map((u) => ({ value: u.id, label: u.name }))]} />
              </form>
            )}
          </Card>
          <Card title="Messages sent to client" sub="Sent automatically; view them all under Automations → Messages">
            {msgs.map((m) => (
              <div key={m.id} className="rounded-md bg-surface-2 p-2.5 text-[12.5px]">
                <div className="mb-1 flex justify-between text-[11px] text-muted"><span className="font-semibold uppercase">{m.channel}</span><span>{ago(m.createdAt, now)}</span></div>
                {m.body}
              </div>
            ))}
            {!msgs.length && <p className="text-xs text-muted">None yet.</p>}
          </Card>
          {open && (
            <Card title="Not a fit?">
              <Reveal label="Disqualify">
                <form action={disqualifyEnquiry.bind(null, e.id)} className="flex flex-col gap-2">
                  <select name="reason" className="input" aria-label="Reason"><option>Outside service area</option><option>Budget too low</option><option>Duplicate</option><option>Spam / job seeker</option><option>Not our scope</option></select>
                  <Submit className="btn-danger">Disqualify</Submit>
                </form>
              </Reveal>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
