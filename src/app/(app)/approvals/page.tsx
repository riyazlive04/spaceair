import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { requireUser, canApprove } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { getSettings } from "@/lib/automation/ctx";
import { ago, fmtDateTime, money } from "@/lib/format";
import { decideApproval } from "@/lib/actions";
import { Card, PageHeader, Pill, Empty, Kpi } from "@/components/ui";
import { Submit } from "@/components/client";

export const metadata = { title: "Approvals" };

export default async function Approvals() {
  const user = await requireUser();
  const L = await lookups();
  const now = new Date();
  const all = await db.select().from(S.approvals).orderBy(desc(S.approvals.createdAt));
  const m = (await getSettings()).approvalMatrix;
  const pending = all.filter((a) => a.status === "pending" && (user.role === "owner" || (a.approverRole === user.role && a.branch === user.branch)));
  const mineFirst = pending.sort((a, b) => Number(canApprove(user, b.approverRole, b.branch) && b.approverRole === user.role) - Number(canApprove(user, a.approverRole, a.branch) && a.approverRole === user.role));
  const decided = all.filter((a) => a.status !== "pending");
  const auto = decided.filter((a) => a.status === "auto_approved").length;
  const bh = decided.filter((a) => a.approverRole === "branch_head").length;
  const own = decided.filter((a) => a.approverRole === "owner").length;

  return (
    <>
      <PageHeader title="Approvals" sub="Discount approvals follow the delegation matrix. Sales engineers self-approve small discounts, branch heads handle the middle band, and only exceptions reach the Founder." />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <Kpi label="Auto-approved" value={auto} note={`discount ≤ ${m.salesMaxDiscount}%`} tone="good" />
        <Kpi label="Approved by branch heads" value={bh} note={`discount ≤ ${m.branchHeadMaxDiscount}%`} />
        <Kpi label="Needed the Founder" value={own} note={`> ${m.branchHeadMaxDiscount}% or ≥ ${money(m.ownerValueLakhs * 1e5)}`} tone="warn" />
        <Kpi label="Handled without Founder" value={`${decided.length ? Math.round(((auto + bh) / decided.length) * 100) : 100}%`} tone="good" />
      </div>
      <Card title={`Pending (${mineFirst.length})`}>
        {mineFirst.map((a) => {
          const mineToDecide = canApprove(user, a.approverRole, a.branch);
          return (
            <div key={a.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 border-t border-line pt-3 first:border-0 first:pt-0 max-md:grid-cols-1">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/quotations/${a.entityId}`} className="font-medium hover:underline">{a.title}</Link>
                  <Pill tone={a.approverRole === "owner" ? "crit" : "warn"}>{a.approverRole === "owner" ? "Founder" : `Branch head · ${a.branch}`}</Pill>
                  {a.level > 1 && <Pill tone="crit">Escalated</Pill>}
                </div>
                <div className="text-xs text-muted">{a.detail} · requested by {L.userName(a.requestedBy)} · {ago(a.createdAt, now)}</div>
              </div>
              {mineToDecide ? (
                <form action={decideApproval.bind(null, a.id)} className="flex flex-wrap items-center gap-2">
                  <input name="comment" className="input w-48" placeholder="Comment (optional)" aria-label="Comment" />
                  <button name="decision" value="reject" className="btn btn-danger">Return</button>
                  <button name="decision" value="approve" className="btn btn-primary">Approve</button>
                </form>
              ) : (
                <span className="text-xs text-muted">Waiting for {a.approverRole === "owner" ? "Founder" : "branch head"}</span>
              )}
            </div>
          );
        })}
        {!mineFirst.length && <Empty>Nothing waiting for you.</Empty>}
      </Card>
      <Card title="Recent decisions">
        {decided.slice(0, 12).map((a) => (
          <div key={a.id} className="grid grid-cols-[140px_minmax(0,1fr)_auto] gap-3 text-[13px] max-md:grid-cols-1">
            <span className="font-mono text-[11px] text-muted">{fmtDateTime(a.decidedAt)}</span>
            <span>{a.title} <span className="text-muted">· {a.detail}</span></span>
            <Pill tone={a.status === "rejected" ? "crit" : "good"}>{a.status === "auto_approved" ? "Auto-approved" : `${a.status} by ${L.userName(a.decidedBy)}`}</Pill>
          </div>
        ))}
      </Card>
    </>
  );
}
