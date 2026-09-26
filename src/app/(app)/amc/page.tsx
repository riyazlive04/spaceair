import Link from "next/link";
import { db, schema as S } from "@/db";
import { requireUser, branchScope } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { money, fmtDate, daysUntil } from "@/lib/format";
import { PageHeader, Pill, TableWrap, Kpi, Tabs } from "@/components/ui";
import { amcBadge } from "@/lib/badges";

export const metadata = { title: "AMC contracts" };

export default async function Amc(props: PageProps<"/amc">) {
  const user = await requireUser();
  const scope = await branchScope(user);
  const tab = String((await props.searchParams).tab ?? "All");
  const L = await lookups();
  const now = new Date();
  const [amcs, visits] = await Promise.all([db.select().from(S.amcContracts), db.select().from(S.ppmVisits)]);
  const all = amcs.filter((a) => !scope || a.branch === scope).sort((a, b) => a.endDate.getTime() - b.endDate.getTime());
  const dueList = all.filter((a) => a.status !== "active" || daysUntil(a.endDate, now) <= 60);
  const list = tab === "Renewals & lapsed" ? dueList : all;
  const V = visits.filter((v) => all.some((a) => a.id === v.amcId));
  const upcoming = V.filter((v) => v.status === "scheduled" && v.scheduledFor.getTime() - now.getTime() < 30 * 864e5);

  return (
    <>
      <PageHeader title="AMC contracts" sub="Renewal quotes go out automatically 60 days before expiry, and PPM visits are planned and assigned as soon as a contract starts." actions={<Link href="/amc/new" className="btn btn-primary">+ New AMC</Link>} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <Kpi label="Active contracts" value={all.filter((a) => a.status !== "lapsed").length} note={`${money(all.filter((a) => a.status !== "lapsed").reduce((s, a) => s + a.annualValue, 0))} / yr recurring`} />
        <Kpi label="Renewal quotes out" value={all.filter((a) => a.status === "renewal_sent").length} note="auto-generated at 60 days" />
        <Kpi label="Lapsed" value={all.filter((a) => a.status === "lapsed").length} tone={all.some((a) => a.status === "lapsed") ? "crit" : "good"} note={money(all.filter((a) => a.status === "lapsed").reduce((s, a) => s + a.annualValue, 0)) + " / yr at risk"} />
        <Kpi label="PPM visits next 30 d" value={upcoming.length} note={`${V.filter((v) => v.status === "missed").length} missed · ${V.filter((v) => v.status === "done").length} done`} />
      </div>
      <Tabs current={tab} items={[{ href: "?tab=All", label: "All", count: all.length }, { href: "?tab=Renewals & lapsed", label: "Renewals & lapsed", count: dueList.length }]} />
      <TableWrap>
        <table className="tbl">
          <thead><tr><th>Contract</th><th>Client / site</th><th>Scope</th><th>Type</th><th className="num">Value / yr</th><th>Expiry</th><th>PPM visits</th><th>Status</th></tr></thead>
          <tbody>
            {list.map((a) => {
              const b = amcBadge(a, now);
              const v = visits.filter((x) => x.amcId === a.id && x.scheduledFor >= a.startDate && x.scheduledFor <= a.endDate);
              return (
                <tr key={a.id} className="row-link">
                  <td><Link className="link font-mono text-xs" href={`/amc/${a.id}`}>{a.code}</Link></td>
                  <td><div className="font-medium">{L.acctName(a.accountId)}</div><div className="text-xs text-muted">{a.site}</div></td>
                  <td>{a.scope}</td>
                  <td className="whitespace-nowrap">{a.type === "comprehensive" ? "Comprehensive" : "Non-comp."}</td>
                  <td className="num font-mono text-xs">{money(a.annualValue)}</td>
                  <td className="whitespace-nowrap">{fmtDate(a.endDate)}</td>
                  <td className="font-mono text-xs">{v.filter((x) => x.status === "done").length}/{v.length || a.visitsPerYear}{v.some((x) => x.status === "missed") && <span className="text-crit"> · missed</span>}</td>
                  <td><Pill tone={b.tone}>{b.label}</Pill></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
    </>
  );
}
