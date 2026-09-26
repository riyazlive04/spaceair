export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.DISABLE_SCHEDULER === "1") return;
  const g = globalThis as unknown as { __saScheduler?: boolean };
  if (g.__saScheduler) return;
  g.__saScheduler = true;

  const cron = await import("node-cron");
  const { ensureRules, runScheduled } = await import("./lib/automation/engine");
  await ensureRules();

  // Time-based automations: SLA escalations, AMC renewals, PPM planning, digests…
  cron.schedule("*/15 * * * *", async () => {
    try {
      const n = await runScheduled();
      if (n) console.log(`[automation] scheduled run: ${n} actions`);
    } catch (e) {
      console.error("[automation] scheduled run failed", e);
    }
  });
  console.log("[automation] scheduler started (every 15 minutes)");
}
