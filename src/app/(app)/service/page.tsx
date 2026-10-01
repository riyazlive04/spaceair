import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { requireUser, branchScope } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { ago, slaState } from "@/lib/format";
import { PageHeader, Pill, TableWrap, Tabs, Kpi, Empty } from "@/components/ui";
import { RowLink } from "@/components/client";

export const metadata = { title: "Service tickets" };

export default async function Service(props: PageProps<"/service">) {
  const user = await requireUser();
  const scope = await branchScope(user);
  const tab = String((await props.searchParams).tab ?? "Open");
  const L = await lookups();
  const now = new Date();
  const all = (await db.select().from(S.tickets).orderBy(desc(S.tickets.createdAt))).filter((t) => (!scope || t.branch === scope) && (user.role !== "technician" || t.technicianId === user.id));
  const open = all.filter((t) => t.status !== "resolved");
  const breached = open.filter((t) => slaState(t, now).tone === "crit");
  const resolved = all.filter((t) => t.status === "resolved" && t.resolvedAt);
  const inSla = resolved.filter((t) => t.resolvedAt!.getTime() - t.createdAt.getTime() <= t.slaHours * 36e5).length;
  const list = tab === "Open" ? open : tab === "Past SLA" ? breached : tab === "Resolved" ? resolved : all;
  list.sort((a, b) => (tab === "Open" || tab === "Past SLA" ? slaState(a, now).hoursLeft - slaState(b, now).hoursLeft : 0));

  return (
    <>
      <PageHeader
        title="Service tickets"
        sub="Complaints are logged by phone, WhatsApp or the client portal. The CRM applies the SLA, checks AMC cover, assigns the nearest free technician and escalates only when needed."
        actions={<Link href="/service/new" className="btn btn-primary">+ New ticket</Link>}
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <Kpi label="Open tickets" value={open.length} note={`${open.filter((t) => t.priority === "P1").length} P1`} />
        <Kpi label="Past SLA" value={breached.length} tone={breached.length ? "crit" : "good"} note={breached.length ? "Branch head alerted" : "All within SLA"} />
        <Kpi label="Chargeable calls" value={open.filter((t) => t.chargeable).length} note="No AMC cover: pitch an AMC" tone="warn" />
        <Kpi label="Resolved within SLA" value={resolved.length ? `${Math.round((inSla / resolved.length) * 100)}%` : "—"} note={`${resolved.length} resolved`} />
      </div>
      <Tabs current={tab} items={[{ href: "?tab=Open", label: "Open", count: open.length }, { href: "?tab=Past SLA", label: "Past SLA", count: breached.length }, { href: "?tab=Resolved", label: "Resolved", count: resolved.length }, { href: "?tab=All", label: "All", count: all.length }]} />
      <TableWrap>
        <table className="tbl">
          <thead><tr><th>Ticket</th><th>Priority</th><th>Client / site</th><th>Issue</th><th>Logged</th><th>SLA</th><th>Technician</th><th>Cover</th><th>Status</th></tr></thead>
          <tbody>
            {list.map((t) => {
              const s = slaState(t, now);
              return (
                <RowLink key={t.id} href={`/service/${t.id}`}>
                  <td><Link className="link font-mono text-xs" href={`/service/${t.id}`}>{t.code}</Link></td>
                  <td><Pill tone={t.priority === "P1" ? "crit" : t.priority === "P2" ? "warn" : "neutral"}>{t.priority}</Pill></td>
                  <td><div className="font-medium">{L.acctName(t.accountId)}</div><div className="text-xs text-muted">{t.site}</div></td>
                  <td className="max-w-[320px]">{t.issue}</td>
                  <td className="whitespace-nowrap text-muted">{ago(t.createdAt, now)}<div className="text-[11px]">{t.source}</div></td>
                  <td><Pill tone={s.tone}>{s.label}</Pill>{t.escalationLevel > 0 && t.status !== "resolved" && <div className="mt-0.5 text-[11px] text-muted">escalation L{t.escalationLevel}</div>}</td>
                  <td className="whitespace-nowrap">{L.userName(t.technicianId)}</td>
                  <td>{t.chargeable ? <Pill tone="warn">Chargeable</Pill> : <span className="text-xs text-muted">AMC</span>}</td>
                  <td className="whitespace-nowrap">{t.status.replace("_", " ")}</td>
                </RowLink>
              );
            })}
          </tbody>
        </table>
        {!list.length && <Empty>No tickets in this view.</Empty>}
      </TableWrap>
    </>
  );
}
