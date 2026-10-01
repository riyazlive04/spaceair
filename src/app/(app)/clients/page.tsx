import Link from "next/link";
import { db, schema as S } from "@/db";
import { requireUser, branchScope } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { OPEN_STAGES } from "@/lib/constants";
import { money } from "@/lib/format";
import { PageHeader, Pill, TableWrap, Tabs } from "@/components/ui";
import { RowLink } from "@/components/client";

export const metadata = { title: "Clients" };

export default async function Clients(props: PageProps<"/clients">) {
  const user = await requireUser();
  const scope = await branchScope(user);
  const sp = await props.searchParams;
  const q = String(sp.q ?? "").toLowerCase();
  const tab = String(sp.tab ?? "Clients");
  const L = await lookups();
  const [opps, amcs, tickets] = await Promise.all([db.select().from(S.opportunities), db.select().from(S.amcContracts), db.select().from(S.tickets)]);
  const inTab = (k: string) => (tab === "Clients" ? k === "client" : k !== "client");
  const list = L.accounts.filter((a) => inTab(a.kind) && (!scope || a.branch === scope || a.kind !== "client") && (!q || `${a.name} ${a.industry} ${a.city}`.toLowerCase().includes(q)));
  return (
    <>
      <PageHeader
        title="Clients"
        sub="One record per client: contacts, opportunities, AMCs and service history together, so any team member can pick up the relationship."
        actions={
          <>
            <form className="flex"><input name="q" defaultValue={q} className="input w-56" placeholder="Search clients" aria-label="Search clients" /></form>
            <Link href="/clients/new" className="btn btn-primary">+ New client</Link>
          </>
        }
      />
      <Tabs current={tab} items={[{ href: "?tab=Clients", label: "Clients", count: L.accounts.filter((a) => a.kind === "client").length }, { href: "?tab=Consultants", label: "Consultants & architects", count: L.accounts.filter((a) => a.kind !== "client").length }]} />
      {tab !== "Clients" && <p className="text-xs text-muted">Consultants and architects specify the makes and float the tenders. Tracking which ones bring projects shows where to invest relationship time.</p>}
      <TableWrap>
        <table className="tbl">
          <thead><tr><th>Client</th><th>Industry</th><th>Location</th><th>Tier</th><th>Account owner</th><th className="num">Open pipeline</th><th className="num">Won</th><th className="num">AMC / yr</th><th className="num">Open tickets</th></tr></thead>
          <tbody>
            {list.map((a) => {
              const o = opps.filter((x) => x.accountId === a.id || x.consultantId === a.id || x.architectId === a.id);
              const pv = o.filter((x) => OPEN_STAGES.includes(x.stage)).reduce((s, x) => s + x.value, 0);
              const wv = o.filter((x) => x.stage === "won").reduce((s, x) => s + x.value, 0);
              const av = amcs.filter((x) => x.accountId === a.id && x.status !== "lapsed").reduce((s, x) => s + x.annualValue, 0);
              const tk = tickets.filter((x) => x.accountId === a.id && x.status !== "resolved").length;
              return (
                <RowLink key={a.id} href={`/clients/${a.id}`}>
                  <td><Link href={`/clients/${a.id}`} className="font-medium hover:underline">{a.name}</Link></td>
                  <td>{a.industry}</td>
                  <td>{a.city}{a.city !== a.branch && <span className="text-muted"> ({a.branch})</span>}</td>
                  <td><Pill tone={a.tier === "Key" ? "info" : "neutral"}>{a.tier}</Pill></td>
                  <td>{L.userName(a.ownerId)}</td>
                  <td className="num font-mono text-xs">{pv ? money(pv) : "—"}</td>
                  <td className="num font-mono text-xs">{wv ? money(wv) : "—"}</td>
                  <td className="num font-mono text-xs">{av ? money(av) : <span className="text-warn">No AMC</span>}</td>
                  <td className="num">{tk || "—"}</td>
                </RowLink>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
    </>
  );
}
