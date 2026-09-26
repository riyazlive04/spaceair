import { requireUser } from "@/lib/auth";
import { createAccount } from "@/lib/actions";
import { BRANCHES } from "@/lib/constants";
import { PageHeader, Card } from "@/components/ui";
import { Submit } from "@/components/client";

export const metadata = { title: "New client" };

export default async function NewClient() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="New client" sub="Most clients are created automatically when an enquiry is converted. Use this for direct relationships." />
      <Card className="max-w-3xl">
        <form action={createAccount} className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <label className="field">Company name<input className="input" name="name" required /></label>
          <label className="field">Industry<input className="input" name="industry" placeholder="IT campus, pharma, retail…" /></label>
          <label className="field">City<input className="input" name="city" /></label>
          <label className="field">Serving branch<select className="input" name="branch" defaultValue={user.branch}>{BRANCHES.map((b) => <option key={b}>{b}</option>)}</select></label>
          <label className="field">Tier<select className="input" name="tier"><option>New</option><option>Growth</option><option>Key</option></select></label>
          <label className="field">GSTIN<input className="input" name="gstin" placeholder="33ABCDE1234F1Z5" /></label>
          <h3 className="label col-span-full mt-2">Primary contact</h3>
          <label className="field">Name<input className="input" name="contactName" /></label>
          <label className="field">Role<input className="input" name="contactRole" placeholder="Facility Manager" /></label>
          <label className="field">Mobile<input className="input" name="contactPhone" /></label>
          <label className="field">Email<input className="input" name="contactEmail" type="email" /></label>
          <div className="col-span-full flex justify-end"><Submit className="btn-primary">Create client</Submit></div>
        </form>
      </Card>
    </>
  );
}
