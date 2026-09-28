import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { requireUser } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { money, quoteTotals } from "@/lib/format";
import { aiAvailable } from "@/lib/product-codes/ai";
import { AI_BATCH, codeStats } from "@/lib/product-codes/run";
import { MISC_CODE } from "@/lib/product-codes/master";
import { aiReviewCodes, approveProductCodes, generateProductCodes, setProductCode } from "@/lib/actions";
import { Card, Kpi, PageHeader, Pill, TableWrap, Tabs, type Tone } from "@/components/ui";
import { AutoDownload, Submit } from "@/components/client";

const SOURCE: Record<string, [string, Tone]> = {
  rules: ["rules", "neutral"],
  register: ["register", "info"],
  ai: ["AI", "info"],
  manual: ["manual", "neutral"],
};

export default async function BoqDetail(props: PageProps<"/boq/[id]">) {
  await requireUser();
  const { id } = await props.params;
  const sp = await props.searchParams;
  const q = await db.query.quotations.findFirst({ where: eq(S.quotations.id, id) });
  if (!q) notFound();
  const L = await lookups();
  const o = await db.query.opportunities.findFirst({ where: eq(S.opportunities.id, q.opportunityId) });
  const items = await db.select().from(S.quoteItems).where(eq(S.quoteItems.quotationId, id)).orderBy(asc(S.quoteItems.sort));
  const s = await codeStats(id);
  const totals = quoteTotals(items, q.discountPct, q.gstPct);
  const ai = aiAvailable();

  const view = String(sp.view ?? "Needs review");
  const needs = (i: (typeof items)[number]) => !i.codeApproved && (!!i.codeFlag || !i.productCode || i.productCode.includes(MISC_CODE));
  const list = view === "All" ? items : view === "Approved" ? items.filter((i) => i.codeApproved) : items.filter(needs);

  return (
    <>
      <PageHeader
        title={`${q.code} R${q.revision} · BOQ → OMC`}
        sub={<>{q.meta?.project || o?.title} · {o ? L.acctName(o.accountId) : ""} · {q.fileName}</>}
        actions={<Link className="btn" href="/boq">All BOQs</Link>}
      />
      {sp.download === "omc" && (
        <>
          <AutoDownload href={`/api/quotations/${q.id}/omc`} />
          <p className="card text-[13px]">
            Your OMC is downloading: {s.coded} of {s.total} lines coded{s.flagged ? `, ${s.flagged} marked orange for review below` : ""}.{" "}
            <a className="link" href={`/api/quotations/${q.id}/omc`} download>Download again</a>
          </p>
        </>
      )}

      <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
        <Card title="1 · Selling Price" sub="Customer BOQ with supply & erection rates">
          <p className="text-[13px]"><b className="font-mono">{s.priced}</b> of {s.total} lines priced · net {money(totals.net)}</p>
          <div className="flex flex-wrap gap-2">
            <Link className="btn" href={`/quotations/${q.id}`}>Review rates</Link>
            <a className="btn btn-primary" href={`/api/quotations/${q.id}/boq`} download>Download Selling Price</a>
          </div>
        </Card>
        <Card title="2 · Product Codes" sub="Rules first, AI for customised lines, a person approves">
          <p className="text-[13px]"><b className="font-mono">{s.coded}</b> coded · <b className="font-mono text-warn">{s.flagged}</b> to review · <b className="font-mono text-good">{s.approved}</b> approved</p>
          <div className="flex flex-wrap gap-2">
            <form action={generateProductCodes.bind(null, q.id)}><Submit pendingText="Coding…">Re-run rules</Submit></form>
            <form action={aiReviewCodes.bind(null, q.id)}>
              <Submit className="btn-primary" pendingText="AI is coding…">{`AI review (${Math.min(s.flagged, AI_BATCH)})`}</Submit>
            </form>
            <form action={approveProductCodes.bind(null, q.id, true)}><Submit pendingText="Approving…">Approve clean codes</Submit></form>
          </div>
          {!ai && <p className="text-xs text-warn">AI review needs ANTHROPIC_API_KEY set on the server.</p>}
        </Card>
        <Card title="3 · OMC" sub="Internal cost build-up with product codes">
          <p className="text-[13px]">{s.approved === s.total ? "All codes approved." : <><b className="font-mono">{s.total - s.approved}</b> lines not approved yet: they show orange in the OMC.</>}</p>
          <div className="flex flex-wrap gap-2">
            <a className="btn btn-primary" href={`/api/quotations/${q.id}/omc`} download>Download OMC</a>
            <a className="btn" href={`/api/quotations/${q.id}/omc?kind=codes`} download>Product code list</a>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
        <Kpi label="Lines" value={s.total} />
        <Kpi label="Coded by rules / register" value={items.filter((i) => i.codeSource === "rules" || i.codeSource === "register").length} />
        <Kpi label="Coded by AI" value={items.filter((i) => i.codeSource === "ai").length} />
        <Kpi label="Needs a person" value={s.flagged} tone={s.flagged ? "warn" : "good"} note={s.flagged ? "see list below" : "nothing to check"} />
      </div>

      <Card
        title="Product codes"
        actions={<Tabs current={view} items={[{ href: "?view=Needs review", label: "Needs review", count: s.flagged }, { href: "?view=All", label: "All", count: s.total }, { href: "?view=Approved", label: "Approved", count: s.approved }]} />}
      >
        <TableWrap>
          <table className="tbl">
            <thead>
              <tr><th>Sl.</th><th>BOQ line</th><th>Product code</th><th>Product name</th><th>By</th><th>Check</th></tr>
            </thead>
            <tbody>
              {list.map((it) => {
                const [label, tone] = SOURCE[it.codeSource ?? ""] ?? ["—", "neutral"];
                return (
                  <tr key={it.id}>
                    <td className="font-mono text-xs">{it.itemNo}</td>
                    <td className="max-w-[360px]"><div className="line-clamp-2 text-[12.5px]" title={it.description}>{it.description}</div><div className="text-[11px] text-muted">{it.section}</div></td>
                    <td>
                      <form action={setProductCode.bind(null, it.id)} className="flex items-center gap-1.5">
                        <input name="code" defaultValue={it.productCode ?? ""} maxLength={16} aria-label="Product code" className="input w-[170px] font-mono text-[12.5px] uppercase" />
                        <input type="hidden" name="name" value={it.productName ?? ""} />
                        <Submit className="btn-sm" pendingText="…">Save</Submit>
                      </form>
                    </td>
                    <td className="text-[12.5px]">{it.productName}</td>
                    <td>{it.codeApproved ? <Pill tone="good">approved</Pill> : <Pill tone={tone}>{label}</Pill>}</td>
                    <td className="max-w-[320px] text-xs">
                      {it.codeFlag && <span className="text-warn">{it.codeFlag}</span>}
                      {it.codeInfo?.reasoning && <details className="mt-1 text-muted"><summary className="cursor-pointer">AI reasoning</summary>{it.codeInfo.reasoning}</details>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
        {!list.length && <p className="py-4 text-center text-[13px] text-muted">{view === "Needs review" ? "Nothing needs a person. Approve the codes, then download the OMC." : "No lines."}</p>}
        {view === "Needs review" && s.flagged > 0 && (
          <form action={approveProductCodes.bind(null, q.id, false)} className="flex justify-end">
            <Submit pendingText="Approving…">Approve all codes as they are</Submit>
          </form>
        )}
      </Card>
    </>
  );
}
