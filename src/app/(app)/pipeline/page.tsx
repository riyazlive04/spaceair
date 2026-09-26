import { db, schema as S } from "@/db";
import { requireUser, branchScope } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { DIVISIONS, OPEN_STAGES } from "@/lib/constants";
import { fmtShort, money } from "@/lib/format";
import { PageHeader, Div } from "@/components/ui";
import { Kanban, type KCard } from "@/components/kanban";

export const metadata = { title: "Pipeline" };

export default async function Pipeline(props: PageProps<"/pipeline">) {
  const user = await requireUser();
  const scope = await branchScope(user);
  const sp = await props.searchParams;
  const onlyMine = sp.mine === "1" || (user.role === "sales" && sp.mine !== "0");
  const L = await lookups();
  const now = new Date();
  const opps = (await db.select().from(S.opportunities)).filter((o) => (!scope || o.branch === scope) && (!onlyMine || o.ownerId === user.id));
  const cards: KCard[] = opps
    .sort((a, b) => b.value - a.value)
    .map((o) => {
      const late = !!o.nextActionDue && o.nextActionDue < now && OPEN_STAGES.includes(o.stage);
      const days = o.nextActionDue ? Math.floor((now.getTime() - o.nextActionDue.getTime()) / 864e5) : 0;
      return {
        id: o.id, code: o.code, stage: o.stage, account: L.acctName(o.accountId), title: o.title, division: o.division, value: o.value,
        owner: L.userName(o.ownerId), branch: o.branch, next: o.stage === "lost" ? o.lostReason ?? "Lost" : o.nextAction ?? "—",
        dueLabel: late ? `overdue ${Math.max(1, days)} d` : fmtShort(o.nextActionDue), late,
      };
    });
  const open = opps.filter((o) => OPEN_STAGES.includes(o.stage));
  return (
    <>
      <PageHeader
        title="Pipeline"
        sub={`${open.length} open deals worth ${money(open.reduce((s, o) => s + o.value, 0))}. Drag a card to change its stage. Moving a deal to "PO received" creates the project, invoice task and client thank-you automatically.`}
        actions={
          <a className="btn" href={onlyMine ? "?mine=0" : "?mine=1"}>{onlyMine ? "Show whole branch" : "Show only mine"}</a>
        }
      />
      <div className="flex flex-wrap gap-4 text-xs text-muted">{Object.keys(DIVISIONS).map((d) => <Div key={d} d={d} />)}</div>
      <Kanban cards={cards} />
    </>
  );
}
