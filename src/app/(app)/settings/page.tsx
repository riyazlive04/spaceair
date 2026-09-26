import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { getSettings } from "@/lib/automation/ctx";
import { saveSettings } from "@/lib/actions";
import { ROLE_LABELS } from "@/lib/constants";
import { Card, PageHeader, TableWrap } from "@/components/ui";
import { Submit } from "@/components/client";

export const metadata = { title: "Settings" };

export default async function Settings() {
  const user = await requireUser();
  if (user.role !== "owner") redirect("/dashboard");
  const s = await getSettings();
  const L = await lookups();
  const m = s.approvalMatrix;
  return (
    <>
      <PageHeader title="Settings" sub="The Founder sets the policy once. The team and the automation engine apply it every day." />
      <form action={saveSettings} className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <Card title="Delegation of authority: discounts" sub="Who can approve what, without escalating to the Founder">
          <div className="grid grid-cols-[1fr_120px] items-center gap-3 text-[13px]">
            <span>Sales engineer can self-approve up to</span><label className="flex items-center gap-1.5"><input className="input" type="number" step="0.5" name="salesMaxDiscount" defaultValue={m.salesMaxDiscount} aria-label="Sales limit %" />%</label>
            <span>Branch head can approve up to</span><label className="flex items-center gap-1.5"><input className="input" type="number" step="0.5" name="branchHeadMaxDiscount" defaultValue={m.branchHeadMaxDiscount} aria-label="Branch head limit %" />%</label>
            <span>Founder must approve any deal of at least</span><label className="flex items-center gap-1.5">₹<input className="input" type="number" name="ownerValueLakhs" defaultValue={m.ownerValueLakhs} aria-label="Founder value threshold in lakhs" />L</label>
          </div>
        </Card>
        <Card title="Service SLA policy" sub="Response and resolution targets by priority">
          <div className="grid grid-cols-[1fr_120px] items-center gap-3 text-[13px]">
            <span>P1: critical (no cooling, fire system down)</span><label className="flex items-center gap-1.5"><input className="input" type="number" name="P1" defaultValue={s.sla.P1} aria-label="P1 hours" />h</label>
            <span>P2: degraded performance</span><label className="flex items-center gap-1.5"><input className="input" type="number" name="P2" defaultValue={s.sla.P2} aria-label="P2 hours" />h</label>
            <span>P3: routine / PPM</span><label className="flex items-center gap-1.5"><input className="input" type="number" name="P3" defaultValue={s.sla.P3} aria-label="P3 hours" />h</label>
            <span>Enquiry first response</span><label className="flex items-center gap-1.5"><input className="input" type="number" name="enquiryResponseHours" defaultValue={s.enquiryResponseHours} aria-label="Enquiry response hours" />h</label>
          </div>
        </Card>
        <div className="col-span-full flex justify-end"><Submit className="btn-primary">Save policy</Submit></div>
      </form>
      <Card title="Escalation ladder" sub="Who hears about a problem, and when. The Founder is the last resort, not the first call.">
        <TableWrap>
          <table className="tbl">
            <thead><tr><th>Situation</th><th>Level 1</th><th>Level 2</th><th>Founder</th></tr></thead>
            <tbody>
              <tr><td>New enquiry not answered</td><td>Assigned engineer (task, 4 h)</td><td>Branch head alert at 4 h; auto re-assign at 24 h</td><td>Daily digest only</td></tr>
              <tr><td>Follow-up overdue</td><td>Deal owner, daily</td><td>Branch head after 3 days</td><td>n/a</td></tr>
              <tr><td>Discount request</td><td>Sales ≤ {m.salesMaxDiscount}% (auto)</td><td>Branch head ≤ {m.branchHeadMaxDiscount}%</td><td>Above {m.branchHeadMaxDiscount}% or ≥ ₹{m.ownerValueLakhs} L</td></tr>
              <tr><td>Service ticket SLA</td><td>Technician + service manager at 75%</td><td>Branch head on breach</td><td>Only P1 at 2× SLA</td></tr>
              <tr><td>AMC expiring</td><td>Renewal quote auto-sent at 60 d; owner task</td><td>Branch head at 7 d</td><td>Digest if lapsed</td></tr>
            </tbody>
          </table>
        </TableWrap>
      </Card>
      <Card title={`Users (${L.users.length})`} sub="In production: Microsoft 365 / Google SSO, with role and branch managed here">
        <TableWrap>
          <table className="tbl">
            <thead><tr><th>Name</th><th>Role</th><th>Branch</th><th>Email</th><th>Mobile</th></tr></thead>
            <tbody>{L.users.map((u) => <tr key={u.id}><td className="font-medium">{u.name}</td><td>{ROLE_LABELS[u.role]}</td><td>{u.branch}</td><td className="font-mono text-xs">{u.email}</td><td className="font-mono text-xs">{u.phone}</td></tr>)}</tbody>
          </table>
        </TableWrap>
      </Card>
    </>
  );
}
