import { db, schema as S } from "@/db";
import { requireUser } from "@/lib/auth";
import { createAmc } from "@/lib/actions";
import { PageHeader, Card } from "@/components/ui";
import { Submit } from "@/components/client";

export const metadata = { title: "New AMC" };

export default async function NewAmc() {
  await requireUser();
  const accounts = await db.select().from(S.accounts);
  return (
    <>
      <PageHeader title="New AMC contract" sub="PPM visits for the year are planned and assigned automatically on save." />
      <Card className="max-w-3xl">
        <form action={createAmc} className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <label className="field">Client<select className="input" name="accountId" required>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label className="field">Site<input className="input" name="site" required placeholder="Tower A, Chennai" /></label>
          <label className="field col-span-full">Scope<input className="input" name="scope" required placeholder="VRF 180 HP (LG Multi V) + 12 AHUs" /></label>
          <label className="field">Type<select className="input" name="type"><option value="comprehensive">Comprehensive</option><option value="non_comprehensive">Non-comprehensive</option></select></label>
          <label className="field">Annual value (₹ lakhs)<input className="input" name="value" type="number" step="0.1" required /></label>
          <label className="field">Start date<input className="input" name="startDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
          <label className="field">PPM visits per year<input className="input" name="visits" type="number" min="1" max="12" defaultValue={4} /></label>
          <div className="col-span-full flex justify-end"><Submit className="btn-primary">Create AMC</Submit></div>
        </form>
      </Card>
    </>
  );
}
