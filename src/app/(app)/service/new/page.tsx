import { db, schema as S } from "@/db";
import { requireUser } from "@/lib/auth";
import { createTicket } from "@/lib/actions";
import { getSettings } from "@/lib/automation/ctx";
import { PageHeader, Card } from "@/components/ui";
import { Submit } from "@/components/client";

export const metadata = { title: "New service ticket" };

export default async function NewTicket() {
  await requireUser();
  const accounts = await db.select().from(S.accounts);
  const sla = (await getSettings()).sla;
  return (
    <>
      <PageHeader title="New service ticket" sub="On save: SLA applied, AMC cover checked, technician assigned, and client informed on WhatsApp." />
      <Card className="max-w-3xl">
        <form action={createTicket} className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <label className="field">Client<select className="input" name="accountId" required>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label className="field">Site<input className="input" name="site" placeholder="Tower A, Level 4" /></label>
          <label className="field col-span-full">Issue<textarea className="input" name="issue" rows={3} required placeholder="e.g. VRF outdoor unit showing error E-21, 3 floors not cooling" /></label>
          <label className="field">Priority
            <select className="input" name="priority" defaultValue="P2">
              <option value="P1">P1: critical, no cooling / fire system down ({sla.P1} h)</option>
              <option value="P2">P2: degraded ({sla.P2} h)</option>
              <option value="P3">P3: routine ({sla.P3} h)</option>
            </select>
          </label>
          <label className="field">Reported via<select className="input" name="source"><option>Phone</option><option>WhatsApp</option><option>Email</option><option>Client portal</option><option>BMS alarm</option></select></label>
          <div className="col-span-full flex justify-end"><Submit className="btn-primary">Create ticket</Submit></div>
        </form>
      </Card>
    </>
  );
}
