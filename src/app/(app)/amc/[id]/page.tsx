import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { requireUser } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { money, fmtDate } from "@/lib/format";
import { completeVisit, renewAmc } from "@/lib/actions";
import { Card, PageHeader, Pill, Timeline } from "@/components/ui";
import { Submit } from "@/components/client";
import { amcBadge } from "@/lib/badges";

export default async function AmcDetail(props: PageProps<"/amc/[id]">) {
  await requireUser();
  const { id } = await props.params;
  const a = await db.query.amcContracts.findFirst({ where: eq(S.amcContracts.id, id) });
  if (!a) notFound();
  const L = await lookups();
  const now = new Date();
  const [visits, acts, tickets, renewal] = await Promise.all([
    db.select().from(S.ppmVisits).where(eq(S.ppmVisits.amcId, id)).orderBy(asc(S.ppmVisits.scheduledFor)),
    db.select().from(S.activities).where(and(eq(S.activities.entityType, "amc"), eq(S.activities.entityId, id))).orderBy(desc(S.activities.createdAt)),
    db.select().from(S.tickets).where(eq(S.tickets.amcId, id)),
    db.query.quotations.findFirst({ where: and(eq(S.quotations.amcId, id), eq(S.quotations.kind, "amc_renewal")), orderBy: desc(S.quotations.createdAt) }),
  ]);
  const b = amcBadge(a, now);
  return (
    <>
      <PageHeader
        title={`${a.code} · ${L.acctName(a.accountId)}`}
        sub={`${a.site} · ${a.scope} · ${a.type === "comprehensive" ? "Comprehensive" : "Non-comprehensive"} · ${money(a.annualValue)}/yr · ${fmtDate(a.startDate)} – ${fmtDate(a.endDate)}`}
        actions={
          <>
            <Pill tone={b.tone}>{b.label}</Pill>
            {a.status !== "active" && <form action={renewAmc.bind(null, a.id)}><Submit className="btn-primary">Mark renewed</Submit></form>}
          </>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-4 max-lg:grid-cols-1">
        <Card title="PPM visit schedule" sub="Planned and assigned automatically. The technician is reminded a day before, and missed visits are flagged.">
          {visits.map((v) => (
            <div key={v.id} className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-3 border-t border-line pt-2 text-[13px] first:border-0 first:pt-0 max-sm:grid-cols-1">
              <span className="font-mono text-xs">{fmtDate(v.scheduledFor)}</span>
              <span>{L.userName(v.technicianId)}{v.notes && <span className="text-xs text-muted"> · {v.notes}</span>}</span>
              {v.status === "scheduled" ? (
                <form action={completeVisit.bind(null, v.id)} className="flex gap-1.5">
                  <input name="notes" className="input w-40" placeholder="Visit notes" aria-label="Visit notes" />
                  <Submit className="btn-sm">Done</Submit>
                </form>
              ) : (
                <Pill tone={v.status === "done" ? "good" : "crit"}>{v.status}</Pill>
              )}
            </div>
          ))}
        </Card>
        <div className="flex flex-col gap-4">
          <Card title="Renewal">
            {renewal ? (
              <Link href={`/quotations/${renewal.id}`} className="link text-[13px]">{renewal.code} R{renewal.revision} · {renewal.status}</Link>
            ) : (
              <p className="text-xs text-muted">The renewal quotation will be generated automatically 60 days before expiry.</p>
            )}
            <div className="text-xs text-muted">Account owner: {L.userName(a.ownerId)}</div>
          </Card>
          <Card title="Service calls under this AMC">
            {tickets.map((t) => <Link key={t.id} href={`/service/${t.id}`} className="text-[13px] hover:underline"><span className="font-mono text-xs text-muted">{t.code}</span> {t.issue}</Link>)}
            {!tickets.length && <p className="text-xs text-muted">None.</p>}
          </Card>
          <Card title="Timeline"><Timeline items={acts.map((x) => ({ at: x.createdAt, body: x.body, kind: x.kind }))} /></Card>
        </div>
      </div>
    </>
  );
}
