import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { requireUser } from "@/lib/auth";
import { RULES } from "@/lib/automation/rules";
import { ago, cn } from "@/lib/format";
import { runAutomationsNow, saveRuleConfig, toggleRule } from "@/lib/actions";
import { Card, PageHeader, Pill, Kpi, Tabs } from "@/components/ui";
import { Submit } from "@/components/client";

export const metadata = { title: "Automations" };
const CATS = ["Sales", "Approvals", "Projects", "AMC", "Service", "Management"] as const;

export default async function Automations() {
  const user = await requireUser();
  const now = new Date();
  const [rules, runs] = await Promise.all([db.select().from(S.automationRules), db.select().from(S.automationRuns).orderBy(desc(S.automationRuns.createdAt)).limit(30)]);
  const [msgs] = [await db.select().from(S.outbox)];
  const total = rules.reduce((s, r) => s + r.actionCount, 0);
  const canEdit = user.role === "owner";
  const canToggle = user.role === "owner" || user.role === "branch_head";

  return (
    <>
      <PageHeader
        title="Automations"
        sub="The rules that keep work moving without anyone chasing it. Each one runs on an event (e.g. a new enquiry) or on a schedule every 15 minutes. Every action is logged."
        actions={<form action={runAutomationsNow}><Submit className="btn-primary" pendingText="Running…">Run scheduled rules now</Submit></form>}
      />
      <Tabs current="Rules" items={[{ href: "/automations", label: "Rules", count: rules.length }, { href: "/automations/messages", label: "Messages sent", count: msgs.length }]} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <Kpi label="Active rules" value={`${rules.filter((r) => r.enabled).length}/${rules.length}`} tone="good" />
        <Kpi label="Automated actions" value={total} note="tasks, alerts, messages, records" />
        <Kpi label="Client messages sent" value={msgs.length} note={`${msgs.filter((m) => m.channel === "whatsapp").length} WhatsApp · ${msgs.filter((m) => m.channel === "email").length} email`} />
        <Kpi label="Last scheduled run" value={ago(rules.reduce<Date | null>((m, r) => (r.lastRunAt && (!m || r.lastRunAt > m) ? r.lastRunAt : m), null), now)} />
      </div>
      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-4 max-xl:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-4">
          {CATS.map((cat) => (
            <section key={cat} className="flex flex-col gap-2">
              <h2 className="label">{cat}</h2>
              {RULES.filter((r) => r.category === cat).map((def) => {
                const r = rules.find((x) => x.key === def.key);
                if (!r) return null;
                const keys = Object.keys(def.defaults);
                return (
                  <div key={def.key} className={cn("card flex flex-col gap-2", !r.enabled && "opacity-60")}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[14px] font-semibold">{def.name}</h3>
                        <p className="text-[12.5px] text-ink-2">{def.description}</p>
                      </div>
                      <form action={toggleRule.bind(null, def.key)}>
                        <button type="submit" disabled={!canToggle} className={cn("pill cursor-pointer", r.enabled ? "pill-good" : "")} aria-label={`${r.enabled ? "Pause" : "Enable"} ${def.name}`}>
                          {r.enabled ? "● On" : "○ Paused"}
                        </button>
                      </form>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
                      <span>⚡ {def.trigger}</span>
                      <span>{r.actionCount} actions · {r.runCount} runs</span>
                      {r.lastRunAt && <span>last {ago(r.lastRunAt, now)}</span>}
                    </div>
                    {keys.length > 0 && (
                      <form action={saveRuleConfig.bind(null, def.key)} className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
                        {keys.map((k) => (
                          <label key={k} className="field text-[11.5px]">
                            {def.configLabels?.[k] ?? k}
                            <input className="input w-28" type="number" name={k} defaultValue={r.config[k] ?? def.defaults[k]} disabled={!canEdit} />
                          </label>
                        ))}
                        {canEdit && <Submit className="btn-sm">Save</Submit>}
                      </form>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
        <Card title="Run log" sub="Most recent automated actions" className="self-start">
          <ol className="flex flex-col">
            {runs.map((r) => (
              <li key={r.id} className="border-t border-line py-2 text-[12.5px] first:border-0 first:pt-0">
                <div className="flex justify-between gap-2"><b className="font-semibold">{RULES.find((x) => x.key === r.ruleKey)?.name}</b><span className="font-mono text-[11px] text-muted">{ago(r.createdAt, now)}</span></div>
                <div className="text-ink-2">{r.summary}</div>
                <Pill tone="info">{r.actions} actions</Pill>
              </li>
            ))}
          </ol>
          <Link href="/automations/messages" className="link text-xs">See every client message →</Link>
        </Card>
      </div>
    </>
  );
}
