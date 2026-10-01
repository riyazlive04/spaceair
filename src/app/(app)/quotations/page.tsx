import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { requireUser, branchScope } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { fmtDate, money, quoteTotals } from "@/lib/format";
import { PageHeader, Pill, TableWrap, Tabs } from "@/components/ui";
import { RowLink } from "@/components/client";

export const metadata = { title: "Quotations" };
const TONE = { draft: "neutral", pending_approval: "warn", approved: "info", sent: "info", accepted: "good", rejected: "crit", superseded: "neutral" } as const;

export default async function Quotations(props: PageProps<"/quotations">) {
  const user = await requireUser();
  const scope = await branchScope(user);
  const tab = String((await props.searchParams).tab ?? "Active");
  const L = await lookups();
  const [quotes, opps, items] = await Promise.all([db.select().from(S.quotations).orderBy(desc(S.quotations.createdAt)), db.select().from(S.opportunities), db.select().from(S.quoteItems)]);
  const rows = quotes
    .map((q) => ({ q, o: opps.find((o) => o.id === q.opportunityId)!, t: quoteTotals(items.filter((i) => i.quotationId === q.id), q.discountPct, q.gstPct) }))
    .filter(({ o }) => o && (!scope || o.branch === scope));
  const list = rows.filter(({ q }) => (tab === "Active" ? !["superseded", "accepted", "rejected"].includes(q.status) : tab === "Awaiting approval" ? q.status === "pending_approval" : tab === "AMC renewals" ? q.kind === "amc_renewal" : true));
  return (
    <>
      <PageHeader
        title="Quotations"
        sub="Every quotation and revision in one place, with value, approval status and client follow-up. Consultant BOQs are imported, auto-priced and exported back in the client's format."
        actions={<><a className="btn" href="/quotations/rates">Rate library</a><a className="btn btn-primary" href="/quotations/import">Import client BOQ (.xlsx)</a></>}
      />
      <Tabs
        current={tab}
        items={[
          { href: "?tab=Active", label: "Active", count: rows.filter(({ q }) => !["superseded", "accepted", "rejected"].includes(q.status)).length },
          { href: "?tab=Awaiting approval", label: "Awaiting approval", count: rows.filter(({ q }) => q.status === "pending_approval").length },
          { href: "?tab=AMC renewals", label: "AMC renewals", count: rows.filter(({ q }) => q.kind === "amc_renewal").length },
          { href: "?tab=All", label: "All", count: rows.length },
        ]}
      />
      <TableWrap>
        <table className="tbl">
          <thead><tr><th>Quotation</th><th>Client / project</th><th>Prepared by</th><th>Date</th><th className="num">Discount</th><th className="num">Net value</th><th>Status</th></tr></thead>
          <tbody>
            {list.map(({ q, o, t }) => (
              <RowLink key={q.id} href={`/quotations/${q.id}`}>
                <td><Link className="link font-mono text-xs" href={`/quotations/${q.id}`}>{q.code} R{q.revision}</Link>{q.source === "boq_import" && <div className="text-[10.5px] font-semibold uppercase text-accent">client BOQ</div>}</td>
                <td><div className="font-medium">{L.acctName(o.accountId)}</div><div className="text-xs text-muted">{o.title}</div></td>
                <td>{L.userName(q.createdBy ?? o.ownerId)}</td>
                <td className="whitespace-nowrap">{fmtDate(q.sentAt ?? q.createdAt)}</td>
                <td className="num">{q.discountPct}%</td>
                <td className="num font-mono text-xs">{money(t.net)}</td>
                <td><Pill tone={TONE[q.status]}>{q.status.replace("_", " ")}</Pill>{q.kind === "amc_renewal" && <span className="ml-1.5 text-[10.5px] font-semibold uppercase text-accent">auto</span>}</td>
              </RowLink>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </>
  );
}
