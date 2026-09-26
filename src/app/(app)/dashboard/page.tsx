import Link from "next/link";
import { desc, eq, and } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { requireUser, branchScope } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { BRANCHES, DIVISIONS, OPEN_STAGES, STAGES, ROLE_LABELS, stageProb } from "@/lib/constants";
import { money, ago, slaState, daysUntil, fmtShort, cn } from "@/lib/format";
import { Card, Kpi, PageHeader, Pill, Empty } from "@/components/ui";
import { BarList } from "@/components/bars";
import { completeTask } from "@/lib/actions";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const user = await requireUser();
  const scope = await branchScope(user);
  const inScope = (b: string) => !scope || b === scope;
  const L = await lookups();
  const now = new Date();

  const [opps, enqs, amcs, tickets, approvals, runs, notes, tasks] = await Promise.all([
    db.select().from(S.opportunities),
    db.select().from(S.enquiries),
    db.select().from(S.amcContracts),
    db.select().from(S.tickets),
    db.select().from(S.approvals),
    db.select().from(S.automationRuns).orderBy(desc(S.automationRuns.createdAt)).limit(8),
    db.select().from(S.notifications).where(and(eq(S.notifications.userId, user.id), eq(S.notifications.read, false))).orderBy(desc(S.notifications.createdAt)).limit(8),
    db.select().from(S.tasks).where(and(eq(S.tasks.assignedTo, user.id), eq(S.tasks.status, "open"))).orderBy(S.tasks.dueAt).limit(6),
  ]);
  const rules = await db.select().from(S.automationRules);

  const mine = user.role === "sales";
  const O = opps.filter((o) => inScope(o.branch) && (!mine || o.ownerId === user.id));
  const open = O.filter((o) => OPEN_STAGES.includes(o.stage));
  const openV = open.reduce((s, o) => s + o.value, 0);
  const weighted = open.reduce((s, o) => s + (o.value * stageProb(o.stage)) / 100, 0);
  const won = O.filter((o) => o.stage === "won");
  const lost = O.filter((o) => o.stage === "lost");
  const winRate = won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : 0;
  const E = enqs.filter((e) => inScope(e.branch) && ["new", "contacted", "qualified"].includes(e.status) && (!mine || e.assignedTo === user.id));
  const unanswered = E.filter((e) => e.status === "new");
  const A = amcs.filter((a) => inScope(a.branch));
  const due = A.filter((a) => a.status !== "lapsed" && daysUntil(a.endDate, now) <= 60 && a.status !== "renewed");
  const lapsed = A.filter((a) => a.status === "lapsed");
  const T = tickets.filter((t) => inScope(t.branch) && t.status !== "resolved" && (user.role !== "technician" || t.technicianId === user.id));
  const breached = T.filter((t) => slaState(t, now).tone === "crit");

  const decided = approvals.filter((a) => a.status !== "pending");
  const noOwner = decided.filter((a) => a.approverRole !== "owner").length;
  const ownerIndep = decided.length ? Math.round((noOwner / decided.length) * 100) : 100;
  const autoActions = rules.reduce((s, r) => s + r.actionCount, 0);
  const pendingMine = approvals.filter((a) => a.status === "pending" && (user.role === "owner" ? a.approverRole === "owner" : a.approverRole === user.role && a.branch === user.branch));

  const byStage = STAGES.filter((s) => OPEN_STAGES.includes(s.key)).map((s) => {
    const l = open.filter((o) => o.stage === s.key);
    return { label: s.label, value: l.reduce((a, o) => a + o.value, 0), count: l.length };
  });
  const byBranch = BRANCHES.filter(inScope).map((b) => {
    const l = open.filter((o) => o.branch === b);
    return { label: b, value: l.reduce((a, o) => a + o.value, 0), count: l.length };
  });
  const byDiv = Object.keys(DIVISIONS).map((d) => {
    const l = open.filter((o) => o.division === d);
    return { label: d, value: l.reduce((a, o) => a + o.value, 0), count: l.length, color: DIVISIONS[d as keyof typeof DIVISIONS] };
  }).filter((r) => r.count);

  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";

  if (user.role === "technician") {
    const visits = await db.select().from(S.ppmVisits).where(and(eq(S.ppmVisits.technicianId, user.id), eq(S.ppmVisits.status, "scheduled"))).orderBy(S.ppmVisits.scheduledFor).limit(6);
    return (
      <>
        <PageHeader title={`${greeting}, ${user.name.split(" ")[0]}`} sub="Your jobs for today, ordered by SLA." />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <Kpi label="My open jobs" value={T.length} />
          <Kpi label="Past SLA" value={breached.length} tone={breached.length ? "crit" : "good"} note={breached.length ? "Update the client now" : "All within SLA"} />
          <Kpi label="Upcoming PPM visits" value={visits.length} />
        </div>
        <Card title="My service jobs">
          {T.sort((a, b) => slaState(a, now).hoursLeft - slaState(b, now).hoursLeft).map((t) => {
            const s = slaState(t, now);
            return (
              <Link key={t.id} href={`/service/${t.id}`} className="grid grid-cols-[auto_1fr_auto] items-start gap-3 border-t border-line pt-3 first:border-0 first:pt-0">
                <Pill tone={t.priority === "P1" ? "crit" : t.priority === "P2" ? "warn" : "neutral"}>{t.priority}</Pill>
                <div><div className="font-medium">{L.acctName(t.accountId)} · {t.site}</div><div className="text-xs text-muted">{t.code} · {t.issue}</div></div>
                <Pill tone={s.tone === "neutral" ? "neutral" : s.tone}>{s.label}</Pill>
              </Link>
            );
          })}
          {!T.length && <Empty>No open jobs.</Empty>}
        </Card>
        <Card title="PPM visits">
          {visits.map((v) => {
            const a = amcs.find((x) => x.id === v.amcId);
            return <Link key={v.id} href={`/amc/${v.amcId}`} className="flex justify-between gap-3 text-[13px]"><span>{L.acctName(a?.accountId)} · {a?.site}</span><span className="font-mono text-xs text-muted">{fmtShort(v.scheduledFor)}</span></Link>;
          })}
          {!visits.length && <Empty>No visits scheduled.</Empty>}
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`${greeting}, ${user.name.split(" ")[0]}`}
        sub={`${ROLE_LABELS[user.role]} · ${scope ?? "all branches"}. Routine work is being handled by the team and the automation engine; below is only what needs attention.`}
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <Kpi label={mine ? "My open pipeline" : "Open pipeline"} value={money(openV)} note={`${open.length} deals · weighted ${money(weighted)}`} href="/pipeline" />
        <Kpi label="Orders won" value={money(won.reduce((s, o) => s + o.value, 0))} note={`${won.length} POs · win rate ${winRate}%`} tone="good" />
        <Kpi label="Open enquiries" value={E.length} note={`${unanswered.length} awaiting first response`} tone={unanswered.length ? "warn" : undefined} href="/enquiries" />
        <Kpi label="AMC renewals ≤ 60 d" value={money(due.reduce((s, a) => s + a.annualValue, 0))} note={lapsed.length ? `${due.length} due · ${lapsed.length} lapsed` : `${due.length} contracts`} tone={lapsed.length ? "crit" : undefined} href="/amc" />
        <Kpi label="Open service tickets" value={T.length} note={`${breached.length} past SLA`} tone={breached.length ? "crit" : "good"} href="/service" />
        {(user.role === "owner" || user.role === "branch_head") && (
          <Kpi label="Decisions without Founder" value={`${ownerIndep}%`} note={`${autoActions} automated actions so far`} tone="good" href="/reports" />
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
        <Card title="Open pipeline" sub="Value · number of deals">
          <BarList rows={byStage} />
          {!mine && byBranch.length > 1 && (
            <>
              <h3 className="label mt-2">By branch</h3>
              <BarList rows={byBranch} />
            </>
          )}
          <h3 className="label mt-2">By division</h3>
          <BarList rows={byDiv} />
        </Card>
        <div className="flex min-w-0 flex-col gap-4">
          {pendingMine.length > 0 && (
            <Card title="Waiting for your approval" actions={<Link className="link text-xs" href="/approvals">Open approvals</Link>}>
              {pendingMine.map((a) => (
                <div key={a.id} className="flex items-start justify-between gap-3 text-[13px]">
                  <div><div className="font-medium">{a.title}</div><div className="text-xs text-muted">{a.detail}</div></div>
                  <Pill tone="warn">{ago(a.createdAt, now)}</Pill>
                </div>
              ))}
            </Card>
          )}
          <Card title="Needs attention" sub="Alerts routed to you by the automation engine" actions={<Link className="link text-xs" href="/notifications">Inbox</Link>}>
            {notes.map((n) => (
              <Link key={n.id} href={n.link ?? "/notifications"} className="grid grid-cols-[auto_1fr] gap-2.5 border-t border-line pt-2.5 text-[13px] first:border-0 first:pt-0">
                <span className={cn("mt-1.5 size-2 rounded-full", n.severity === "crit" ? "bg-crit" : n.severity === "warn" ? "bg-warn" : "bg-accent")} aria-hidden />
                <div><div className="font-medium">{n.title}</div>{n.body && <div className="text-xs text-muted">{n.body}</div>}</div>
              </Link>
            ))}
            {!notes.length && <Empty>You are all caught up.</Empty>}
          </Card>
          <Card title="My tasks" actions={<Link className="link text-xs" href="/tasks">All tasks</Link>}>
            {tasks.map((t) => (
              <form key={t.id} action={completeTask.bind(null, t.id)} className="flex items-start gap-2.5 text-[13px]">
                <button type="submit" className="mt-0.5 size-4 shrink-0 rounded border border-line hover:border-accent" aria-label={`Complete ${t.title}`} />
                <div className="flex-1">{t.title}{t.source === "automation" && <span className="ml-1.5 text-[10.5px] font-semibold uppercase text-accent">auto</span>}</div>
                <span className={cn("font-mono text-[11px]", t.dueAt && t.dueAt < now ? "text-crit" : "text-muted")}>{fmtShort(t.dueAt)}</span>
              </form>
            ))}
            {!tasks.length && <Empty>No open tasks.</Empty>}
          </Card>
        </div>
      </div>

      <Card title="Automation activity" sub="What the CRM did on its own, without anyone having to chase" actions={<Link className="link text-xs" href="/automations">All automations</Link>}>
        <ol className="flex flex-col">
          {runs.map((r) => (
            <li key={r.id} className="grid grid-cols-[88px_190px_1fr] gap-3 border-t border-line py-2 text-[13px] first:border-0 max-md:grid-cols-1 max-md:gap-0.5">
              <span className="font-mono text-[11px] text-muted">{ago(r.createdAt, now)}</span>
              <span className="font-medium">{rules.find((x) => x.key === r.ruleKey)?.name}</span>
              <span className="text-ink-2">{r.summary}</span>
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}
