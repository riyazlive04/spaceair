import { db, schema as S } from "@/db";
import { requireUser } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { BRANCHES, DIVISIONS, OPEN_STAGES } from "@/lib/constants";
import { PageHeader, Card } from "@/components/ui";
import { Submit } from "@/components/client";

export const metadata = { title: "Import client BOQ" };

export default async function ImportBoq(props: PageProps<"/quotations/import">) {
  const user = await requireUser();
  const sp = await props.searchParams;
  const L = await lookups();
  const opps = (await db.select().from(S.opportunities)).filter((o) => OPEN_STAGES.includes(o.stage));
  const lib = await db.select().from(S.rateItems);
  return (
    <>
      <PageHeader
        title="Import client BOQ"
        sub="Upload the unpriced BOQ exactly as the consultant sent it (.xlsx). The CRM reads the sections, floor-wise quantities, QRO lines and approved makes, then prices it from the rate library. Export returns the client's own file with the rates filled in and every formula intact."
      />
      {sp.error && <p className="card border-crit text-[13px] text-crit">{String(sp.error)}</p>}
      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-4 max-lg:grid-cols-1">
        <Card>
          <form action="/api/boq/import" method="post" encType="multipart/form-data" className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <label className="field col-span-full">
              BOQ workbook (.xlsx)
              <input className="input py-2" type="file" name="file" accept=".xlsx" required />
            </label>
            <label className="field col-span-full">
              Link to opportunity
              <select className="input" name="opportunityId" defaultValue="">
                <option value="">Create a new opportunity from the BOQ header (client, consultant, architect)</option>
                {opps.map((o) => <option key={o.id} value={o.id}>{o.code} · {L.acctName(o.accountId)} · {o.title}</option>)}
              </select>
            </label>
            <label className="field">Branch<select className="input" name="branch" defaultValue={user.branch}>{BRANCHES.map((b) => <option key={b}>{b}</option>)}</select></label>
            <label className="field">Division<select className="input" name="division" defaultValue=""><option value="">Detect from BOQ</option>{Object.keys(DIVISIONS).map((d) => <option key={d}>{d}</option>)}</select></label>
            <label className="field">Submission due date<input className="input" type="date" name="dueAt" /></label>
            <div className="col-span-full flex justify-end"><Submit className="btn-primary" pendingText="Reading BOQ…">Import & auto-price</Submit></div>
          </form>
        </Card>
        <Card title="What happens on import">
          <ol className="flex list-decimal flex-col gap-2 pl-4 text-[13px] text-ink-2">
            <li>Header details (client, consultant, architect, doc ref, revision) are read from the Summary sheet.</li>
            <li>Every line keeps its item no., section, floor-wise quantities and QRO flag.</li>
            <li>Rates come from the rate library ({lib.length} items today) or are estimated from similar sizes. Every rate is tagged so the estimator knows what to check.</li>
            <li>The estimator gets one review task; deadline alerts follow the submission date.</li>
            <li>When the quote is sent, its rates are added to the library, so the next BOQ prices itself.</li>
          </ol>
          <a className="link text-xs" href="/samples/Sample-Unpriced-BOQ-HVAC.xlsx" download>Download a sample unpriced BOQ to try</a>
        </Card>
      </div>
    </>
  );
}
