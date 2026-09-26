import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { requireUser } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { getSettings } from "@/lib/automation/ctx";
import { fmtDate, money, quoteTotals, fmtDateTime } from "@/lib/format";
import { Card, PageHeader, Pill } from "@/components/ui";
import { QuoteEditor } from "@/components/quote-editor";

const TONE = { draft: "neutral", pending_approval: "warn", approved: "info", sent: "info", accepted: "good", rejected: "crit", superseded: "neutral" } as const;

export default async function QuotationDetail(props: PageProps<"/quotations/[id]">) {
  await requireUser();
  const { id } = await props.params;
  const q = await db.query.quotations.findFirst({ where: eq(S.quotations.id, id) });
  if (!q) notFound();
  const L = await lookups();
  const o = (await db.query.opportunities.findFirst({ where: eq(S.opportunities.id, q.opportunityId) }))!;
  const items = await db.select().from(S.quoteItems).where(eq(S.quoteItems.quotationId, id)).orderBy(asc(S.quoteItems.sort));
  const revs = await db.select().from(S.quotations).where(and(eq(S.quotations.code, q.code))).orderBy(desc(S.quotations.revision));
  const revItems = await Promise.all(revs.map((r) => db.select().from(S.quoteItems).where(eq(S.quoteItems.quotationId, r.id))));
  const approvals = await db.select().from(S.approvals).where(and(eq(S.approvals.entityType, "quotation"), eq(S.approvals.entityId, id))).orderBy(desc(S.approvals.createdAt));
  const matrix = (await getSettings()).approvalMatrix;

  return (
    <>
      <PageHeader
        title={`${q.code} R${q.revision}`}
        sub={<>{L.acctName(o.accountId)} · <Link className="link" href={`/opportunities/${o.id}`}>{o.title}</Link> · prepared by {L.userName(q.createdBy)} on {fmtDate(q.createdAt)}</>}
        actions={
          <>
            <Pill tone={TONE[q.status]}>{q.status.replace("_", " ")}</Pill>
            <Link className="btn" href={`/quotations/${q.id}/print`} target="_blank">Print / PDF</Link>
          </>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-4 max-xl:grid-cols-1">
        <Card>
          <QuoteEditor
            id={q.id}
            status={q.status}
            items={items.map((i) => ({ description: i.description, unit: i.unit, qty: i.qty, rate: i.rate }))}
            discountPct={q.discountPct}
            validityDays={q.validityDays}
            terms={q.terms ?? ""}
            gstPct={q.gstPct}
            matrix={matrix}
          />
        </Card>
        <div className="flex flex-col gap-4">
          <Card title="Revision history">
            {revs.map((r, i) => (
              <Link key={r.id} href={`/quotations/${r.id}`} className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[13px] ${r.id === q.id ? "bg-accent-soft" : "hover:bg-surface-2"}`}>
                <span className="font-mono">R{r.revision}</span>
                <span className="font-mono text-xs">{money(quoteTotals(revItems[i], r.discountPct, r.gstPct).net)}</span>
                <Pill tone={TONE[r.status]}>{r.status.replace("_", " ")}</Pill>
              </Link>
            ))}
          </Card>
          <Card title="Approvals">
            {approvals.map((a) => (
              <div key={a.id} className="text-[13px]">
                <Pill tone={a.status === "pending" ? "warn" : a.status === "rejected" ? "crit" : "good"}>{a.status.replace("_", " ")}</Pill>
                <div className="mt-1 text-xs text-muted">
                  {a.status === "auto_approved" ? a.comment : `${a.approverRole === "owner" ? "Founder" : "Branch head"}${a.decidedBy ? ` · ${L.userName(a.decidedBy)}` : ""} · ${fmtDateTime(a.decidedAt ?? a.createdAt)}`}
                </div>
                {a.detail && <div className="text-xs">{a.detail}</div>}
              </div>
            ))}
            {!approvals.length && <p className="text-xs text-muted">Not submitted yet.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
