import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { requireUser } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { BRANCHES, DIVISIONS, OPEN_STAGES } from "@/lib/constants";
import { fmtDate } from "@/lib/format";
import { codeStats } from "@/lib/product-codes/run";
import { Card, Empty, PageHeader, Pill, TableWrap } from "@/components/ui";
import { Submit } from "@/components/client";

export const metadata = { title: "BOQ to OMC" };

export default async function BoqHub(props: PageProps<"/boq">) {
  const user = await requireUser();
  const sp = await props.searchParams;
  const L = await lookups();
  const opps = (await db.select().from(S.opportunities)).filter((o) => OPEN_STAGES.includes(o.stage));
  const quotes = await db.select().from(S.quotations).where(eq(S.quotations.source, "boq_import")).orderBy(desc(S.quotations.createdAt));
  const rows = await Promise.all(quotes.map(async (q) => ({ q, s: await codeStats(q.id), o: opps.find((o) => o.id === q.opportunityId) })));

  return (
    <>
      <PageHeader
        title="BOQ → Selling Price, Product Codes & OMC"
        sub="Upload the customer's BOQ once. The CRM prices it (Selling Price), gives every line its 16-character product code, and builds the OMC your internal teams work from."
      />
      {sp.error && <p className="card border-crit text-[13px] text-crit">{String(sp.error)}</p>}
      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-4 max-lg:grid-cols-1">
        <Card title="Upload a customer BOQ">
          <form action="/api/boq/import" method="post" encType="multipart/form-data" className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <label className="field col-span-full">
              BOQ workbook (.xlsx)
              <input className="input py-2" type="file" name="file" accept=".xlsx" required />
            </label>
            <label className="field col-span-full">
              Link to opportunity
              <select className="input" name="opportunityId" defaultValue="">
                <option value="">Create a new opportunity from the BOQ header</option>
                {opps.map((o) => <option key={o.id} value={o.id}>{o.code} · {L.acctName(o.accountId)} · {o.title}</option>)}
              </select>
            </label>
            <label className="field">Branch<select className="input" name="branch" defaultValue={user.branch}>{BRANCHES.map((b) => <option key={b}>{b}</option>)}</select></label>
            <label className="field">Division<select className="input" name="division" defaultValue=""><option value="">Detect from BOQ</option>{Object.keys(DIVISIONS).map((d) => <option key={d}>{d}</option>)}</select></label>
            <label className="field">Submission due date<input className="input" type="date" name="dueAt" /></label>
            <div className="col-span-full flex flex-wrap items-center justify-end gap-2">
              <Submit name="next" value="boq" pendingText="Reading, pricing and coding…">Upload & review</Submit>
              <Submit name="next" value="omc" className="btn-primary" pendingText="Building OMC…">Upload & download OMC</Submit>
            </div>
            <p className="col-span-full text-xs text-muted">
              <b>Upload &amp; download OMC</b> does everything in one step: prices the BOQ, codes every line and downloads the OMC workbook (Summary, OMC with product codes, Product Codes list). Codes nobody has approved yet are orange; you can review them afterwards.
            </p>
          </form>
        </Card>
        <Card title="What you get">
          <ol className="flex list-decimal flex-col gap-2 pl-4 text-[13px] text-ink-2">
            <li><b>Selling Price</b>: the customer&apos;s own workbook with supply and erection rates filled from the rate library.</li>
            <li><b>Product Codes</b>: rules code the standard lines; the AI agent handles customised ones; a person approves.</li>
            <li><b>OMC</b>: the internal cost build-up in SPACEAIR&apos;s OMC layout, with a product code on every line.</li>
          </ol>
          <p className="text-xs text-muted">Approved codes go into the Code Register, so the same product keeps the same code on every project.</p>
        </Card>
      </div>
      <Card title="Uploaded BOQs">
        {rows.length ? (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr><th>Quotation</th><th>Project / client</th><th>Uploaded</th><th className="num">Lines</th><th className="num">Priced</th><th className="num">Coded</th><th>Codes</th><th /></tr>
              </thead>
              <tbody>
                {rows.map(({ q, s, o }) => (
                  <tr key={q.id}>
                    <td className="font-mono text-[12.5px]">{q.code} R{q.revision}</td>
                    <td className="max-w-[340px] truncate">{q.meta?.project || o?.title || q.fileName}<div className="text-xs text-muted">{o ? L.acctName(o.accountId) : ""}</div></td>
                    <td className="text-xs">{fmtDate(q.createdAt)}</td>
                    <td className="num font-mono">{s.total}</td>
                    <td className="num font-mono">{s.priced}</td>
                    <td className="num font-mono">{s.coded}</td>
                    <td>
                      {s.approved === s.total && s.total ? <Pill tone="good">all approved</Pill> : s.flagged ? <Pill tone="warn">{s.flagged} to review</Pill> : <Pill tone="info">ready to approve</Pill>}
                    </td>
                    <td><Link className="btn" href={`/boq/${q.id}`}>Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <Empty>No BOQs uploaded yet.</Empty>
        )}
      </Card>
    </>
  );
}
