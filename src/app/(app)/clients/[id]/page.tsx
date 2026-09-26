import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { requireUser } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { DIVISIONS, OPEN_STAGES } from "@/lib/constants";
import { money, fmtDate, slaState, daysUntil } from "@/lib/format";
import { addContact, createOpportunity } from "@/lib/actions";
import { Card, Kpi, PageHeader, Pill, StagePill, Empty } from "@/components/ui";
import { Reveal, Submit } from "@/components/client";

export default async function ClientDetail(props: PageProps<"/clients/[id]">) {
  await requireUser();
  const { id } = await props.params;
  const a = await db.query.accounts.findFirst({ where: eq(S.accounts.id, id) });
  if (!a) notFound();
  const L = await lookups();
  const now = new Date();
  const [contacts, opps, amcs, tickets, projects] = await Promise.all([
    db.select().from(S.contacts).where(eq(S.contacts.accountId, id)),
    db.select().from(S.opportunities).where(eq(S.opportunities.accountId, id)),
    db.select().from(S.amcContracts).where(eq(S.amcContracts.accountId, id)),
    db.select().from(S.tickets).where(eq(S.tickets.accountId, id)),
    db.select().from(S.projects).where(eq(S.projects.accountId, id)),
  ]);
  const won = opps.filter((o) => o.stage === "won").reduce((s, o) => s + o.value, 0);
  const open = opps.filter((o) => OPEN_STAGES.includes(o.stage)).reduce((s, o) => s + o.value, 0);
  const amcV = amcs.filter((x) => x.status !== "lapsed").reduce((s, x) => s + x.annualValue, 0);

  return (
    <>
      <PageHeader title={a.name} sub={`${a.industry ?? "—"} · ${a.city} · served by ${a.branch} · account owner ${L.userName(a.ownerId)}`} actions={<Pill tone={a.tier === "Key" ? "info" : "neutral"}>{a.tier} account</Pill>} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <Kpi label="Lifetime orders" value={money(won)} />
        <Kpi label="Open pipeline" value={money(open)} />
        <Kpi label="AMC value / yr" value={money(amcV)} note={amcV ? undefined : "No AMC: upsell opportunity"} tone={amcV ? undefined : "warn"} />
        <Kpi label="Service tickets" value={tickets.length} note={`${tickets.filter((t) => t.status !== "resolved").length} open`} />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-4 max-lg:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Opportunities" actions={
            <Reveal label="+ Opportunity">
              <form action={createOpportunity} className="flex flex-col gap-2">
                <input type="hidden" name="accountId" value={a.id} />
                <input className="input" name="title" required placeholder="e.g. Chiller retrofit – Block C" aria-label="Title" />
                <div className="flex gap-2">
                  <select className="input" name="division" aria-label="Division">{Object.keys(DIVISIONS).map((d) => <option key={d}>{d}</option>)}</select>
                  <input className="input w-28" name="value" type="number" step="0.1" placeholder="₹ lakhs" aria-label="Value in lakhs" />
                </div>
                <Submit className="btn-primary">Create</Submit>
              </form>
            </Reveal>
          }>
            {opps.map((o) => (
              <Link key={o.id} href={`/opportunities/${o.id}`} className="flex items-center justify-between gap-3 border-t border-line pt-2 text-[13px] first:border-0 first:pt-0">
                <span className="font-mono text-xs text-muted">{o.code}</span>
                <span className="flex-1">{o.title}</span>
                <span className="font-mono text-xs">{money(o.value)}</span>
                <StagePill stage={o.stage} />
              </Link>
            ))}
            {!opps.length && <Empty>No opportunities yet.</Empty>}
          </Card>
          <Card title="AMC contracts">
            {amcs.map((m) => {
              const d = daysUntil(m.endDate, now);
              return (
                <Link key={m.id} href={`/amc/${m.id}`} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="font-mono text-xs text-muted">{m.code}</span>
                  <span className="flex-1">{m.scope} · {m.site}</span>
                  <span className="font-mono text-xs">{money(m.annualValue)}/yr</span>
                  <Pill tone={m.status === "lapsed" ? "crit" : d <= 60 ? "warn" : "good"}>{m.status === "lapsed" ? "Lapsed" : `Ends ${fmtDate(m.endDate)}`}</Pill>
                </Link>
              );
            })}
            {!amcs.length && <Empty>No AMC contracts.</Empty>}
          </Card>
          <Card title="Service history">
            {tickets.map((t) => {
              const s = slaState(t, now);
              return (
                <Link key={t.id} href={`/service/${t.id}`} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="font-mono text-xs text-muted">{t.code}</span>
                  <span className="flex-1">{t.issue}</span>
                  <Pill tone={s.tone}>{s.label}</Pill>
                </Link>
              );
            })}
            {!tickets.length && <Empty>No tickets.</Empty>}
          </Card>
          {projects.length > 0 && (
            <Card title="Projects">
              {projects.map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`} className="flex justify-between gap-3 text-[13px]"><span>{p.code} · {p.name}</span><span className="text-muted">{p.progress}%</span></Link>
              ))}
            </Card>
          )}
        </div>
        <Card title="Contacts" actions={
          <Reveal label="+ Contact">
            <form action={addContact.bind(null, a.id)} className="flex flex-col gap-2">
              <input className="input" name="name" required placeholder="Name" aria-label="Name" />
              <input className="input" name="role" placeholder="Role" aria-label="Role" />
              <input className="input" name="phone" placeholder="Mobile" aria-label="Mobile" />
              <input className="input" name="email" placeholder="Email" aria-label="Email" />
              <Submit className="btn-primary">Add</Submit>
            </form>
          </Reveal>
        }>
          {contacts.map((c) => (
            <div key={c.id} className="border-t border-line pt-2 text-[13px] first:border-0 first:pt-0">
              <div className="font-medium">{c.name}</div>
              <div className="text-xs text-muted">{c.role}</div>
              <div className="font-mono text-[11.5px] text-ink-2">{c.phone} · {c.email}</div>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}
