import { BRANCHES, DIVISIONS, ENQUIRY_SOURCES } from "@/lib/constants";
import { Submit } from "@/components/client";

export function EnquiryFields({ branch, publicForm = false }: { branch?: string; publicForm?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
      <label className="field">Company<input className="input" name="company" required placeholder="e.g. Prestige Tech Park" /></label>
      <label className="field">Contact person<input className="input" name="contactName" required placeholder="Name, designation" /></label>
      <label className="field">Mobile / WhatsApp<input className="input" name="phone" placeholder="+91 98xxx xxxxx" /></label>
      <label className="field">Email<input className="input" name="email" type="email" placeholder="name@company.com" /></label>
      <label className="field">Service needed
        <select className="input" name="division">{Object.keys(DIVISIONS).map((d) => <option key={d}>{d}</option>)}</select>
      </label>
      <label className="field">{publicForm ? "Nearest office" : "Branch"}
        <select className="input" name="branch" defaultValue={branch}>{BRANCHES.map((b) => <option key={b}>{b}</option>)}</select>
      </label>
      {!publicForm && (
        <>
          <label className="field">Source
            <select className="input" name="source">{ENQUIRY_SOURCES.map((s) => <option key={s}>{s}</option>)}</select>
          </label>
          <label className="field">Estimated value (₹ lakhs)<input className="input" name="estValue" type="number" min="0" step="0.5" placeholder="optional" /></label>
        </>
      )}
      <label className="field col-span-full">Requirement
        <textarea className="input" name="requirement" rows={3} required placeholder="e.g. VRF for 3 floors, 60,000 sq ft; quote needed in 2 weeks" />
      </label>
      <div className="col-span-full flex justify-end">
        <Submit className="btn-primary" pendingText="Submitting…">{publicForm ? "Submit enquiry" : "Save enquiry"}</Submit>
      </div>
    </div>
  );
}
