export async function register() {
  // Serverless (Vercel) has no long-lived process for node-cron; schedule runs externally there.
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.DISABLE_SCHEDULER === "1" || process.env.VERCEL) return;
  const g = globalThis as unknown as { __saScheduler?: boolean };
  if (g.__saScheduler) return;
  g.__saScheduler = true;

  const cron = await import("node-cron");
  const { ensureRules, runScheduled } = await import("./lib/automation/engine");
  await ensureRules();

  // Time-based automations: SLA escalations, AMC renewals, PPM planning, digests, scheduled reminders/broadcasts…
  cron.schedule("* * * * *", async () => {
    try {
      const n = await runScheduled();
      if (n) console.log(`[automation] scheduled run: ${n} actions`);
    } catch (e) {
      console.error("[automation] scheduled run failed", e);
    }
  });
  console.log("[automation] scheduler started (every 1 minute)");
}
