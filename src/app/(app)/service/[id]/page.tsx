import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { requireUser } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { fmtDateTime, slaState, ago } from "@/lib/format";
import { resolveTicket, updateTicket } from "@/lib/actions";
import { Card, PageHeader, Pill, Timeline } from "@/components/ui";
import { Submit } from "@/components/client";

export default async function TicketDetail(props: PageProps<"/service/[id]">) {
  await requireUser();
  const { id } = await props.params;
  const t = await db.query.tickets.findFirst({ where: eq(S.tickets.id, id) });
  if (!t) notFound();
  const L = await lookups();
  const now = new Date();
  const acts = await db.select().from(S.activities).where(and(eq(S.activities.entityType, "ticket"), eq(S.activities.entityId, id))).orderBy(desc(S.activities.createdAt));
  const msgs = await db.select().from(S.outbox).where(and(eq(S.outbox.relatedType, "ticket"), eq(S.outbox.relatedId, id)));
  const amc = t.amcId ? await db.query.amcContracts.findFirst({ where: eq(S.amcContracts.id, t.amcId) }) : null;
  const techs = L.users.filter((u) => u.role === "technician");
  const s = slaState(t, now);
  const used = Math.min(100, ((now.getTime() - t.createdAt.getTime()) / 36e5 / t.slaHours) * 100);

  return (
    <>
      <PageHeader
        title={`${t.code} · ${L.acctName(t.accountId)}`}
        sub={`${t.site} · logged ${fmtDateTime(t.createdAt)} via ${t.source}`}
        actions={<><Pill tone={t.priority === "P1" ? "crit" : t.priority === "P2" ? "warn" : "neutral"}>{t.priority}</Pill><Pill tone={s.tone}>{s.label}</Pill></>}
      />
      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-4 max-lg:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Issue">
            <p className="text-[15px]">{t.issue}</p>
            {t.status !== "resolved" && (
              <div>
                <div className="mb-1 flex justify-between text-xs text-muted"><span>SLA used</span><span>{t.slaHours} h SLA · escalation level {t.escalationLevel}</span></div>
                <div className="h-2.5 rounded bg-surface-2"><div className="h-full rounded" style={{ width: `${used}%`, background: used >= 100 ? "var(--crit)" : used >= 75 ? "var(--warn)" : "var(--accent)" }} /></div>
              </div>
            )}
            {t.resolution && <p className="text-[13px]"><b>Resolution:</b> {t.resolution} · {fmtDateTime(t.resolvedAt)}</p>}
          </Card>
          {t.status !== "resolved" && (
            <Card title="Update">
              <form action={updateTicket.bind(null, t.id)} className="flex flex-wrap items-end gap-2">
                <label className="field">Technician<select className="input" name="technicianId" defaultValue={t.technicianId ?? ""}><option value="">Unassigned</option>{techs.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.branch}</option>)}</select></label>
                <label className="field">Status<select className="input" name="status" defaultValue={t.status}><option value="open">Open</option><option value="assigned">Assigned</option><option value="in_progress">In progress</option></select></label>
                <Submit>Save</Submit>
              </form>
              <form action={resolveTicket.bind(null, t.id)} className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
                <label className="field min-w-[260px] flex-1">Resolution<input className="input" name="resolution" required placeholder="e.g. Replaced EEV coil; unit cooling normally" /></label>
                <Submit className="btn-primary">Resolve & notify client</Submit>
              </form>
            </Card>
          )}
          <Card title="Timeline"><Timeline items={acts.map((a) => ({ at: a.createdAt, body: a.body, kind: a.kind, who: a.userId ? L.userName(a.userId) : undefined }))} /></Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card title="Coverage">
            {amc ? (
              <Link href={`/amc/${amc.id}`} className="text-[13px]"><span className="link">{amc.code}</span><div className="text-xs text-muted">{amc.scope} · {amc.status}</div></Link>
            ) : (
              <p className="text-[13px] text-warn">No active AMC: chargeable visit. The service manager has been asked to pitch an AMC.</p>
            )}
            <div className="text-[13px]">Technician: <b>{L.userName(t.technicianId)}</b> {L.user(t.technicianId)?.phone && <span className="font-mono text-xs text-muted">{L.user(t.technicianId)?.phone}</span>}</div>
          </Card>
          <Card title="Messages to client">
            {msgs.map((m) => (
              <div key={m.id} className="rounded-md bg-surface-2 p-2.5 text-[12.5px]">
                <div className="mb-1 flex justify-between text-[11px] text-muted"><span className="font-semibold uppercase">{m.channel}</span><span>{ago(m.createdAt, now)}</span></div>
                {m.body}
              </div>
            ))}
            {!msgs.length && <p className="text-xs text-muted">None.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
