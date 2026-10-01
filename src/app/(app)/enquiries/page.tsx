import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { requireUser, branchScope } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { ago, money, HOUR } from "@/lib/format";
import { PageHeader, Pill, TableWrap, Tabs, Div, Empty, type Tone } from "@/components/ui";
import { RowLink } from "@/components/client";

export const metadata = { title: "Enquiries" };
const TONE: Record<string, Tone> = { new: "info", contacted: "neutral", qualified: "warn", converted: "good", disqualified: "neutral" };

export default async function Enquiries(props: PageProps<"/enquiries">) {
  const user = await requireUser();
  const scope = await branchScope(user);
  const tab = String((await props.searchParams).tab ?? "Open");
  const L = await lookups();
  const now = new Date();
  const all = (await db.select().from(S.enquiries).orderBy(desc(S.enquiries.createdAt))).filter((e) => (!scope || e.branch === scope) && (user.role !== "sales" || e.assignedTo === user.id));
  const isOpen = (s: string) => ["new", "contacted", "qualified"].includes(s);
  const list = all.filter((e) => (tab === "Open" ? isOpen(e.status) : tab === "Awaiting response" ? e.status === "new" : tab === "Converted" ? e.status === "converted" : true));

  return (
    <>
      <PageHeader
        title="Enquiries"
        sub="Every enquiry from the website, WhatsApp, calls, email, tender portals and LG dealer leads lands here. It is auto-assigned and acknowledged, and escalated if nobody responds."
        actions={<Link href="/enquiries/new" className="btn btn-primary">+ New enquiry</Link>}
      />
      <Tabs
        current={tab}
        items={[
          { href: "?tab=Open", label: "Open", count: all.filter((e) => isOpen(e.status)).length },
          { href: "?tab=Awaiting response", label: "Awaiting response", count: all.filter((e) => e.status === "new").length },
          { href: "?tab=Converted", label: "Converted", count: all.filter((e) => e.status === "converted").length },
          { href: "?tab=All", label: "All", count: all.length },
        ]}
      />
      <TableWrap>
        <table className="tbl">
          <thead>
            <tr><th>Ref</th><th>Received</th><th>Source</th><th>Company / requirement</th><th>Division</th><th>Branch</th><th className="num">Est. value</th><th>Assigned to</th><th>Status</th></tr>
          </thead>
          <tbody>
            {list.map((e) => {
              const late = e.status === "new" && now.getTime() - e.createdAt.getTime() > 4 * HOUR;
              return (
                <RowLink key={e.id} href={`/enquiries/${e.id}`}>
                  <td><Link className="link font-mono text-xs" href={`/enquiries/${e.id}`}>{e.code}</Link></td>
                  <td className={late ? "whitespace-nowrap text-crit" : "whitespace-nowrap text-muted"}>{ago(e.createdAt, now)}</td>
                  <td className="whitespace-nowrap">{e.source}</td>
                  <td><Link href={`/enquiries/${e.id}`} className="font-medium hover:underline">{e.company}</Link><div className="text-xs text-muted">{e.contactName} · {e.requirement}</div></td>
                  <td><Div d={e.division} /></td>
                  <td>{e.branch}</td>
                  <td className="num font-mono text-xs">{e.estValue ? money(e.estValue) : "—"}</td>
                  <td className="whitespace-nowrap">{L.userName(e.assignedTo)}</td>
                  <td><Pill tone={late ? "crit" : TONE[e.status]}>{late ? "No response" : e.status}</Pill></td>
                </RowLink>
              );
            })}
          </tbody>
        </table>
        {!list.length && <Empty>No enquiries in this view.</Empty>}
      </TableWrap>
    </>
  );
}
