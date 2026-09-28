import { db, schema as S } from "@/db";
import { requireUser, branchScope } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { BRANCHES, ENQUIRY_SOURCES, OPEN_STAGES } from "@/lib/constants";
import { money, HOUR } from "@/lib/format";
import { Card, Kpi, PageHeader, TableWrap } from "@/components/ui";
import { GroupedBars, HBars } from "@/components/charts";

export const metadata = { title: "Reports" };
const lakhs = (v: number) => Math.round(v / 1e5);

export default async function Reports() {
  const user = await requireUser();
  const scope = await branchScope(user);
  const inScope = (b: string) => !scope || b === scope;
  const L = await lookups();
  const now = new Date();
  const [opps, enqs, tickets, amcs, approvals, rules, tasks] = await Promise.all([
    db.select().from(S.opportunities), db.select().from(S.enquiries), db.select().from(S.tickets), db.select().from(S.amcContracts),
    db.select().from(S.approvals), db.select().from(S.automationRules), db.select().from(S.tasks),
  ]);
  const O = opps.filter((o) => inScope(o.branch));
  const E = enqs.filter((e) => inScope(e.branch));
  const T = tickets.filter((t) => inScope(t.branch));

  const branchData = BRANCHES.filter(inScope).map((b) => ({
    label: b,
    won: lakhs(O.filter((o) => o.branch === b && o.stage === "won").reduce((s, o) => s + o.value, 0)),
    open: lakhs(O.filter((o) => o.branch === b && OPEN_STAGES.includes(o.stage)).reduce((s, o) => s + o.value, 0)),
  }));
  const sourceData = ENQUIRY_SOURCES.map((s) => ({ label: s, value: E.filter((e) => e.source === s).length + O.filter((o) => o.source === s).length })).filter((r) => r.value).sort((a, b) => b.value - a.value);
  const responded = E.filter((e) => e.firstResponseAt);
  const avgResp = responded.length ? responded.reduce((s, e) => s + (e.firstResponseAt!.getTime() - e.createdAt.getTime()) / HOUR, 0) / responded.length : 0;
  const lostData = Object.entries(O.filter((o) => o.stage === "lost").reduce<Record<string, number>>((m, o) => { const k = (o.lostReason ?? "Other").split(/[ –-]/)[0]; m[k] = (m[k] ?? 0) + 1; return m; }, {})).map(([label, value]) => ({ label, value }));

  const decided = approvals.filter((a) => a.status !== "pending");
  const decisionData = [
    { label: "Auto-approved", value: decided.filter((a) => a.status === "auto_approved").length },
    { label: "Branch heads", value: decided.filter((a) => a.approverRole === "branch_head").length },
    { label: "Founder", value: decided.filter((a) => a.approverRole === "owner").length },
  ];
  const ownerPct = decided.length ? Math.round((decisionData[2].value / decided.length) * 100) : 0;
  const autoByCat = ["Sales", "Approvals", "Projects", "AMC", "Service", "Management"].map((c) => ({ label: c, value: rules.filter((r) => r.category === c).reduce((s, r) => s + r.actionCount, 0) }));
  const autoTasks = tasks.filter((t) => t.source === "automation").length;

  const sla = BRANCHES.filter(inScope).map((b) => {
    const list = T.filter((t) => t.branch === b);
    const res = list.filter((t) => t.status === "resolved" && t.resolvedAt);
    const ok = res.filter((t) => t.resolvedAt!.getTime() - t.createdAt.getTime() <= t.slaHours * HOUR).length;
    const breachedOpen = list.filter((t) => t.status !== "resolved" && now.getTime() - t.createdAt.getTime() > t.slaHours * HOUR).length;
    return { b, total: list.length, open: list.filter((t) => t.status !== "resolved").length, breachedOpen, pct: res.length ? Math.round((ok / res.length) * 100) : null };
  });

  const reps = L.users.filter((u) => ["sales", "branch_head"].includes(u.role) && inScope(u.branch)).map((u) => {
    const mine = O.filter((o) => o.ownerId === u.id);
    const won = mine.filter((o) => o.stage === "won"), lost = mine.filter((o) => o.stage === "lost");
    return {
      u, open: mine.filter((o) => OPEN_STAGES.includes(o.stage)).reduce((s, o) => s + o.value, 0), won: won.reduce((s, o) => s + o.value, 0),
      rate: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
      overdue: mine.filter((o) => OPEN_STAGES.includes(o.stage) && o.nextActionDue && o.nextActionDue < now).length,
      enq: E.filter((e) => e.assignedTo === u.id && ["new", "contacted", "qualified"].includes(e.status)).length,
    };
  }).filter((r) => r.open || r.won || r.enq).sort((a, b) => b.open - a.open);

  const amcA = amcs.filter((a) => inScope(a.branch));
  return (
    <>
      <PageHeader title="Reports" sub="Management information straight from the CRM, with no Excel MIS to compile. Every number here is live." />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <Kpi label="Decisions needing the Founder" value={`${ownerPct}%`} note={`${decisionData[2].value} of ${decided.length} approvals`} tone="good" />
        <Kpi label="Automated actions" value={rules.reduce((s, r) => s + r.actionCount, 0)} note={`${autoTasks} tasks auto-created`} />
        <Kpi label="Avg first response" value={`${avgResp.toFixed(1)} h`} note="target ≤ 4 h" tone={avgResp <= 4 ? "good" : "warn"} />
        <Kpi label="AMC recurring revenue" value={money(amcA.filter((a) => a.status !== "lapsed").reduce((s, a) => s + a.annualValue, 0))} note={`${amcA.filter((a) => a.status === "lapsed").length} lapsed`} />
      </div>
      <div className="grid grid-cols-2 gap-4 max-xl:grid-cols-1">
        <Card title="Orders won vs open pipeline by branch" sub="₹ lakhs / crores, one shared scale">
          <GroupedBars data={branchData} series={[{ key: "won", name: "Won", color: "var(--accent)" }, { key: "open", name: "Open pipeline", color: "var(--muted)" }]} />
        </Card>
        <Card title="Who decides?" sub="Quotation approvals by level, under the delegation matrix">
          <HBars data={decisionData} name="Approvals" />
          <p className="text-xs text-muted">Target: under 10% of decisions reach the Founder. Adjust limits in Settings.</p>
        </Card>
        <Card title="Where enquiries come from" sub="Enquiries + opportunities by source">
          <HBars data={sourceData} name="Leads" />
        </Card>
        <Card title="Work done by automations" sub="Actions taken per area">
          <HBars data={autoByCat} name="Actions" />
        </Card>
        {lostData.length > 0 && (
          <Card title="Why we lose" sub="Lost deals by reason">
            <HBars data={lostData} name="Deals" color="var(--crit)" />
          </Card>
        )}
        <Card title="Service SLA by branch">
          <TableWrap>
            <table className="tbl">
              <thead><tr><th>Branch</th><th className="num">Tickets</th><th className="num">Open</th><th className="num">Past SLA now</th><th className="num">Resolved in SLA</th></tr></thead>
              <tbody>{sla.map((r) => <tr key={r.b}><td>{r.b}</td><td className="num">{r.total}</td><td className="num">{r.open}</td><td className={`num ${r.breachedOpen ? "text-crit" : ""}`}>{r.breachedOpen}</td><td className="num">{r.pct == null ? "—" : `${r.pct}%`}</td></tr>)}</tbody>
            </table>
          </TableWrap>
        </Card>
      </div>
      <Card title="Sales team scorecard">
        <TableWrap>
          <table className="tbl">
            <thead><tr><th>Engineer</th><th>Branch</th><th className="num">Open enquiries</th><th className="num">Open pipeline</th><th className="num">Won</th><th className="num">Win rate</th><th className="num">Overdue follow-ups</th></tr></thead>
            <tbody>{reps.map((r) => <tr key={r.u.id}><td className="font-medium">{r.u.name}</td><td>{r.u.branch}</td><td className="num">{r.enq}</td><td className="num font-mono text-xs">{money(r.open)}</td><td className="num font-mono text-xs">{money(r.won)}</td><td className="num">{r.rate == null ? "—" : `${r.rate}%`}</td><td className={`num ${r.overdue ? "text-crit" : ""}`}>{r.overdue}</td></tr>)}</tbody>
          </table>
        </TableWrap>
      </Card>
    </>
  );
}
