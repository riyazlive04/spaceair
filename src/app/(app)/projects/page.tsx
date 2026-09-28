import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { requireUser, branchScope } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { money, fmtDate } from "@/lib/format";
import { PageHeader, Pill, TableWrap, Empty } from "@/components/ui";
import { phaseLabel } from "@/lib/constants";

export const metadata = { title: "Projects" };

export default async function Projects() {
  const user = await requireUser();
  const scope = await branchScope(user);
  const L = await lookups();
  const list = (await db.select().from(S.projects).orderBy(desc(S.projects.createdAt))).filter((p) => !scope || p.branch === scope);
  return (
    <>
      <PageHeader title="Projects" sub="Created automatically when a PO is received, and run through the delivery workflow: client award, engineering approvals, procurement, site execution, QA/QC & commissioning, then handover." />
      <TableWrap>
        <table className="tbl">
          <thead><tr><th>Project</th><th>Client</th><th>Branch</th><th>Project manager</th><th className="num">Order value</th><th>Handover</th><th>Progress</th><th>Phase</th></tr></thead>
          <tbody>
            {list.map((p) => {
              const done = p.checklist.filter((c) => c.done).length;
              return (
                <tr key={p.id} className="row-link">
                  <td><Link className="link font-mono text-xs" href={`/projects/${p.id}`}>{p.code}</Link><div className="text-[13px]">{p.name}</div></td>
                  <td>{L.acctName(p.accountId)}</td>
                  <td>{p.branch}</td>
                  <td>{L.userName(p.pmId)}</td>
                  <td className="num font-mono text-xs">{money(p.value)}</td>
                  <td className="whitespace-nowrap">{done}/{p.checklist.length} steps</td>
                  <td className="w-40"><div className="h-2 rounded bg-surface-2"><div className="h-full rounded bg-accent" style={{ width: `${p.progress}%` }} /></div><span className="text-xs text-muted">{p.progress}%</span></td>
                  <td><Pill tone={p.phase === "closed" ? "good" : p.phase === "award" ? "warn" : "info"}>{phaseLabel(p.phase)}</Pill><div className="text-[11px] text-muted">since {fmtDate(p.createdAt)}</div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!list.length && <Empty>No projects yet. They appear here when a deal moves to PO received.</Empty>}
      </TableWrap>
    </>
  );
}
