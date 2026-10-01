import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { DEFAULT_SETTINGS, OPEN_STAGES, type AppSettings } from "@/lib/constants";
import { sendMail, type MailAttachment } from "@/lib/mail";

const { users, settings, notifications, tasks, outbox, activities, enquiries, opportunities, tickets } = schema;

export const uid = () => crypto.randomUUID();

/** Sequential human-readable codes such as E-2309, O-1057, T-5512. */
export async function nextCode(prefix: string, start: number) {
  const key = `seq:${prefix}`;
  const row = await db.query.settings.findFirst({ where: eq(settings.key, key) });
  const n = row ? Number(row.value) + 1 : start;
  await db.insert(settings).values({ key, value: n }).onConflictDoUpdate({ target: settings.key, set: { value: n } });
  return `${prefix}-${n}`;
}

export async function getSettings(): Promise<AppSettings> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, "app") });
  const v = (row?.value ?? {}) as Partial<AppSettings>;
  return {
    approvalMatrix: { ...DEFAULT_SETTINGS.approvalMatrix, ...(v.approvalMatrix ?? {}) },
    sla: { ...DEFAULT_SETTINGS.sla, ...(v.sla ?? {}) },
    enquiryResponseHours: v.enquiryResponseHours ?? DEFAULT_SETTINGS.enquiryResponseHours,
  };
}

export async function usersBy(role: string, branch?: string | null) {
  const all = await db.select().from(users).where(and(eq(users.role, role as never), eq(users.active, true)));
  return branch ? all.filter((u) => u.branch === branch) : all;
}
export async function branchHead(branch: string) {
  return (await usersBy("branch_head", branch))[0] ?? (await usersBy("owner"))[0];
}
export async function owner() {
  return (await usersBy("owner"))[0];
}

/** Least-loaded sales engineer in the branch (open enquiries + open opportunities). */
export async function pickSales(branch: string, exclude?: string | null) {
  let pool = (await usersBy("sales", branch)).filter((u) => u.id !== exclude);
  if (!pool.length) pool = [await branchHead(branch)];
  const enq = await db
    .select({ id: enquiries.assignedTo, n: sql<number>`count(*)` })
    .from(enquiries)
    .where(inArray(enquiries.status, ["new", "contacted", "qualified"]))
    .groupBy(enquiries.assignedTo);
  const opp = await db
    .select({ id: opportunities.ownerId, n: sql<number>`count(*)` })
    .from(opportunities)
    .where(inArray(opportunities.stage, OPEN_STAGES))
    .groupBy(opportunities.ownerId);
  const load = (id: string) =>
    Number(enq.find((r) => r.id === id)?.n ?? 0) + Number(opp.find((r) => r.id === id)?.n ?? 0);
  return pool.sort((a, b) => load(a.id) - load(b.id))[0];
}

/** Least-loaded technician in the branch (open tickets). */
export async function pickTechnician(branch: string) {
  let pool = await usersBy("technician", branch);
  if (!pool.length) pool = await usersBy("technician");
  const open = await db
    .select({ id: tickets.technicianId, n: sql<number>`count(*)` })
    .from(tickets)
    .where(notInArray(tickets.status, ["resolved"]))
    .groupBy(tickets.technicianId);
  const load = (id: string) => Number(open.find((r) => r.id === id)?.n ?? 0);
  return pool.sort((a, b) => load(a.id) - load(b.id))[0];
}

export const dateKey = (d = new Date()) => d.toISOString().slice(0, 10);

/** Execution context handed to every rule: all side effects go through here so they are idempotent and counted. */
export class Ctx {
  actions = 0;
  notes: string[] = [];
  now = new Date();
  constructor(public ruleKey: string) {}

  note(s: string) {
    this.notes.push(s);
  }

  /** Returns true the first time a key is seen: guards one-off actions like re-assignment. */
  async once(key: string) {
    const r = await db
      .insert(settings)
      .values({ key: `mark:${key}`, value: Date.now() })
      .onConflictDoNothing()
      .returning({ k: settings.key });
    return r.length > 0;
  }

