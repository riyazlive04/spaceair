import { desc } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { requireUser } from "@/lib/auth";
import { inr, fmtDate } from "@/lib/format";
import { PageHeader, TableWrap, Kpi, Empty } from "@/components/ui";

export const metadata = { title: "Rate library" };

export default async function Rates(props: PageProps<"/quotations/rates">) {
  await requireUser();
  const q = String((await props.searchParams).q ?? "").toLowerCase();
  const all = await db.select().from(S.rateItems).orderBy(desc(S.rateItems.updatedAt));
  const list = all.filter((r) => !q || `${r.section} ${r.description}`.toLowerCase().includes(q));
  const sections = new Set(all.map((r) => r.section)).size;
  return (
    <>
      <PageHeader
        title="Rate library"
        sub="The company price book. It grows automatically every time a quotation is sent, and it prices imported BOQs, so pricing no longer depends on one senior person's memory."
        actions={<form><input name="q" defaultValue={q} className="input w-64" placeholder="Search e.g. cable tray, 10600 CFM" aria-label="Search rates" /></form>}
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <Kpi label="Rates in library" value={all.length} />
        <Kpi label="Sections covered" value={sections} />
        <Kpi label="Learned from quotations" value={all.filter((r) => r.source && !r.source.startsWith("Seed")).length} note="added when quotes are sent" tone="good" />
      </div>
      <TableWrap>
        <table className="tbl">
          <thead><tr><th>Section</th><th>Description</th><th>Unit</th><th className="num">Supply rate</th><th className="num">Install rate</th><th className="num">Uses</th><th>Last source</th><th>Updated</th></tr></thead>
          <tbody>
            {list.slice(0, 400).map((r) => (
              <tr key={r.id}>
                <td className="text-xs text-ink-2">{r.section}</td>
                <td className="max-w-[420px]"><span className="line-clamp-2" title={r.description}>{r.description}</span></td>
                <td>{r.unit}</td>
                <td className="num font-mono text-xs">{inr(r.supplyRate)}</td>
                <td className="num font-mono text-xs">{inr(r.installRate)}</td>
                <td className="num">{r.uses}</td>
                <td className="whitespace-nowrap font-mono text-[11.5px] text-muted">{r.source}</td>
                <td className="whitespace-nowrap text-xs text-muted">{fmtDate(r.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <Empty>No rates match.</Empty>}
      </TableWrap>
    </>
  );
}
