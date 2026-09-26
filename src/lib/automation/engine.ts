import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Ctx, uid } from "./ctx";
import { RULES, type EventName, type Rule } from "./rules";

const { automationRules, automationRuns } = schema;

/** Makes sure every rule in code has a row (enabled flag + editable config) in the database. */
export async function ensureRules() {
  for (const r of RULES)
    await db
      .insert(automationRules)
      .values({ key: r.key, name: r.name, description: r.description, category: r.category, trigger: r.trigger, config: r.defaults })
      .onConflictDoUpdate({
        target: automationRules.key,
        set: { name: r.name, description: r.description, category: r.category, trigger: r.trigger },
      });
}

async function execute(rule: Rule, kind: "event" | "schedule", fn: (ctx: Ctx, cfg: Record<string, number>) => Promise<void>) {
  const row = await db.query.automationRules.findFirst({ where: eq(automationRules.key, rule.key) });
  if (row && !row.enabled) return 0;
  const ctx = new Ctx(rule.key);
  try {
    await fn(ctx, { ...rule.defaults, ...(row?.config ?? {}) });
  } catch (e) {
    ctx.note(`Error: ${(e as Error).message}`);
    console.error(`[automation] ${rule.key}`, e);
  }
  await db
    .update(automationRules)
    .set({
      runCount: sql`${automationRules.runCount} + 1`,
      actionCount: sql`${automationRules.actionCount} + ${ctx.actions}`,
      lastRunAt: new Date(),
    })
    .where(eq(automationRules.key, rule.key));
  if (ctx.actions > 0 || (kind === "event" && ctx.notes.length))
    await db.insert(automationRuns).values({
      id: uid(),
      ruleKey: rule.key,
      summary: ctx.notes.join(" · ") || "Completed",
      actions: ctx.actions,
    });
  return ctx.actions;
}

/** Fire an event; every enabled rule listening to it runs in registry order. */
export async function emit(event: EventName, payload: { id: string; userId?: string | null }) {
  let n = 0;
  for (const r of RULES) {
    const h = r.onEvent?.[event];
    if (h) n += await execute(r, "event", (ctx, cfg) => h(ctx, cfg, payload));
  }
  return n;
}

/** Run all time-based rules (called by the scheduler every few minutes, or from "Run now"). */
export async function runScheduled(only?: string) {
  let n = 0;
  for (const r of RULES) {
    if (!r.onSchedule || (only && r.key !== only)) continue;
    n += await execute(r, "schedule", r.onSchedule);
  }
  return n;
}
