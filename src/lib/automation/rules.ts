import { and, eq, inArray, isNull, lt, desc, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { OPEN_STAGES, stageLabel, PROJECT_PHASES, phaseLabel, projectChecklist } from "@/lib/constants";
import { priceLine, rateKey } from "@/lib/boq";
import { DAY, HOUR, money, quoteTotals, fmtDate } from "@/lib/format";
import { defaultReminderSubject, defaultReminderBody, fillReminderTemplate } from "@/lib/reminder-template";
import { buildStatementPdf } from "@/lib/statement-pdf";
import { sendMail } from "@/lib/mail";
import {
  Ctx,
  uid,
  nextCode,
  getSettings,
  pickSales,
  pickTechnician,
  branchHead,
  owner,
  usersBy,
  dateKey,
} from "./ctx";

const S = schema;
type Cfg = Record<string, number>;
export type EventName =
  | "enquiry.created"
  | "quotation.submitted"
  | "quotation.sent"
  | "opportunity.won"
  | "opportunity.lost"
  | "ticket.created"
  | "ticket.resolved"
  | "quotation.imported"
  | "project.updated";
type Payload = { id: string; userId?: string | null };

export type Rule = {
  key: string;
  name: string;
  description: string;
  category: "Sales" | "Estimation" | "Approvals" | "Projects" | "AMC" | "Service" | "Management";
  trigger: string;
  defaults: Cfg;
  configLabels?: Record<string, string>;
  onEvent?: Partial<Record<EventName, (ctx: Ctx, cfg: Cfg, p: Payload) => Promise<void>>>;
  onSchedule?: (ctx: Ctx, cfg: Cfg) => Promise<void>;
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(sample\)/g, "")
    .replace(/[^a-z0-9]/g, "");
const userName = async (id?: string | null) =>
  id ? (await db.query.users.findFirst({ where: eq(S.users.id, id) }))?.name ?? "—" : "—";
const primaryContact = async (accountId: string) =>
  db.query.contacts.findFirst({ where: eq(S.contacts.accountId, accountId) });
const acctName = async (id: string) => (await db.query.accounts.findFirst({ where: eq(S.accounts.id, id) }))?.name ?? "";

export const RULES: Rule[] = [
  /* ───────────── SALES ───────────── */
  {
    key: "enquiry_auto_assign",
    name: "Auto-assign new enquiries",
    description:
      "Matches the enquiry to an existing client (routes it to the account owner) or assigns the least-loaded sales engineer in the branch. Creates a first-response task with a deadline.",
    category: "Sales",
    trigger: "When an enquiry is created (web form, WhatsApp, API or manual)",
    defaults: { responseHours: 4 },
    configLabels: { responseHours: "First response deadline (hours)" },
    onEvent: {
      "enquiry.created": async (ctx, cfg, { id }) => {
        const e = await db.query.enquiries.findFirst({ where: eq(S.enquiries.id, id) });
        if (!e || e.assignedTo) return;
        const accts = await db.select().from(S.accounts);
        const n = norm(e.company);
        const match =
          n.length >= 4 ? accts.find((a) => norm(a.name).includes(n) || n.includes(norm(a.name))) : undefined;
        let assignee = match?.ownerId ?? null;
        let why = match ? `existing client ${match.name}; routed to account owner` : "";
        if (!assignee) {
          const s = await pickSales(e.branch);
          assignee = s?.id ?? null;
          why = `least-loaded engineer in ${e.branch}`;
        }
        await db
          .update(S.enquiries)
          .set({ assignedTo: assignee, accountId: match?.id ?? null })
          .where(eq(S.enquiries.id, id));
        const nm = await userName(assignee);
        await ctx.activity("enquiry", id, `Auto-assigned to ${nm} (${why})`);
        await ctx.task({
          title: `Respond to ${e.company} (${e.code})`,
          assignedTo: assignee,
          dueAt: new Date(ctx.now.getTime() + cfg.responseHours * HOUR),
          entityType: "enquiry",
          entityId: id,
          priority: "high",
          dedupe: `enq-first-${id}`,
        });
        await ctx.notify(assignee, `New enquiry ${e.code} assigned to you`, {
          body: `${e.company}: ${e.requirement}`,
          link: `/enquiries/${id}`,
          dedupe: `enq-assign-${id}`,
        });
        ctx.note(`${e.code} → ${nm} (${why})`);
      },
    },
  },
  {
    key: "enquiry_acknowledge",
    name: "Instant acknowledgement to client",
    description:
      "Sends the client a WhatsApp (or email) within seconds with the enquiry reference and the name and number of the engineer handling it.",
    category: "Sales",
    trigger: "When an enquiry is created",
    defaults: {},
    onEvent: {
      "enquiry.created": async (ctx, _cfg, { id }) => {
        const e = await db.query.enquiries.findFirst({ where: eq(S.enquiries.id, id) });
        if (!e) return;
        const eng = e.assignedTo ? await db.query.users.findFirst({ where: eq(S.users.id, e.assignedTo) }) : null;
        const body = `Dear ${e.contactName || "Sir/Madam"}, thank you for contacting SPACEAIR. Your enquiry ref ${e.code} is registered.${eng ? ` ${eng.name} (${eng.phone}) from our ${e.branch} office will contact you shortly.` : ""} – Team SPACEAIR`;
        const sent =
          (await ctx.send({ channel: "whatsapp", to: e.phone, body, relatedType: "enquiry", relatedId: id, dedupe: `enq-ack-wa-${id}` })) ||
          (await ctx.send({
            channel: "email",
            to: e.email,
            subject: `We have received your enquiry – ${e.code}`,
            body,
            relatedType: "enquiry",
            relatedId: id,
            dedupe: `enq-ack-em-${id}`,
          }));
        if (sent) {
          await ctx.activity("enquiry", id, "Acknowledgement sent to client");
          ctx.note(`Acknowledged ${e.code}`);
        }
      },
    },
  },
  {
    key: "enquiry_response_sla",
    name: "Enquiry response SLA",
    description:
      "If nobody responds within the deadline, the branch head is alerted. If it is still untouched after the re-assign window, it moves to the next available engineer automatically.",
    category: "Sales",
    trigger: "Every minute",
    defaults: { escalateAfterHours: 4, reassignAfterHours: 24 },
    configLabels: { escalateAfterHours: "Alert branch head after (hours)", reassignAfterHours: "Re-assign after (hours)" },
    onSchedule: async (ctx, cfg) => {
      const list = await db
        .select()
        .from(S.enquiries)
        .where(and(eq(S.enquiries.status, "new"), isNull(S.enquiries.firstResponseAt)));
      for (const e of list) {
        const age = (ctx.now.getTime() - e.createdAt.getTime()) / HOUR;
        if (age >= cfg.escalateAfterHours) {
          const bh = await branchHead(e.branch);
          if (
            await ctx.notify(bh?.id, `No response on ${e.code} for ${Math.round(age)} h`, {
              body: `${e.company} – assigned to ${await userName(e.assignedTo)}`,
              link: `/enquiries/${e.id}`,
              severity: "warn",
              dedupe: `enq-esc-${e.id}`,
            })
          )
            ctx.note(`Escalated ${e.code} to branch head`);
        }
        if (age >= cfg.reassignAfterHours && (await ctx.once(`enq-reassign-${e.id}`))) {
          const s = await pickSales(e.branch, e.assignedTo);
          if (s && s.id !== e.assignedTo) {
            await db.update(S.enquiries).set({ assignedTo: s.id }).where(eq(S.enquiries.id, e.id));
            await ctx.activity("enquiry", e.id, `Re-assigned to ${s.name}: no response in ${cfg.reassignAfterHours} h`);
            await ctx.notify(s.id, `Enquiry ${e.code} re-assigned to you`, {
              body: `${e.company}: first response overdue`,
              link: `/enquiries/${e.id}`,
              severity: "warn",
              dedupe: `enq-reassigned-${e.id}`,
            });
            ctx.note(`Re-assigned ${e.code} → ${s.name}`);
          }
        }
      }
    },
  },
  {
    key: "followup_overdue",
    name: "Follow-up reminders & escalation",
    description:
      "Reminds the opportunity owner every day a next action is overdue, and alerts the branch head when it is overdue for longer than the limit.",
    category: "Sales",
    trigger: "Every minute (once per day per deal)",
    defaults: { escalateAfterDays: 3 },
    configLabels: { escalateAfterDays: "Alert branch head after (days overdue)" },
    onSchedule: async (ctx, cfg) => {
      const list = await db
        .select()
        .from(S.opportunities)
        .where(and(inArray(S.opportunities.stage, OPEN_STAGES), lt(S.opportunities.nextActionDue, ctx.now)));
      const dk = dateKey(ctx.now);
      for (const o of list) {
        const days = Math.floor((ctx.now.getTime() - o.nextActionDue!.getTime()) / DAY);
        const name = await acctName(o.accountId);
        await ctx.notify(o.ownerId, `Follow-up overdue: ${name}`, {
          body: `${o.nextAction ?? "Next action"} – ${days} d overdue`,
          link: `/opportunities/${o.id}`,
          severity: "warn",
          dedupe: `fu-${o.id}-${dk}`,
        });
        if (days >= cfg.escalateAfterDays) {
          const bh = await branchHead(o.branch);
          if (
            await ctx.notify(bh?.id, `${o.code} follow-up ${days} d overdue`, {
              body: `${name} · ${money(o.value)} · owner ${await userName(o.ownerId)}`,
              link: `/opportunities/${o.id}`,
              severity: "warn",
              dedupe: `fu-esc-${o.id}-${dk}`,
            })
          )
            ctx.note(`Escalated ${o.code}`);
        }
      }
      if (list.length) ctx.note(`${list.length} overdue follow-ups checked`);
    },
  },
  {
    key: "stale_deal",
    name: "Stale deal nudge",
    description: "Open opportunities with no activity logged for too long get a re-engagement task for the owner.",
    category: "Sales",
    trigger: "Every minute (once per week per deal)",
    defaults: { idleDays: 14 },
    configLabels: { idleDays: "Idle days before nudge" },
    onSchedule: async (ctx, cfg) => {
      const cutoff = new Date(ctx.now.getTime() - cfg.idleDays * DAY);
      const list = await db
        .select()
        .from(S.opportunities)
        .where(and(inArray(S.opportunities.stage, OPEN_STAGES), lt(S.opportunities.lastActivityAt, cutoff)));
      const wk = `${ctx.now.getFullYear()}-${Math.floor(ctx.now.getTime() / (7 * DAY))}`;
      for (const o of list) {
        if (
          await ctx.task({
            title: `Re-engage ${await acctName(o.accountId)}: no activity for ${cfg.idleDays}+ days`,
            assignedTo: o.ownerId,
            dueAt: new Date(ctx.now.getTime() + DAY),
            entityType: "opportunity",
            entityId: o.id,
            dedupe: `stale-${o.id}-${wk}`,
          })
        )
          ctx.note(`Nudged ${o.code}`);
      }
    },
  },

  /* ───────────── APPROVALS ───────────── */
  {
    key: "quote_approval",
    name: "Discount approval matrix",
    description:
      "Discounts within the sales engineer's limit are auto-approved. Larger discounts go to the branch head. Only discounts above the branch limit, or very large deals, reach the Founder. Limits are set in Settings.",
    category: "Approvals",
    trigger: "When a quotation is submitted",
    defaults: {},
    onEvent: {
      "quotation.submitted": async (ctx, _cfg, { id, userId }) => {
        const q = await db.query.quotations.findFirst({ where: eq(S.quotations.id, id) });
        if (!q) return;
        const opp = await db.query.opportunities.findFirst({ where: eq(S.opportunities.id, q.opportunityId) });
        const items = await db.select().from(S.quoteItems).where(eq(S.quoteItems.quotationId, id));
        const t = quoteTotals(items, q.discountPct, q.gstPct);
        const m = (await getSettings()).approvalMatrix;
        const big = t.net >= m.ownerValueLakhs * 1e5;
        const title = `${q.code} R${q.revision} · ${await acctName(opp!.accountId)}`;
        const detail = `Net ${money(t.net)} · discount ${q.discountPct}%`;
        if (q.discountPct <= m.salesMaxDiscount && !big) {
          await db.insert(S.approvals).values({
            id: uid(),
            entityType: "quotation",
            entityId: id,
            title,
            detail,
            requestedBy: userId,
            approverRole: "sales",
            branch: opp!.branch,
            status: "auto_approved",
            decidedAt: ctx.now,
            comment: `Within sales limit of ${m.salesMaxDiscount}%`,
          });
          await db.update(S.quotations).set({ status: "approved" }).where(eq(S.quotations.id, id));
          await ctx.activity("opportunity", opp!.id, `${q.code} R${q.revision} auto-approved (discount ${q.discountPct}% ≤ ${m.salesMaxDiscount}%)`);
          await ctx.notify(userId, `${q.code} auto-approved`, { body: detail, link: `/quotations/${id}` });
          ctx.note(`${q.code} auto-approved`);
          return;
        }
        const role = q.discountPct <= m.branchHeadMaxDiscount && !big ? "branch_head" : "owner";
        const reason = role === "owner" ? (big ? `deal value ≥ ${money(m.ownerValueLakhs * 1e5)}` : `discount > ${m.branchHeadMaxDiscount}%`) : `discount > ${m.salesMaxDiscount}%`;
        await db.insert(S.approvals).values({
          id: uid(),
          entityType: "quotation",
          entityId: id,
          title,
          detail: `${detail} · ${reason}`,
          requestedBy: userId,
          approverRole: role,
          branch: opp!.branch,
        });
        await db.update(S.quotations).set({ status: "pending_approval" }).where(eq(S.quotations.id, id));
        const approvers = role === "owner" ? [await owner()] : await usersBy("branch_head", opp!.branch);
        for (const a of approvers)
          await ctx.notify(a?.id, `Approval needed: ${title}`, { body: `${detail} · ${reason}`, link: "/approvals", severity: "warn" });
        await ctx.activity("opportunity", opp!.id, `${q.code} R${q.revision} sent for ${role === "owner" ? "Founder" : "branch head"} approval (${reason})`);
        ctx.note(`${q.code} → ${role} approval`);
      },
    },
  },
  {
    key: "approval_escalation",
    name: "Approval reminders",
    description: "Reminds approvers of pending approvals, and escalates a branch-head approval to the Founder only if it sits untouched past the escalation window.",
    category: "Approvals",
    trigger: "Every minute",
    defaults: { remindAfterHours: 12, escalateAfterHours: 48 },
    configLabels: { remindAfterHours: "Remind approver after (hours)", escalateAfterHours: "Escalate after (hours)" },
    onSchedule: async (ctx, cfg) => {
      const list = await db.select().from(S.approvals).where(eq(S.approvals.status, "pending"));
      for (const a of list) {
        const age = (ctx.now.getTime() - a.createdAt.getTime()) / HOUR;
        const approvers = a.approverRole === "owner" ? [await owner()] : await usersBy(a.approverRole, a.branch);
        if (age >= cfg.remindAfterHours)
          for (const u of approvers)
            if (await ctx.notify(u?.id, `Reminder: approval pending ${Math.round(age)} h`, { body: a.title, link: "/approvals", severity: "warn", dedupe: `appr-rem-${a.id}` }))
              ctx.note(`Reminded approver for ${a.title}`);
        if (age >= cfg.escalateAfterHours && a.approverRole === "branch_head") {
          await db.update(S.approvals).set({ approverRole: "owner", level: 2 }).where(eq(S.approvals.id, a.id));
          await ctx.notify((await owner())?.id, `Escalated approval: ${a.title}`, { body: `Pending with branch head for ${Math.round(age)} h`, link: "/approvals", severity: "warn", dedupe: `appr-esc-${a.id}` });
          ctx.note(`Escalated ${a.title}`);
        }
      }
    },
  },
  {
    key: "quote_followup",
    name: "Quotation follow-up cadence",
    description:
      "When a quotation is sent: emails it to the client contact, moves the deal to 'Quotation sent', and schedules follow-ups at +3 and +7 days. Sends the client a WhatsApp reminder after 7 days of silence, and warns the owner before validity expires.",
    category: "Sales",
    trigger: "When a quotation is sent, plus every minute",
    defaults: { firstFollowupDays: 3, secondFollowupDays: 7 },
    configLabels: { firstFollowupDays: "First follow-up (days)", secondFollowupDays: "Second follow-up & client reminder (days)" },
    onEvent: {
      "quotation.sent": async (ctx, cfg, { id }) => {
        const q = await db.query.quotations.findFirst({ where: eq(S.quotations.id, id) });
        if (!q) return;
        const o = (await db.query.opportunities.findFirst({ where: eq(S.opportunities.id, q.opportunityId) }))!;
        const items = await db.select().from(S.quoteItems).where(eq(S.quoteItems.quotationId, id));
        const t = quoteTotals(items, q.discountPct, q.gstPct);
        const c = await primaryContact(o.accountId);
        await ctx.send({
          channel: "email",
          to: c?.email,
          subject: `SPACEAIR quotation ${q.code} R${q.revision} – ${o.title}`,
          body: `Dear ${c?.name ?? "Sir/Madam"},\n\nPlease find attached our quotation ${q.code} R${q.revision} for ${o.title}. Basic value ${money(t.net)} + GST, valid for ${q.validityDays} days.\n\nRegards,\n${await userName(o.ownerId)}\nSPACEAIR`,
          relatedType: "quotation",
          relatedId: id,
          dedupe: `q-send-${id}`,
        });
        for (const d of [cfg.firstFollowupDays, cfg.secondFollowupDays])
          await ctx.task({
            title: `Follow up ${q.code} R${q.revision} with ${await acctName(o.accountId)} (day ${d})`,
            assignedTo: o.ownerId,
            dueAt: new Date(ctx.now.getTime() + d * DAY),
            entityType: "opportunity",
            entityId: o.id,
            dedupe: `q-fu-${id}-${d}`,
          });
        ctx.note(`${q.code} R${q.revision}: emailed, follow-ups scheduled`);
      },
    },
    onSchedule: async (ctx, cfg) => {
      const sent = await db.select().from(S.quotations).where(eq(S.quotations.status, "sent"));
      for (const q of sent) {
        if (!q.sentAt) continue;
        const age = (ctx.now.getTime() - q.sentAt.getTime()) / DAY;
        const o = await db.query.opportunities.findFirst({ where: eq(S.opportunities.id, q.opportunityId) });
        if (!o || !OPEN_STAGES.includes(o.stage)) continue;
        const c = await primaryContact(o.accountId);
        if (age >= cfg.secondFollowupDays)
          if (
            await ctx.send({
              channel: "whatsapp",
              to: c?.phone,
              body: `Dear ${c?.name ?? "Sir/Madam"}, a gentle reminder on SPACEAIR quotation ${q.code} R${q.revision} for ${o.title}. Happy to walk you through it – ${await userName(o.ownerId)}.`,
              relatedType: "quotation",
              relatedId: q.id,
              dedupe: `q-remind-${q.id}`,
            })
          )
            ctx.note(`Client reminder for ${q.code}`);
        if (q.validityDays - age <= 3 && q.validityDays - age > 0)
          await ctx.notify(o.ownerId, `${q.code} validity expires in ${Math.ceil(q.validityDays - age)} d`, { link: `/quotations/${q.id}`, severity: "warn", dedupe: `q-valid-${q.id}` });
      }
    },
  },

  /* ───────────── PROJECTS ───────────── */
  {
    key: "won_handover",
    name: "Won deal → project handover",
    description:
      "When a PO arrives: creates the project with a handover checklist, and gives the branch head a kick-off task and Accounts an advance-invoice task. Also sends the client a thank-you and schedules an AMC proposal before handover.",
    category: "Projects",
    trigger: "When an opportunity moves to 'PO received'",
    defaults: { amcProposalDays: 60 },
    configLabels: { amcProposalDays: "Propose AMC after (days)" },
    onEvent: {
      "opportunity.won": async (ctx, cfg, { id }) => {
        const o = await db.query.opportunities.findFirst({ where: eq(S.opportunities.id, id) });
        if (!o) return;
        const exists = await db.query.projects.findFirst({ where: eq(S.projects.opportunityId, id) });
        const bh = await branchHead(o.branch);
        const name = await acctName(o.accountId);
        if (!exists && o.division !== "AMC / Service") {
          const code = await nextCode("P", 2601);
          const pid = uid();
          await db.insert(S.projects).values({
            id: pid,
            code,
            opportunityId: id,
            accountId: o.accountId,
            name: o.title,
            branch: o.branch,
            value: o.value,
            pmId: bh?.id,
            phase: "award",
            checklist: projectChecklist().map((c, i) => (i === 0 ? { ...c, done: true, doneAt: ctx.now.toISOString() } : c)),
          });
          await ctx.task({ title: `Kick-off meeting: ${name} – ${o.title}`, assignedTo: bh?.id, dueAt: new Date(ctx.now.getTime() + 2 * DAY), entityType: "project", entityId: pid, priority: "high", dedupe: `won-kick-${id}` });
          const acc = (await usersBy("accounts"))[0];
          await ctx.task({ title: `Raise advance invoice for ${code} (${money(o.value)})`, assignedTo: acc?.id, dueAt: new Date(ctx.now.getTime() + DAY), entityType: "project", entityId: pid, priority: "high", dedupe: `won-inv-${id}` });
          await ctx.task({ title: `Propose AMC to ${name} before handover`, assignedTo: o.ownerId, dueAt: new Date(ctx.now.getTime() + cfg.amcProposalDays * DAY), entityType: "opportunity", entityId: id, dedupe: `won-amc-${id}` });
          await ctx.activity("opportunity", id, `Project ${code} created and handed over to ${bh?.name ?? "Projects"}`);
          ctx.note(`Project ${code} created for ${o.code}`);
        }
        await db.update(S.quotations).set({ status: "accepted" }).where(and(eq(S.quotations.opportunityId, id), eq(S.quotations.status, "sent")));
        const c = await primaryContact(o.accountId);
        await ctx.send({ channel: "whatsapp", to: c?.phone, body: `Dear ${c?.name ?? "Sir/Madam"}, thank you for choosing SPACEAIR for ${o.title}. ${bh?.name ?? "Our projects team"} will reach out to schedule the kick-off meeting.`, relatedType: "opportunity", relatedId: id, dedupe: `won-thanks-${id}` });
        const m = (await getSettings()).approvalMatrix;
        if (o.value >= m.ownerValueLakhs * 1e5)
          await ctx.notify((await owner())?.id, `Big win: ${name} – ${money(o.value)}`, { body: o.title, link: `/opportunities/${id}`, dedupe: `won-owner-${id}` });
      },
    },
  },
  {
    key: "lost_review",
    name: "Lost deal review & re-engagement",
    description: "Gives the branch head a review task with the lost reason, and schedules a 90-day check-in with the client so the relationship is not dropped.",
    category: "Sales",
    trigger: "When an opportunity is marked Lost",
    defaults: { reengageDays: 90 },
    configLabels: { reengageDays: "Re-engage after (days)" },
    onEvent: {
      "opportunity.lost": async (ctx, cfg, { id }) => {
        const o = await db.query.opportunities.findFirst({ where: eq(S.opportunities.id, id) });
        if (!o) return;
        const name = await acctName(o.accountId);
        const bh = await branchHead(o.branch);
        await ctx.task({ title: `Review lost deal ${o.code} (${name}): ${o.lostReason ?? "reason not given"}`, assignedTo: bh?.id, dueAt: new Date(ctx.now.getTime() + 3 * DAY), entityType: "opportunity", entityId: id, dedupe: `lost-rev-${id}` });
        await ctx.task({ title: `Check in with ${name} – next project / AMC?`, assignedTo: o.ownerId, dueAt: new Date(ctx.now.getTime() + cfg.reengageDays * DAY), entityType: "opportunity", entityId: id, priority: "low", dedupe: `lost-re-${id}` });
        ctx.note(`Review + ${cfg.reengageDays}-day re-engagement for ${o.code}`);
      },
    },
  },

  /* ───────────── SERVICE ───────────── */
  {
    key: "ticket_auto_dispatch",
    name: "Service ticket auto-dispatch",
    description:
      "Applies the SLA for the priority and checks AMC coverage: uncovered calls are marked chargeable and the service manager is told. Assigns the least-loaded technician in the branch and WhatsApps the client the ticket number and technician's name.",
    category: "Service",
    trigger: "When a service ticket is created",
    defaults: {},
    onEvent: {
      "ticket.created": async (ctx, _cfg, { id }) => {
        const t = await db.query.tickets.findFirst({ where: eq(S.tickets.id, id) });
        if (!t) return;
        const sla = (await getSettings()).sla[t.priority];
        const amcs = await db.select().from(S.amcContracts).where(eq(S.amcContracts.accountId, t.accountId));
        const cover = amcs.find((a) => a.status !== "lapsed" && a.endDate > ctx.now && (!t.amcId || a.id === t.amcId));
        const tech = t.technicianId ? await db.query.users.findFirst({ where: eq(S.users.id, t.technicianId) }) : await pickTechnician(t.branch);
        await db
          .update(S.tickets)
          .set({ slaHours: sla, amcId: cover?.id ?? t.amcId, chargeable: !cover, technicianId: tech?.id, status: tech ? "assigned" : "open" })
          .where(eq(S.tickets.id, id));
        const name = await acctName(t.accountId);
        await ctx.activity("ticket", id, `SLA ${sla} h (${t.priority}) · ${cover ? `covered by ${cover.code}` : "no active AMC: chargeable"} · assigned to ${tech?.name ?? "—"}`);
        await ctx.notify(tech?.id, `${t.priority} job ${t.code}: ${name}`, { body: `${t.site} – ${t.issue}`, link: `/service/${id}`, severity: t.priority === "P1" ? "crit" : "info", dedupe: `tk-assign-${id}` });
        if (!cover) {
          const sm = (await usersBy("service_manager", t.branch))[0] ?? (await usersBy("service_manager"))[0];
          await ctx.notify(sm?.id, `Chargeable call: ${name}`, { body: `${t.code} – no active AMC. Share a rate card, and pitch an AMC.`, link: `/service/${id}`, severity: "warn", dedupe: `tk-charge-${id}` });
        }
        const c = await primaryContact(t.accountId);
        await ctx.send({ channel: "whatsapp", to: c?.phone, body: `SPACEAIR service: complaint ${t.code} registered (${t.priority}, response within ${sla} h). Technician: ${tech?.name ?? "being assigned"}${tech?.phone ? `, ${tech.phone}` : ""}.`, relatedType: "ticket", relatedId: id, dedupe: `tk-ack-${id}` });
        ctx.note(`${t.code} → ${tech?.name ?? "unassigned"}, ${cover ? "AMC" : "chargeable"}`);
      },
    },
  },
  {
    key: "ticket_sla_escalation",
    name: "SLA escalation ladder",
    description:
      "At 75% of the SLA, alerts the technician and service manager. On breach, the branch head is alerted. Only a P1 breached for twice its SLA reaches the Founder.",
    category: "Service",
    trigger: "Every minute",
    defaults: { warnPct: 75 },
    configLabels: { warnPct: "Early warning at (% of SLA used)" },
    onSchedule: async (ctx, cfg) => {
      const list = await db.select().from(S.tickets).where(inArray(S.tickets.status, ["open", "assigned", "in_progress"]));
      for (const t of list) {
        const used = (ctx.now.getTime() - t.createdAt.getTime()) / HOUR / t.slaHours;
        const name = await acctName(t.accountId);
        const sm = (await usersBy("service_manager", t.branch))[0] ?? (await usersBy("service_manager"))[0];
        let level = t.escalationLevel;
        if (used >= cfg.warnPct / 100 && level < 1) {
          await ctx.notify(t.technicianId, `${t.code} at ${Math.round(used * 100)}% of SLA`, { link: `/service/${t.id}`, severity: "warn", dedupe: `sla1-${t.id}` });
          await ctx.notify(sm?.id, `${t.code} nearing SLA: ${name}`, { body: t.issue, link: `/service/${t.id}`, severity: "warn", dedupe: `sla1-${t.id}` });
          level = 1;
        }
        if (used >= 1 && level < 2) {
          const bh = await branchHead(t.branch);
          await ctx.notify(bh?.id, `SLA breached: ${t.code} ${name}`, { body: `${t.priority} · ${t.issue}`, link: `/service/${t.id}`, severity: "crit", dedupe: `sla2-${t.id}` });
          await ctx.notify(sm?.id, `SLA breached: ${t.code}`, { body: t.issue, link: `/service/${t.id}`, severity: "crit", dedupe: `sla2-${t.id}` });
          level = 2;
        }
        if (used >= 2 && t.priority === "P1" && level < 3) {
          await ctx.notify((await owner())?.id, `Critical: P1 ${t.code} at ${name} open ${Math.round(used * t.slaHours)} h`, { body: t.issue, link: `/service/${t.id}`, severity: "crit", dedupe: `sla3-${t.id}` });
          level = 3;
        }
        if (level !== t.escalationLevel) {
          await db.update(S.tickets).set({ escalationLevel: level }).where(eq(S.tickets.id, t.id));
          await ctx.activity("ticket", t.id, `Escalated to level ${level}`);
          ctx.note(`${t.code} → level ${level}`);
        }
      }
    },
  },
  {
    key: "ticket_feedback",
    name: "Customer feedback after resolution",
    description: "Sends the client a one-tap WhatsApp rating as soon as a ticket is resolved.",
    category: "Service",
    trigger: "When a ticket is resolved",
    defaults: {},
    onEvent: {
      "ticket.resolved": async (ctx, _cfg, { id }) => {
        const t = await db.query.tickets.findFirst({ where: eq(S.tickets.id, id) });
        if (!t) return;
        const c = await primaryContact(t.accountId);
        if (await ctx.send({ channel: "whatsapp", to: c?.phone, body: `SPACEAIR: complaint ${t.code} has been resolved. How did we do? Reply 1 (poor) to 5 (excellent).`, relatedType: "ticket", relatedId: id, dedupe: `tk-fb-${id}` }))
          ctx.note(`Feedback request for ${t.code}`);
      },
    },
  },

  /* ───────────── AMC ───────────── */
  {
    key: "amc_renewal",
    name: "AMC renewal autopilot",
    description:
      "Within the notice window, creates a renewal opportunity and quotation (with the standard uplift), emails it to the client and gives the owner a follow-up task. Reminds at 30 days and alerts the branch head at 7 days. Marks the AMC lapsed on expiry.",
    category: "AMC",
    trigger: "Every minute",
    defaults: { noticeDays: 60, upliftPct: 7 },
    configLabels: { noticeDays: "Start renewal (days before expiry)", upliftPct: "Standard renewal uplift (%)" },
    onSchedule: async (ctx, cfg) => {
      const list = await db.select().from(S.amcContracts).where(inArray(S.amcContracts.status, ["active", "renewal_sent"]));
      for (const a of list) {
        const days = Math.ceil((a.endDate.getTime() - ctx.now.getTime()) / DAY);
        const name = await acctName(a.accountId);
        if (days < 0) {
          await db.update(S.amcContracts).set({ status: "lapsed" }).where(eq(S.amcContracts.id, a.id));
          const bh = await branchHead(a.branch);
          const sm = (await usersBy("service_manager", a.branch))[0];
          for (const u of [bh, sm]) await ctx.notify(u?.id, `AMC lapsed: ${name}`, { body: `${a.code} · ${money(a.annualValue)}/yr. Service calls are now chargeable.`, link: `/amc/${a.id}`, severity: "crit", dedupe: `amc-lapsed-${a.id}` });
          ctx.note(`${a.code} lapsed`);
          continue;
        }
        if (a.status === "active" && days <= cfg.noticeDays) {
          const newVal = Math.round((a.annualValue * (1 + cfg.upliftPct / 100)) / 100) * 100;
          const oid = uid();
          const ocode = await nextCode("O", 1057);
          await db.insert(S.opportunities).values({
            id: oid, code: ocode, accountId: a.accountId, title: `AMC renewal – ${a.site}`, division: "AMC / Service", branch: a.branch,
            stage: "quotation", value: newVal, ownerId: a.ownerId, source: "AMC renewal", nextAction: "Confirm renewal PO",
            nextActionDue: new Date(ctx.now.getTime() + 7 * DAY), stageChangedAt: ctx.now, lastActivityAt: ctx.now,
          });
          const qid = uid();
          const qcode = await nextCode("Q-26", 201);
          await db.insert(S.quotations).values({ id: qid, code: qcode, opportunityId: oid, status: "sent", kind: "amc_renewal", amcId: a.id, sentAt: ctx.now, validityDays: 30, terms: `Renewal of ${a.code} for 12 months from ${fmtDate(a.endDate)} with a standard ${cfg.upliftPct}% uplift.` });
          await db.insert(S.quoteItems).values({ id: uid(), quotationId: qid, description: `${a.type === "comprehensive" ? "Comprehensive" : "Non-comprehensive"} AMC – ${a.scope} (${a.visitsPerYear} PPM visits + breakdown support)`, unit: "Year", qty: 1, rate: newVal, sort: 0 });
          await db.update(S.amcContracts).set({ status: "renewal_sent" }).where(eq(S.amcContracts.id, a.id));
          const c = await primaryContact(a.accountId);
          await ctx.send({ channel: "email", to: c?.email, subject: `AMC renewal quotation ${qcode} – ${a.site}`, body: `Dear ${c?.name ?? "Sir/Madam"},\n\nYour SPACEAIR AMC ${a.code} (${a.scope}) expires on ${fmtDate(a.endDate)}. Please find our renewal quotation ${qcode} for ${money(newVal)} + GST for the next 12 months.\n\nRegards,\nSPACEAIR Service`, relatedType: "amc", relatedId: a.id, dedupe: `amc-q-${a.id}` });
          await ctx.task({ title: `Close AMC renewal with ${name} (${a.code})`, assignedTo: a.ownerId, dueAt: new Date(ctx.now.getTime() + 7 * DAY), entityType: "amc", entityId: a.id, priority: "high", dedupe: `amc-task-${a.id}` });
          await ctx.activity("amc", a.id, `Renewal quotation ${qcode} (${money(newVal)}) auto-generated and emailed`);
          ctx.note(`${a.code}: renewal ${qcode} sent`);
          continue;
        }
        if (a.status === "renewal_sent" && days <= 30)
          await ctx.notify(a.ownerId, `AMC renewal pending: ${name} (${days} d left)`, { link: `/amc/${a.id}`, severity: "warn", dedupe: `amc30-${a.id}` });
        if (a.status === "renewal_sent" && days <= 7)
          await ctx.notify((await branchHead(a.branch))?.id, `AMC expiring in ${days} d: ${name}`, { body: `${a.code} · ${money(a.annualValue)}/yr not yet renewed`, link: `/amc/${a.id}`, severity: "crit", dedupe: `amc7-${a.id}` });
      }
    },
  },
  {
    key: "ppm_scheduler",
    name: "PPM visit planner",
    description: "Plans every preventive-maintenance visit for the contract year as soon as an AMC starts, assigns a technician, reminds them the day before, and flags missed visits to the service manager.",
    category: "AMC",
    trigger: "Every minute",
    defaults: { missedAfterDays: 2 },
    configLabels: { missedAfterDays: "Mark missed after (days)" },
    onSchedule: async (ctx, cfg) => {
      const amcs = await db.select().from(S.amcContracts).where(inArray(S.amcContracts.status, ["active", "renewal_sent", "renewed"]));
      for (const a of amcs) {
        if (!(await ctx.once(`ppm-plan-${a.id}-${a.startDate.getTime()}`))) continue;
        const existing = await db.select().from(S.ppmVisits).where(eq(S.ppmVisits.amcId, a.id));
        if (existing.some((v) => v.scheduledFor >= a.startDate && v.scheduledFor <= a.endDate)) continue;
        const span = a.endDate.getTime() - a.startDate.getTime();
        const tech = await pickTechnician(a.branch);
        for (let i = 0; i < a.visitsPerYear; i++)
          await db.insert(S.ppmVisits).values({ id: uid(), amcId: a.id, scheduledFor: new Date(a.startDate.getTime() + (i + 0.5) * (span / a.visitsPerYear)), technicianId: tech?.id });
        ctx.actions += a.visitsPerYear;
        ctx.note(`${a.code}: ${a.visitsPerYear} visits planned`);
      }
      const visits = await db.select().from(S.ppmVisits).where(eq(S.ppmVisits.status, "scheduled"));
      for (const v of visits) {
        const hrs = (v.scheduledFor.getTime() - ctx.now.getTime()) / HOUR;
        const a = amcs.find((x) => x.id === v.amcId) ?? (await db.query.amcContracts.findFirst({ where: eq(S.amcContracts.id, v.amcId) }));
        if (!a) continue;
        if (hrs > 0 && hrs <= 24)
          await ctx.notify(v.technicianId, `PPM visit tomorrow: ${await acctName(a.accountId)}`, { body: `${a.site} – ${a.scope}`, link: `/amc/${a.id}`, dedupe: `ppm-rem-${v.id}` });
        if (hrs < -cfg.missedAfterDays * 24) {
          await db.update(S.ppmVisits).set({ status: "missed" }).where(eq(S.ppmVisits.id, v.id));
          const sm = (await usersBy("service_manager", a.branch))[0] ?? (await usersBy("service_manager"))[0];
          await ctx.notify(sm?.id, `Missed PPM visit: ${await acctName(a.accountId)}`, { body: `${a.code} visit due ${fmtDate(v.scheduledFor)}`, link: `/amc/${a.id}`, severity: "warn", dedupe: `ppm-miss-${v.id}` });
          ctx.note(`Missed visit flagged for ${a.code}`);
        }
      }
    },
  },
  {
    key: "balance_payment_reminder",
    name: "Balance payment reminders",
    description:
      "Sends a payment reminder email on each date scheduled for a project (Email automation page), as long as a balance is still outstanding. Escalates to Accounts once the balance has been outstanding past the configured number of days.",
    category: "Projects",
    trigger: "Every minute",
    defaults: { escalateAfterDays: 90 },
    configLabels: { escalateAfterDays: "Escalate to Accounts (days)" },
    onSchedule: async (ctx, cfg) => {
      const due = await db.select().from(S.paymentReminders).where(and(isNull(S.paymentReminders.sentAt), lt(S.paymentReminders.sendAt, ctx.now)));
      for (const r of due) {
        const p = await db.query.projects.findFirst({ where: eq(S.projects.id, r.projectId) });
        if (!p) continue;
        if (p.reminderPausedUntil && p.reminderPausedUntil > ctx.now) continue;
        const paidRows = await db.select().from(S.payments).where(eq(S.payments.projectId, p.id));
        const paid = paidRows.reduce((s, x) => s + x.amount, 0);
        const balance = p.value - paid;
        if (balance <= 0) {
          await db.update(S.paymentReminders).set({ sentAt: ctx.now }).where(eq(S.paymentReminders.id, r.id));
          continue;
        }
        const name = await acctName(p.accountId);
        const c = await primaryContact(p.accountId);
        const to = p.reminderTo || c?.email;
        if (to) {
          const bodyTemplate = p.reminderBody || defaultReminderBody(c?.name ?? "Sir/Madam", p.name, p.code);
          const subjectTemplate = p.reminderSubject || defaultReminderSubject(p.code);
          const body = fillReminderTemplate(bodyTemplate, { value: p.value, balance });
          const subject = fillReminderTemplate(subjectTemplate, { value: p.value, balance });
          const acct = await db.query.accounts.findFirst({ where: eq(S.accounts.id, p.accountId) });
          const statementPdf = await buildStatementPdf({ code: p.code, name: p.name, clientName: acct?.name ?? "", value: p.value, payments: paidRows });
          const result = await ctx.sendThreaded({
            channel: "email",
            to,
            cc: p.reminderCc,
            bcc: p.reminderBcc,
            subject,
            body,
            relatedType: "project",
            relatedId: p.id,
            dedupe: `balance-rem-${r.id}`,
            accountId: p.reminderAccountId,
            attachments: [{ filename: `${p.code} statement of account.pdf`, contentType: "application/pdf", data: statementPdf }],
          });
          if (result.sent) {
            ctx.note(`${p.code}: balance reminder sent to ${name}`);
            if (result.messageId) await db.update(S.paymentReminders).set({ gmailMessageId: result.messageId, gmailThreadId: result.threadId }).where(eq(S.paymentReminders.id, r.id));
          }
        }
        await db.update(S.paymentReminders).set({ sentAt: ctx.now }).where(eq(S.paymentReminders.id, r.id));
        ctx.actions++;
      }
      if (cfg.escalateAfterDays > 0) {
        const list = await db.select().from(S.projects).where(inArray(S.projects.status, ["handover", "execution"]));
        for (const p of list) {
          const paidRows = await db.select().from(S.payments).where(eq(S.payments.projectId, p.id));
          const paid = paidRows.reduce((s, x) => s + x.amount, 0);
          const balance = p.value - paid;
          if (balance <= 0) continue;
          const days = Math.floor((ctx.now.getTime() - p.createdAt.getTime()) / DAY);
          if (days < cfg.escalateAfterDays) continue;
          const name = await acctName(p.accountId);
          const bh = await branchHead(p.branch);
          const acc = (await usersBy("accounts"))[0];
          for (const u of [bh, acc])
            await ctx.notify(u?.id, `Balance overdue: ${name} (${p.code})`, {
              body: `${money(balance)} outstanding on ${p.code}, ${days} days since start.`,
              link: `/projects/${p.id}`,
              severity: "crit",
              dedupe: `balance-esc-${p.id}`,
            });
        }
      }
    },
  },
  {
    key: "poll_email_replies",
    name: "Check for balance reminder replies",
    description: "Polls Gmail for replies to sent balance payment reminders, and alerts the project manager (or Founder) as soon as a client replies.",
    category: "Projects",
    trigger: "Every minute",
    defaults: {},
    onSchedule: async (ctx) => {
      const { pollGmailForReplies } = await import("@/lib/gmail-poll");
      const { newReplies } = await pollGmailForReplies();
      for (const { projectId, replyId } of newReplies) {
        const p = await db.query.projects.findFirst({ where: eq(S.projects.id, projectId) });
        if (!p) continue;
        const name = await acctName(p.accountId);
        await ctx.notify(p.pmId ?? (await owner())?.id, `Reply on balance reminder: ${name} (${p.code})`, {
          link: `/email-automation/${p.id}#reply-${replyId}`,
          severity: "info",
        });
        ctx.actions++;
        ctx.note(`${p.code}: new reply from ${name}`);
      }
    },
  },
  {
    key: "send_broadcast",
    name: "Send queued broadcast emails",
    description: "Sends queued recipients of a one-off broadcast email (Email automation → Broadcast) a batch at a time, to stay within Gmail's sending limits.",
    category: "Management",
    trigger: "Every minute",
    defaults: { batchSize: 20 },
    configLabels: { batchSize: "Recipients per run" },
    onSchedule: async (ctx, cfg) => {
      const queued = await db.select().from(S.broadcastRecipients).where(eq(S.broadcastRecipients.status, "queued"));
      if (!queued.length) return;
      const broadcastIds = [...new Set(queued.map((r) => r.broadcastId))];
      const broadcastsById = new Map((await Promise.all(broadcastIds.map((id) => db.query.broadcasts.findFirst({ where: eq(S.broadcasts.id, id) })))).filter((b): b is NonNullable<typeof b> => !!b).map((b) => [b.id, b]));
      const due = queued.filter((r) => {
        const b = broadcastsById.get(r.broadcastId);
        return b && (r.sendAt ?? b.sendAfter) <= ctx.now;
      }).slice(0, Math.max(1, cfg.batchSize));
      if (!due.length) return;
      for (const r of due) {
        const b = broadcastsById.get(r.broadcastId)!;
        const result = await sendMail({ to: r.email, cc: r.cc ?? b.cc ?? undefined, bcc: r.bcc ?? b.bcc ?? undefined, subject: r.subject ?? b.subject, body: r.body ?? b.body, accountId: b.accountId });
        await db
          .update(S.broadcastRecipients)
          .set({
            status: result.ok ? "sent" : "failed",
            error: result.ok ? null : result.error,
            sentAt: ctx.now,
            gmailMessageId: result.ok ? result.messageId : null,
            gmailThreadId: result.ok ? result.threadId : null,
          })
          .where(eq(S.broadcastRecipients.id, r.id));
        ctx.actions++;
      }
      ctx.note(`Sent ${due.length} broadcast emails`);
    },
  },
  {
    key: "poll_broadcast_replies",
    name: "Check for broadcast email replies",
    description: "Polls Gmail for replies to sent broadcast emails, and alerts whoever created the broadcast as soon as a recipient replies.",
    category: "Management",
    trigger: "Every minute",
    defaults: {},
    onSchedule: async (ctx) => {
      const { pollGmailForBroadcastReplies } = await import("@/lib/gmail-poll");
      const { newReplies } = await pollGmailForBroadcastReplies();
      for (const { recipientId, broadcastId, replyId } of newReplies) {
        const b = await db.query.broadcasts.findFirst({ where: eq(S.broadcasts.id, broadcastId) });
        if (!b) continue;
        const recipient = await db.query.broadcastRecipients.findFirst({ where: eq(S.broadcastRecipients.id, recipientId) });
        await ctx.notify(b.createdBy ?? (await owner())?.id, `Reply on broadcast: ${b.subject}`, {
          body: recipient?.email,
          link: `/email-automation#reply-${replyId}`,
          severity: "info",
        });
        ctx.actions++;
        ctx.note(`${b.subject}: new reply from ${recipient?.email ?? "recipient"}`);
      }
    },
  },

  /* ───────────── ESTIMATION ───────────── */
  {
    key: "boq_autoprice",
    name: "BOQ auto-pricing from the rate library",
    description:
      "When a client or consultant BOQ is imported, every line is priced from the company rate library (exact match) or estimated from similar sizes in the same section (e.g. fans by CFM, trays by width). The estimator gets one review task listing what still needs a rate.",
    category: "Estimation",
    trigger: "When a BOQ Excel is imported",
    defaults: { reviewDays: 2 },
    configLabels: { reviewDays: "Estimator review deadline (days)" },
    onEvent: {
      "quotation.imported": async (ctx, cfg, { id }) => {
        const q = await db.query.quotations.findFirst({ where: eq(S.quotations.id, id) });
        if (!q) return;
        const lib = await db.select().from(S.rateItems);
        const items = await db.select().from(S.quoteItems).where(eq(S.quoteItems.quotationId, id));
        let exact = 0, est = 0, none = 0;
        for (const it of items) {
          if ((it.supplyRate ?? 0) + (it.installRate ?? 0) > 0) continue;
          const p = priceLine(it, lib);
          if (!p) {
            none++;
            continue;
          }
          if (p.source === "library") exact++;
          else est++;
          await db
            .update(S.quoteItems)
            .set({ supplyRate: p.supplyRate, installRate: p.installRate, rate: p.supplyRate + p.installRate, rateSource: p.source })
            .where(eq(S.quoteItems.id, it.id));
        }
        const fresh = await db.select().from(S.quoteItems).where(eq(S.quoteItems.quotationId, id));
        const t = quoteTotals(fresh.filter((i) => !i.qro), q.discountPct, q.gstPct);
        const o = await db.query.opportunities.findFirst({ where: eq(S.opportunities.id, q.opportunityId) });
        if (o) await db.update(S.opportunities).set({ value: t.net, lastActivityAt: ctx.now }).where(eq(S.opportunities.id, o.id));
        const estimator = (await usersBy("estimator", o?.branch)).concat(await usersBy("estimator"))[0] ?? (await branchHead(o?.branch ?? "Chennai"));
        const soon = q.dueAt && q.dueAt.getTime() - ctx.now.getTime() < cfg.reviewDays * DAY;
        const due = soon ? new Date(q.dueAt!.getTime() - 12 * HOUR) : new Date(ctx.now.getTime() + cfg.reviewDays * DAY);
        await ctx.task({ title: `Review BOQ ${q.code}: ${exact} priced from library, ${est} estimated, ${none} need rates`, assignedTo: estimator?.id, dueAt: due, entityType: "quotation", entityId: id, priority: "high", dedupe: `boq-review-${id}` });
        await ctx.notify(estimator?.id, `BOQ imported: ${q.code} (${items.length} lines)`, { body: `${exact} auto-priced · ${est} estimated · ${none} to price · value so far ${money(t.net)}`, link: `/quotations/${id}`, dedupe: `boq-imp-${id}` });
        await ctx.activity("opportunity", q.opportunityId, `BOQ ${q.fileName ?? q.code} imported: ${items.length} lines, ${exact} priced from rate library, ${est} estimated, ${none} unpriced`);
        ctx.actions += exact + est;
        ctx.note(`${q.code}: ${exact} library · ${est} estimated · ${none} unpriced of ${items.length}`);
      },
    },
  },
  {
    key: "rate_library_learn",
    name: "Rate library learns from every quotation",
    description:
      "When a quotation is sent to a client, its supply and installation rates are saved to the rate library. The next BOQ with the same items prices itself, so pricing knowledge stays with the company instead of one person.",
    category: "Estimation",
    trigger: "When a quotation is sent",
    defaults: {},
    onEvent: {
      "quotation.sent": async (ctx, _cfg, { id }) => {
        const q = await db.query.quotations.findFirst({ where: eq(S.quotations.id, id) });
        if (!q || q.kind === "amc_renewal") return;
        const items = await db.select().from(S.quoteItems).where(eq(S.quoteItems.quotationId, id));
        let n = 0;
        for (const it of items) {
          const supply = it.supplyRate ?? it.rate, install = it.installRate ?? 0;
          if (supply + install <= 0) continue;
          const key = rateKey(it.section, it.description, it.unit);
          const src = `${q.code} R${q.revision}`;
          await db
            .insert(S.rateItems)
            .values({ id: uid(), key, section: it.section, description: it.description.slice(0, 400), unit: it.unit, supplyRate: supply, installRate: install, source: src })
            .onConflictDoUpdate({ target: S.rateItems.key, set: { supplyRate: supply, installRate: install, source: src, uses: sql`${S.rateItems.uses} + 1`, updatedAt: ctx.now } });
          n++;
        }
        if (n) {
          ctx.actions += 1;
          ctx.note(`${q.code} R${q.revision}: ${n} rates saved to library`);
        }
      },
    },
  },
  {
    key: "tender_deadline",
    name: "Tender / BOQ submission deadline",
    description: "Tracks the client's submission date on imported BOQs. Alerts the estimator and deal owner 48 h before, the branch head 24 h before, and flags missed submissions.",
    category: "Estimation",
    trigger: "Every minute",
    defaults: { warnHours: 48, escalateHours: 24 },
    configLabels: { warnHours: "Warn estimator (hours before)", escalateHours: "Alert branch head (hours before)" },
    onSchedule: async (ctx, cfg) => {
      const list = await db.select().from(S.quotations).where(inArray(S.quotations.status, ["draft", "pending_approval", "approved"]));
      for (const q of list) {
        if (!q.dueAt) continue;
        const h = (q.dueAt.getTime() - ctx.now.getTime()) / HOUR;
        const o = await db.query.opportunities.findFirst({ where: eq(S.opportunities.id, q.opportunityId) });
        if (!o) continue;
        const name = await acctName(o.accountId);
        if (h <= cfg.warnHours && h > 0) {
          const est = (await usersBy("estimator", o.branch)).concat(await usersBy("estimator"))[0];
          for (const u of [est?.id, o.ownerId])
            await ctx.notify(u, `${q.code} due in ${Math.round(h)} h: ${name}`, { body: `Status: ${q.status.replace("_", " ")}`, link: `/quotations/${q.id}`, severity: "warn", dedupe: `tdl-warn-${q.id}` });
        }
        if (h <= cfg.escalateHours && h > 0)
          if (await ctx.notify((await branchHead(o.branch))?.id, `Submission due in ${Math.round(h)} h: ${q.code}`, { body: `${name} · still ${q.status.replace("_", " ")}`, link: `/quotations/${q.id}`, severity: "crit", dedupe: `tdl-esc-${q.id}` }))
            ctx.note(`${q.code} deadline escalated`);
        if (h <= 0)
          if (await ctx.notify((await branchHead(o.branch))?.id, `Missed submission: ${q.code}`, { body: `${name}: was due ${fmtDate(q.dueAt)}`, link: `/quotations/${q.id}`, severity: "crit", dedupe: `tdl-miss-${q.id}` }))
            ctx.note(`${q.code} submission missed`);
      }
    },
  },

  /* ───────────── PROJECT DELIVERY ───────────── */
  {
    key: "project_phase_gate",
    name: "Project phase gates & handover",
    description:
      "Moves each project through Client award → Engineering & approvals → Procurement → Site execution → QA/QC & commissioning → Handover as checklist items are completed, and hands work to the next team (e.g. Procurement). Reminds the PM when consultant approvals stall. On handover it creates an AMC opportunity, so the relationship continues into service.",
    category: "Projects",
    trigger: "When a project checklist changes, plus every minute",
    defaults: { approvalStallDays: 14, amcValuePct: 3 },
    configLabels: { approvalStallDays: "Remind PM if approvals open after (days)", amcValuePct: "AMC value estimate (% of project value)" },
    onEvent: {
      "project.updated": async (ctx, cfg, { id }) => {
        const p = await db.query.projects.findFirst({ where: eq(S.projects.id, id) });
        if (!p || p.phase === "closed") return;
        const firstOpen = PROJECT_PHASES.find((ph) => p.checklist.some((c) => c.phase === ph.key && !c.done));
        const next = firstOpen?.key ?? "closed";
        if (next === p.phase) return;
        const done = p.checklist.filter((c) => c.done).length;
        await db
          .update(S.projects)
          .set({ phase: next, status: next === "closed" ? "completed" : next === "award" ? "handover" : "execution", progress: Math.round((done / p.checklist.length) * 100) })
          .where(eq(S.projects.id, id));
        await ctx.activity("project", id, `Phase: ${phaseLabel(p.phase)} → ${phaseLabel(next)}`);
        const name = await acctName(p.accountId);
        if (next !== "closed") {
          const role = PROJECT_PHASES.find((x) => x.key === next)!.owner;
          const team = (await usersBy(role, p.branch)).concat(await usersBy(role));
          const who = team[0]?.id ?? p.pmId;
          await ctx.notify(who, `${p.code} is now in ${phaseLabel(next)}`, { body: `${name}: ${p.name}`, link: `/projects/${id}`, dedupe: `phase-${id}-${next}` });
          if (who !== p.pmId) await ctx.notify(p.pmId, `${p.code} moved to ${phaseLabel(next)}`, { link: `/projects/${id}`, dedupe: `phase-pm-${id}-${next}` });
          ctx.note(`${p.code} → ${phaseLabel(next)}`);
          return;
        }
        // Handover complete → AMC opportunity, so service revenue starts without anyone having to remember.
        const acc = await db.query.accounts.findFirst({ where: eq(S.accounts.id, p.accountId) });
        const oid = uid();
        await db.insert(S.opportunities).values({
          id: oid, code: await nextCode("O", 1041), accountId: p.accountId, title: `AMC after handover – ${p.name}`, division: "AMC / Service", branch: p.branch,
          stage: "qualified", value: Math.round((p.value * cfg.amcValuePct) / 100 / 100) * 100, ownerId: acc?.ownerId ?? p.pmId, source: "Project handover",
          nextAction: "Share AMC proposal with warranty terms", nextActionDue: new Date(ctx.now.getTime() + 7 * DAY), stageChangedAt: ctx.now, lastActivityAt: ctx.now,
        });
        await ctx.task({ title: `Propose AMC to ${name} (handover of ${p.code})`, assignedTo: acc?.ownerId ?? p.pmId, dueAt: new Date(ctx.now.getTime() + 7 * DAY), entityType: "opportunity", entityId: oid, priority: "high", dedupe: `handover-amc-${id}` });
        ctx.note(`${p.code} handed over → AMC opportunity created`);
      },
    },
    onSchedule: async (ctx, cfg) => {
      const list = await db.select().from(S.projects).where(inArray(S.projects.phase, ["award", "engineering"]));
      const wk = Math.floor(ctx.now.getTime() / (7 * DAY));
      for (const p of list) {
        const age = (ctx.now.getTime() - p.createdAt.getTime()) / DAY;
        const pending = p.checklist.filter((c) => c.phase === "engineering" && !c.done).map((c) => c.item);
        if (age >= cfg.approvalStallDays && pending.length)
          if (await ctx.task({ title: `${p.code}: chase consultant approvals (${pending.join(", ")})`, assignedTo: p.pmId, dueAt: new Date(ctx.now.getTime() + 2 * DAY), entityType: "project", entityId: p.id, priority: "high", dedupe: `appr-stall-${p.id}-${wk}` }))
            ctx.note(`${p.code}: approvals stalled ${Math.round(age)} d`);
      }
    },
  },

  /* ───────────── MANAGEMENT ───────────── */
  {
    key: "daily_digest",
    name: "Exception-only daily digest",
    description:
      "Every morning the Founder gets one email listing only what needs them: pending owner approvals, P1 breaches, lapsed AMCs and big wins or losses. Each branch head gets a branch digest, so nobody has to chase updates by phone.",
    category: "Management",
    trigger: "Daily at the configured hour",
    defaults: { hour: 8 },
    configLabels: { hour: "Send at (hour, 24 h)" },
    onSchedule: async (ctx, cfg) => {
      if (ctx.now.getHours() < cfg.hour) return;
      const dk = dateKey(ctx.now);
      const own = await owner();
      const pendingOwner = await db.select().from(S.approvals).where(and(eq(S.approvals.status, "pending"), eq(S.approvals.approverRole, "owner")));
      const openT = await db.select().from(S.tickets).where(inArray(S.tickets.status, ["open", "assigned", "in_progress"]));
      const breached = openT.filter((t) => ctx.now.getTime() - t.createdAt.getTime() > t.slaHours * HOUR);
      const lapsed = await db.select().from(S.amcContracts).where(eq(S.amcContracts.status, "lapsed"));
      const recent = await db.select().from(S.opportunities).where(inArray(S.opportunities.stage, ["won", "lost"])).orderBy(desc(S.opportunities.stageChangedAt));
      const last = recent.filter((o) => o.stageChangedAt && ctx.now.getTime() - o.stageChangedAt.getTime() < 7 * DAY);
      const lines = [
        `Approvals waiting for you: ${pendingOwner.length}${pendingOwner.map((a) => `\n  • ${a.title} (${a.detail})`).join("")}`,
        `SLA breaches (all branches): ${breached.length}, of which P1: ${breached.filter((t) => t.priority === "P1").length}`,
        `Lapsed AMCs: ${lapsed.length}${lapsed.map((a) => `\n  • ${a.code} ${money(a.annualValue)}/yr`).join("")}`,
        `Won / lost in the last 7 days: ${last.map((o) => `\n  • ${o.code} ${stageLabel(o.stage)} ${money(o.value)}`).join("") || "none"}`,
        "Everything else is being handled by branch teams and automations.",
      ];
      if (await ctx.send({ channel: "email", to: own?.email, subject: `SPACEAIR daily digest – ${fmtDate(ctx.now)}`, body: lines.join("\n"), relatedType: "digest", dedupe: `digest-owner-${dk}` }))
        ctx.note("Founder digest sent");
      for (const bh of await usersBy("branch_head")) {
        const opp = await db.select().from(S.opportunities).where(and(eq(S.opportunities.branch, bh.branch), inArray(S.opportunities.stage, OPEN_STAGES)));
        const overdue = opp.filter((o) => o.nextActionDue && o.nextActionDue < ctx.now);
        const tb = openT.filter((t) => t.branch === bh.branch);
        const body = `${bh.branch} branch – ${fmtDate(ctx.now)}\nOpen pipeline: ${money(opp.reduce((s, o) => s + o.value, 0))} across ${opp.length} deals\nOverdue follow-ups: ${overdue.length}\nOpen service tickets: ${tb.length} (${tb.filter((t) => ctx.now.getTime() - t.createdAt.getTime() > t.slaHours * HOUR).length} past SLA)`;
        if (await ctx.send({ channel: "email", to: bh.email, subject: `${bh.branch} daily digest`, body, relatedType: "digest", dedupe: `digest-${bh.id}-${dk}` }))
          ctx.note(`${bh.branch} digest sent`);
      }
    },
  },
];