  async notify(
    userId: string | null | undefined,
    title: string,
    o: { body?: string; link?: string; severity?: "info" | "warn" | "crit"; dedupe?: string } = {},
  ) {
    if (!userId) return false;
    const r = await db
      .insert(notifications)
      .values({
        id: uid(),
        userId,
        title,
        body: o.body,
        link: o.link,
        severity: o.severity ?? "info",
        dedupeKey: o.dedupe ? `${o.dedupe}:${userId}` : null,
      })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    if (r.length) this.actions++;
    if (r.length && o.severity === "crit") {
      const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
      if (u?.email && u.role === "owner") {
        await this.send({
          channel: "email",
          to: u.email,
          subject: `[Critical] ${title}`,
          body: o.body ?? title,
          dedupe: o.dedupe ? `crit-email:${o.dedupe}` : undefined,
        });
      }
    }
    return r.length > 0;
  }

  async task(t: {
    title: string;
    assignedTo: string | null | undefined;
    dueAt: Date;
    entityType?: string;
    entityId?: string;
    priority?: "high" | "normal" | "low";
    dedupe?: string;
  }) {
    const r = await db
      .insert(tasks)
      .values({
        id: uid(),
        title: t.title,
        assignedTo: t.assignedTo ?? null,
        dueAt: t.dueAt,
        entityType: t.entityType,
        entityId: t.entityId,
        priority: t.priority ?? "normal",
        source: "automation",
        dedupeKey: t.dedupe ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: tasks.id });
    if (r.length) this.actions++;
    return r.length > 0;
  }

  async send(m: {
    channel: "email" | "whatsapp" | "sms";
    to: string | null | undefined;
    cc?: string | null;
    bcc?: string | null;
    subject?: string;
    body: string;
    relatedType?: string;
    relatedId?: string;
    dedupe?: string;
  }) {
    const r = await this.sendThreaded(m);
    return r.sent;
  }

  /** Like send(), but also returns Gmail's message/thread id so a caller can poll the thread for replies. */
  async sendThreaded(m: {
    channel: "email" | "whatsapp" | "sms";
    to: string | null | undefined;
    cc?: string | null;
    bcc?: string | null;
    subject?: string;
    body: string;
    relatedType?: string;
    relatedId?: string;
    dedupe?: string;
    existingThreadId?: string | null;
    accountId?: string | null;
    attachments?: MailAttachment[];
  }) {
    if (!m.to) return { sent: false as const, messageId: null, threadId: null };
    const status = m.channel === "email" ? "queued" : "sent";
    const r = await db
      .insert(outbox)
      .values({
        id: uid(),
        channel: m.channel,
        to: m.to,
        cc: m.cc || null,
        bcc: m.bcc || null,
        subject: m.subject,
        body: m.body,
        status,
        relatedType: m.relatedType,
        relatedId: m.relatedId,
        dedupeKey: m.dedupe ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: outbox.id });
    if (!r.length) return { sent: false as const, messageId: null, threadId: null };
    this.actions++;
    if (m.channel === "email") {
      const result = await sendMail({ to: m.to, cc: m.cc || undefined, bcc: m.bcc || undefined, subject: m.subject, body: m.body, existingThreadId: m.existingThreadId, accountId: m.accountId, attachments: m.attachments });
      await db
        .update(outbox)
        .set({ status: result.ok ? "sent" : "failed" })
        .where(eq(outbox.id, r[0].id));
      return { sent: true as const, messageId: result.ok ? result.messageId : null, threadId: result.ok ? result.threadId : null };
    }
    return { sent: true as const, messageId: null, threadId: null };
  }

  async activity(entityType: string, entityId: string, body: string) {
    await db.insert(activities).values({ id: uid(), entityType, entityId, kind: "automation", body });
  }
}
