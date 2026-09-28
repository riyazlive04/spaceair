import { db, schema as S } from "@/db";
import { requireUser } from "@/lib/auth";
import { PageHeader, Tabs, Empty, Pill } from "@/components/ui";

export const metadata = { title: "Reference projects" };

export default async function References(props: PageProps<"/references">) {
  await requireUser();
  const sector = String((await props.searchParams).sector ?? "All");
  const all = await db.select().from(S.referenceProjects);
  const sectors = [...new Set(all.map((r) => r.sector))].sort();
  const list = all.filter((r) => sector === "All" || r.sector === sector);
  return (
    <>
      <PageHeader
        title="Reference projects"
        sub="Completed projects by sector and scope, so any engineer can answer “have you done a hospital / data centre / 1000 TR plant?” in a client meeting without calling the Founder."
      />
      <Tabs current={sector} items={[{ href: "?sector=All", label: "All", count: all.length }, ...sectors.map((s) => ({ href: `?sector=${encodeURIComponent(s)}`, label: s, count: all.filter((r) => r.sector === s).length }))]} />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
        {list.map((r) => (
          <article key={r.id} className="card flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="h-display text-[16px]">{r.client}</h2>
                <div className="text-xs text-muted">{r.city} · {r.sector}</div>
              </div>
              {r.private && <Pill tone="warn">internal</Pill>}
            </div>
            <p className="text-[13px] font-medium text-accent">{r.highlight}</p>
            <dl className="grid grid-cols-[92px_1fr] gap-x-2 gap-y-1 text-[12.5px]">
              {Object.entries(r.scope).map(([k, v]) => [<dt key={`${k}l`} className="text-muted">{k}</dt>, <dd key={`${k}v`}>{v}</dd>])}
            </dl>
          </article>
        ))}
      </div>
      {!list.length && <Empty>No reference projects in this sector yet.</Empty>}
    </>
  );
}
