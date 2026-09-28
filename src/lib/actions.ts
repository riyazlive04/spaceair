"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema as S } from "@/db";
import { createSession, destroySession, requireUser, canApprove } from "@/lib/auth";
import { emit, runScheduled } from "@/lib/automation/engine";
import { uid, nextCode, getSettings } from "@/lib/automation/ctx";
import { RULES } from "@/lib/automation/rules";
import { quoteTotals, money, DAY } from "@/lib/format";
import { stageLabel, type StageKey } from "@/lib/constants";
import * as PC from "@/lib/product-codes/run";

async function flash(msg: string) {
  (await cookies()).set("sa_flash", encodeURIComponent(msg), { path: "/", maxAge: 20 });
}
const refresh = () => revalidatePath("/", "layout");
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
async function log(entityType: string, entityId: string, body: string, userId: string | null, kind: "note" | "call" | "meeting" | "email" | "whatsapp" | "system" = "system") {
  await db.insert(S.activities).values({ id: uid(), entityType, entityId, kind, body, userId });
}

/* ───────── session ───────── */
export async function loginAs(f: FormData) {
  await createSession(str(f, "userId"));
  redirect("/dashboard");
}
export async function logout() {
  await destroySession();
  redirect("/login");
}
export async function setBranch(f: FormData) {
  (await cookies()).set("sa_branch", str(f, "branch") || "All", { path: "/" });
  refresh();
}

/* ───────── enquiries ───────── */
const EnquirySchema = z.object({
  company: z.string().min(2, "Company is required"),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  requirement: z.string().min(3, "Describe the requirement"),
  division: z.string(),
  branch: z.string(),
  source: z.string().default("Website form"),
  estValue: z.coerce.number().optional(),
});

async function insertEnquiry(f: FormData, sourceOverride?: string) {
  const d = EnquirySchema.parse(Object.fromEntries(f));
  const id = uid();
  const code = await nextCode("E", 2301);
  await db.insert(S.enquiries).values({
    id,
    code,
    company: d.company,
    contactName: d.contactName,
    phone: d.phone,
    email: d.email,
    requirement: d.requirement,
    division: d.division,
    branch: d.branch,
    source: sourceOverride ?? d.source,
    estValue: d.estValue ? d.estValue * 1e5 : null,
  });
  return { id, code };
}

export async function createEnquiry(f: FormData) {
  const u = await requireUser();
  const { id, code } = await insertEnquiry(f);
  await log("enquiry", id, `Logged by ${u.name}`, u.id);
  await emit("enquiry.created", { id, userId: u.id });
  await flash(`${code} saved: auto-assigned and client acknowledged`);
  refresh();
  redirect(`/enquiries/${id}`);
}

/** Public website form: no login. The same endpoint can back the spaceair.in contact page. */
export async function publicEnquiry(f: FormData) {
  const { id, code } = await insertEnquiry(f, "Website form");
  await emit("enquiry.created", { id });
  redirect(`/enquire?ref=${code}`);
}

export async function respondEnquiry(id: string, f: FormData) {
  const u = await requireUser();
  const kind = (str(f, "kind") || "call") as "call" | "email" | "whatsapp" | "meeting";
  await db.update(S.enquiries).set({ status: "contacted", firstResponseAt: new Date() }).where(and(eq(S.enquiries.id, id), eq(S.enquiries.status, "new")));
  await db.update(S.tasks).set({ status: "done", completedAt: new Date() }).where(eq(S.tasks.dedupeKey, `enq-first-${id}`));
  await log("enquiry", id, str(f, "note") || "Client contacted", u.id, kind);
  await flash("Response logged; first-response task closed");
  refresh();
}

export async function reassignEnquiry(id: string, f: FormData) {
  const u = await requireUser();
  const to = str(f, "userId");
  const who = await db.query.users.findFirst({ where: eq(S.users.id, to) });
  await db.update(S.enquiries).set({ assignedTo: to }).where(eq(S.enquiries.id, id));
  await log("enquiry", id, `Re-assigned to ${who?.name}`, u.id);
  refresh();
}

export async function disqualifyEnquiry(id: string, f: FormData) {
  const u = await requireUser();
  const reason = str(f, "reason") || "Not a fit";
  await db.update(S.enquiries).set({ status: "disqualified", disqualifyReason: reason }).where(eq(S.enquiries.id, id));
  await db.update(S.tasks).set({ status: "done", completedAt: new Date() }).where(eq(S.tasks.dedupeKey, `enq-first-${id}`));
  await log("enquiry", id, `Disqualified: ${reason}`, u.id);
  refresh();
}

export async function convertEnquiry(id: string) {
  const u = await requireUser();
  const e = await db.query.enquiries.findFirst({ where: eq(S.enquiries.id, id) });
  if (!e) return;
  let accountId = e.accountId;
  if (!accountId) {
    accountId = `A${Date.now().toString(36).toUpperCase()}`;
    await db.insert(S.accounts).values({ id: accountId, name: e.company, branch: e.branch, city: e.branch, industry: "New client", tier: "New", ownerId: e.assignedTo ?? u.id });
    if (e.contactName) await db.insert(S.contacts).values({ id: uid(), accountId, name: e.contactName, phone: e.phone, email: e.email, role: "Primary contact" });
  }
  const oid = uid();
  const code = await nextCode("O", 1041);
  await db.insert(S.opportunities).values({
    id: oid, code, accountId, title: e.requirement, division: e.division, branch: e.branch, stage: "qualified",
    value: e.estValue ?? 0, ownerId: e.assignedTo ?? u.id, source: e.source, nextAction: "Schedule site survey",
    nextActionDue: new Date(Date.now() + 2 * DAY), stageChangedAt: new Date(), lastActivityAt: new Date(),
  });
  await db.update(S.enquiries).set({ status: "converted", opportunityId: oid, accountId, firstResponseAt: e.firstResponseAt ?? new Date() }).where(eq(S.enquiries.id, id));
  await db.update(S.tasks).set({ status: "done", completedAt: new Date() }).where(eq(S.tasks.dedupeKey, `enq-first-${id}`));
  await log("opportunity", oid, `Created from enquiry ${e.code} (${e.source})`, u.id);
  await flash(`${e.code} converted to opportunity ${code}`);
  refresh();
  redirect(`/opportunities/${oid}`);
}

/* ───────── opportunities ───────── */
export async function moveStage(id: string, stage: StageKey, lostReason?: string) {
  const u = await requireUser();
  const o = await db.query.opportunities.findFirst({ where: eq(S.opportunities.id, id) });
  if (!o || o.stage === stage) return;
  await db.update(S.opportunities).set({ stage, stageChangedAt: new Date(), lastActivityAt: new Date(), lostReason: stage === "lost" ? lostReason || "Not specified" : o.lostReason }).where(eq(S.opportunities.id, id));
  await log("opportunity", id, `Stage: ${stageLabel(o.stage)} → ${stageLabel(stage)}${stage === "lost" ? ` (${lostReason || "no reason"})` : ""}`, u.id);
  if (stage === "won") {
    const rq = await db.query.quotations.findFirst({ where: and(eq(S.quotations.opportunityId, id), eq(S.quotations.kind, "amc_renewal")) });
    if (rq?.amcId) await renewAmcInternal(rq.amcId, o.value, u.id);
    await emit("opportunity.won", { id, userId: u.id });
    await flash(o.division === "AMC / Service" ? "AMC renewed for 12 months" : "PO received: project created and handed over");
  } else if (stage === "lost") {
    await emit("opportunity.lost", { id, userId: u.id });
    await flash("Marked lost: review and re-engagement tasks created");
  } else await flash(`Moved to ${stageLabel(stage)}`);
  refresh();
}
export async function moveStageForm(id: string, f: FormData) {
  await moveStage(id, str(f, "stage") as StageKey, str(f, "lostReason"));
}

export async function updateOpportunity(id: string, f: FormData) {
  const u = await requireUser();
  const due = str(f, "nextActionDue");
  await db
    .update(S.opportunities)
    .set({
      nextAction: str(f, "nextAction"),
      nextActionDue: due ? new Date(due) : null,
      value: Number(str(f, "value")) * 1e5 || 0,
      ownerId: str(f, "ownerId") || null,
      lastActivityAt: new Date(),
    })
    .where(eq(S.opportunities.id, id));
  await log("opportunity", id, `Next action set: ${str(f, "nextAction")}`, u.id);
  await flash("Opportunity updated");
  refresh();
}

export async function addActivity(entityType: string, entityId: string, f: FormData) {
  const u = await requireUser();
  const body = str(f, "body");
  if (!body) return;
  await log(entityType, entityId, body, u.id, (str(f, "kind") || "note") as "note");
  if (entityType === "opportunity") await db.update(S.opportunities).set({ lastActivityAt: new Date() }).where(eq(S.opportunities.id, entityId));
  refresh();
}

export async function createOpportunity(f: FormData) {
  const u = await requireUser();
  const accountId = str(f, "accountId");
  const acc = await db.query.accounts.findFirst({ where: eq(S.accounts.id, accountId) });
  const id = uid();
  const code = await nextCode("O", 1041);
  await db.insert(S.opportunities).values({
    id, code, accountId, title: str(f, "title"), division: str(f, "division"), branch: acc?.branch ?? u.branch,
    value: Number(str(f, "value")) * 1e5 || 0, ownerId: acc?.ownerId ?? u.id, source: "Existing client", stage: "qualified",
    nextAction: "Schedule site survey", nextActionDue: new Date(Date.now() + 2 * DAY), stageChangedAt: new Date(), lastActivityAt: new Date(),
  });
  await log("opportunity", id, "Opportunity created", u.id);
  refresh();
  redirect(`/opportunities/${id}`);
}

/* ───────── clients ───────── */
export async function createAccount(f: FormData) {
  const u = await requireUser();
  const id = `A${Date.now().toString(36).toUpperCase()}`;
  await db.insert(S.accounts).values({ id, name: str(f, "name"), industry: str(f, "industry"), city: str(f, "city"), branch: str(f, "branch") || u.branch, tier: (str(f, "tier") || "New") as "New", gstin: str(f, "gstin") || null, ownerId: u.id });
  if (str(f, "contactName")) await db.insert(S.contacts).values({ id: uid(), accountId: id, name: str(f, "contactName"), role: str(f, "contactRole"), phone: str(f, "contactPhone"), email: str(f, "contactEmail") });
  refresh();
  redirect(`/clients/${id}`);
}
export async function addContact(accountId: string, f: FormData) {
  await requireUser();
  await db.insert(S.contacts).values({ id: uid(), accountId, name: str(f, "name"), role: str(f, "role"), phone: str(f, "phone"), email: str(f, "email") });
  refresh();
}

/* ───────── quotations ───────── */
const TEMPLATES: Record<string, [string, string, number, number][]> = {
  HVAC: [["VRF outdoor unit", "Nos", 1, 1200000], ["Indoor units", "Nos", 10, 95000], ["Refrigerant piping with insulation", "Rmt", 400, 1450], ["Ducting with insulation", "Sqm", 300, 980], ["Testing & commissioning", "Lot", 1, 150000]],
  "Fire & Safety": [["Sprinkler heads, pendent", "Nos", 200, 720], ["MS C-class piping", "Rmt", 800, 980], ["Fire pump set", "Set", 1, 640000], ["Testing & NOC liaison", "Lot", 1, 120000]],
  Electrical: [["LT panel", "Nos", 1, 1150000], ["Distribution boards", "Nos", 10, 48000], ["Wiring points", "Pts", 500, 1350], ["Earthing", "Lot", 1, 250000]],
  Plumbing: [["STP package", "Lot", 1, 1800000], ["CPVC / GI piping", "Rmt", 600, 850], ["Pumps", "Nos", 4, 95000], ["Testing & commissioning", "Lot", 1, 80000]],
};
export async function createQuotation(opportunityId: string) {
  const u = await requireUser();
  const o = await db.query.opportunities.findFirst({ where: eq(S.opportunities.id, opportunityId) });
  if (!o) return;
  const id = uid();
  const code = await nextCode("Q-26", 187);
  await db.insert(S.quotations).values({ id, code, opportunityId, createdBy: u.id, terms: "Prices ex-works, GST extra. Payment: 30% advance, 60% against supply, 10% on commissioning." });
  const tpl = TEMPLATES[o.division] ?? TEMPLATES.HVAC;
  await db.insert(S.quoteItems).values(tpl.map(([description, unit, qty, rate], sort) => ({ id: uid(), quotationId: id, description, unit, qty, rate, sort })));
  await log("opportunity", opportunityId, `Quotation ${code} R0 drafted`, u.id);
  refresh();
  redirect(`/quotations/${id}`);
}

const QuoteSave = z.object({
  discountPct: z.number().min(0).max(40),
  validityDays: z.number().int().min(1).max(180),
  terms: z.string().optional(),
  items: z.array(
    z.object({
      description: z.string().min(1),
      unit: z.string(),
      qty: z.number().min(0),
      rate: z.number().min(0),
      supplyRate: z.number().min(0).nullish(),
      installRate: z.number().min(0).nullish(),
      qro: z.boolean().optional(),
      itemNo: z.string().nullish(),
      section: z.string().nullish(),
      sheet: z.string().nullish(),
      sourceRow: z.number().int().nullish(),
      floorQty: z.record(z.string(), z.number()).nullish(),
      rateSource: z.enum(["manual", "library", "estimated"]).nullish(),
    }),
  ),
});
export async function saveQuotation(id: string, payload: z.infer<typeof QuoteSave>) {
  await requireUser();
  const d = QuoteSave.parse(payload);
  const q = await db.query.quotations.findFirst({ where: eq(S.quotations.id, id) });
  if (!q || !["draft", "approved"].includes(q.status)) return { ok: false, error: "Only draft quotations can be edited. Create a new revision." };
  await db.update(S.quotations).set({ discountPct: d.discountPct, validityDays: d.validityDays, terms: d.terms, status: "draft" }).where(eq(S.quotations.id, id));
  await db.delete(S.quoteItems).where(eq(S.quoteItems.quotationId, id));
  if (d.items.length)
    await db.insert(S.quoteItems).values(
      d.items.map((it, sort) => {
        const split = it.supplyRate != null || it.installRate != null;
        return { id: uid(), quotationId: id, ...it, rate: split ? (it.supplyRate ?? 0) + (it.installRate ?? 0) : it.rate, qro: !!it.qro, sort };
      }),
    );
  const items = await db.select().from(S.quoteItems).where(eq(S.quoteItems.quotationId, id));
  await db.update(S.opportunities).set({ value: quoteTotals(items, d.discountPct, q.gstPct).net }).where(eq(S.opportunities.id, q.opportunityId));
  refresh();
  return { ok: true };
}

export async function saveMakes(id: string, selected: Record<string, string>) {
  await requireUser();
  const q = await db.query.quotations.findFirst({ where: eq(S.quotations.id, id) });
  if (!q?.makes) return;
  await db.update(S.quotations).set({ makes: q.makes.map((m) => ({ ...m, selected: selected[m.item] ?? m.selected })) }).where(eq(S.quotations.id, id));
  await flash("Selected makes saved; they will be filled into the client's BOQ");
  refresh();
}

export async function submitQuotation(id: string) {
  const u = await requireUser();
  await emit("quotation.submitted", { id, userId: u.id });
  const q = await db.query.quotations.findFirst({ where: eq(S.quotations.id, id) });
  await flash(q?.status === "approved" ? "Auto-approved: within your discount limit" : "Sent for approval as per the delegation matrix");
  refresh();
}

export async function sendQuotation(id: string) {
  const u = await requireUser();
  const q = await db.query.quotations.findFirst({ where: eq(S.quotations.id, id) });
  if (!q || q.status !== "approved") return;
  const items = await db.select().from(S.quoteItems).where(eq(S.quoteItems.quotationId, id));
  const t = quoteTotals(items, q.discountPct, q.gstPct);
  await db.update(S.quotations).set({ status: "sent", sentAt: new Date() }).where(eq(S.quotations.id, id));
  await db.update(S.quotations).set({ status: "superseded" }).where(and(eq(S.quotations.opportunityId, q.opportunityId), eq(S.quotations.code, q.code), inArray(S.quotations.status, ["sent"]), eq(S.quotations.revision, q.revision - 1)));
  const o = await db.query.opportunities.findFirst({ where: eq(S.opportunities.id, q.opportunityId) });
  const early = ["qualified", "survey", "boq"].includes(o!.stage);
  await db.update(S.opportunities).set({ value: t.net, lastActivityAt: new Date(), ...(early ? { stage: "quotation" as const, stageChangedAt: new Date() } : {}) }).where(eq(S.opportunities.id, q.opportunityId));
  await log("opportunity", q.opportunityId, `${q.code} R${q.revision} sent to client · ${money(t.net)}`, u.id, "email");
  await emit("quotation.sent", { id, userId: u.id });
  await flash(`${q.code} R${q.revision} sent: follow-ups scheduled automatically`);
  refresh();
}

export async function reviseQuotation(id: string) {
  const u = await requireUser();
  const q = await db.query.quotations.findFirst({ where: eq(S.quotations.id, id) });
  if (!q) return;
  const items = await db.select().from(S.quoteItems).where(eq(S.quoteItems.quotationId, id));
  const nid = uid();
  await db.insert(S.quotations).values({ ...q, id: nid, revision: q.revision + 1, status: "draft", sentAt: null, createdBy: u.id, createdAt: new Date() });
  await db.insert(S.quoteItems).values(items.map((i) => ({ ...i, id: uid(), quotationId: nid })));
  await db.update(S.quotations).set({ status: "superseded" }).where(eq(S.quotations.id, id));
  await log("opportunity", q.opportunityId, `${q.code} revised to R${q.revision + 1}`, u.id);
  refresh();
  redirect(`/quotations/${nid}`);
}

/* ───────── approvals ───────── */
export async function decideApproval(id: string, f: FormData) {
  const u = await requireUser();
  const a = await db.query.approvals.findFirst({ where: eq(S.approvals.id, id) });
  if (!a || a.status !== "pending" || !canApprove(u, a.approverRole, a.branch)) return;
  const ok = str(f, "decision") === "approve";
  await db.update(S.approvals).set({ status: ok ? "approved" : "rejected", decidedBy: u.id, decidedAt: new Date(), comment: str(f, "comment") || null }).where(eq(S.approvals.id, id));
  if (a.entityType === "quotation") {
    await db.update(S.quotations).set({ status: ok ? "approved" : "draft" }).where(eq(S.quotations.id, a.entityId));
    await db.insert(S.notifications).values({ id: uid(), userId: a.requestedBy ?? u.id, title: `${a.title} ${ok ? "approved" : "returned"} by ${u.name}`, body: str(f, "comment") || undefined, link: `/quotations/${a.entityId}`, severity: ok ? "info" : "warn" });
  }
  await flash(ok ? "Approved: requester notified" : "Returned to requester with comments");
  refresh();
}

/* ───────── projects ───────── */
export async function toggleChecklist(projectId: string, idx: number) {
  await requireUser();
  const p = await db.query.projects.findFirst({ where: eq(S.projects.id, projectId) });
  if (!p) return;
  const list = p.checklist.map((c, i) => (i === idx ? { ...c, done: !c.done, doneAt: !c.done ? new Date().toISOString() : undefined } : c));
  const done = list.filter((c) => c.done).length;
  await db.update(S.projects).set({ checklist: list, progress: Math.round((done / list.length) * 100) }).where(eq(S.projects.id, projectId));
  await emit("project.updated", { id: projectId });
  refresh();
}
export async function updateProject(projectId: string, f: FormData) {
  await requireUser();
  const progress = Math.min(100, Math.max(0, Number(str(f, "progress")) || 0));
  await db.update(S.projects).set({ progress, status: progress >= 100 ? "completed" : "execution" }).where(eq(S.projects.id, projectId));
  await flash(progress >= 100 ? "Project completed" : "Progress updated");
  refresh();
}

/* ───────── AMC ───────── */
async function renewAmcInternal(amcId: string, value: number | null, userId: string) {
  const a = await db.query.amcContracts.findFirst({ where: eq(S.amcContracts.id, amcId) });
  if (!a) return;
  const start = a.endDate > new Date() ? a.endDate : new Date();
  await db.update(S.amcContracts).set({ status: "active", startDate: start, endDate: new Date(start.getTime() + 365 * DAY), annualValue: value || a.annualValue }).where(eq(S.amcContracts.id, amcId));
  await log("amc", amcId, `Renewed for 12 months at ${money(value || a.annualValue)}`, userId);
  await runScheduled("ppm_scheduler");
}
export async function renewAmc(amcId: string) {
  const u = await requireUser();
  await renewAmcInternal(amcId, null, u.id);
  await flash("AMC renewed: next year's PPM visits planned");
  refresh();
}
export async function completeVisit(visitId: string, f: FormData) {
  const u = await requireUser();
  const v = await db.query.ppmVisits.findFirst({ where: eq(S.ppmVisits.id, visitId) });
  await db.update(S.ppmVisits).set({ status: "done", completedAt: new Date(), notes: str(f, "notes") || "PPM completed" }).where(eq(S.ppmVisits.id, visitId));
  if (v) await log("amc", v.amcId, `PPM visit completed: ${str(f, "notes") || "checklist done"}`, u.id);
  await flash("Visit marked complete");
  refresh();
}
export async function createAmc(f: FormData) {
  const u = await requireUser();
  const accountId = str(f, "accountId");
  const acc = await db.query.accounts.findFirst({ where: eq(S.accounts.id, accountId) });
  const start = str(f, "startDate") ? new Date(str(f, "startDate")) : new Date();
  const id = uid();
  const code = await nextCode("AMC", 301);
  await db.insert(S.amcContracts).values({
    id, code, accountId, site: str(f, "site"), scope: str(f, "scope"), type: (str(f, "type") || "comprehensive") as "comprehensive",
    annualValue: Number(str(f, "value")) * 1e5 || 0, startDate: start, endDate: new Date(start.getTime() + 365 * DAY),
    visitsPerYear: Number(str(f, "visits")) || 4, branch: acc?.branch ?? u.branch, ownerId: acc?.ownerId ?? u.id,
  });
  await log("amc", id, "AMC contract created", u.id);
  await runScheduled("ppm_scheduler");
  await flash(`${code} created: PPM visits planned automatically`);
  refresh();
  redirect(`/amc/${id}`);
}

/* ───────── service ───────── */
export async function createTicket(f: FormData) {
  const u = await requireUser();
  const accountId = str(f, "accountId");
  const acc = await db.query.accounts.findFirst({ where: eq(S.accounts.id, accountId) });
  const s = await getSettings();
  const priority = (str(f, "priority") || "P2") as "P1" | "P2" | "P3";
  const id = uid();
  const code = await nextCode("T", 5501);
  await db.insert(S.tickets).values({ id, code, accountId, site: str(f, "site") || acc?.city || "", issue: str(f, "issue"), priority, slaHours: s.sla[priority], source: str(f, "source") || "Phone", branch: acc?.branch ?? u.branch });
  await log("ticket", id, `Logged by ${u.name} via ${str(f, "source") || "Phone"}`, u.id);
  await emit("ticket.created", { id, userId: u.id });
  await flash(`${code} created: technician dispatched and client informed`);
  refresh();
  redirect(`/service/${id}`);
}
export async function updateTicket(id: string, f: FormData) {
  const u = await requireUser();
  const tech = str(f, "technicianId");
  const status = str(f, "status") as "open" | "assigned" | "in_progress";
  await db.update(S.tickets).set({ technicianId: tech || null, status: status || (tech ? "assigned" : "open") }).where(eq(S.tickets.id, id));
  await log("ticket", id, `Updated: ${status || "assigned"}`, u.id);
  refresh();
}
export async function resolveTicket(id: string, f: FormData) {
  const u = await requireUser();
  await db.update(S.tickets).set({ status: "resolved", resolvedAt: new Date(), resolution: str(f, "resolution") || "Resolved" }).where(eq(S.tickets.id, id));
  await log("ticket", id, `Resolved: ${str(f, "resolution") || "—"}`, u.id);
  await emit("ticket.resolved", { id, userId: u.id });
  await flash("Resolved: feedback request sent to client");
  refresh();
}

/* ───────── tasks & notifications ───────── */
export async function completeTask(id: string) {
  await requireUser();
  await db.update(S.tasks).set({ status: "done", completedAt: new Date() }).where(eq(S.tasks.id, id));
  refresh();
}
export async function createTask(f: FormData) {
  const u = await requireUser();
  await db.insert(S.tasks).values({ id: uid(), title: str(f, "title"), assignedTo: str(f, "assignedTo") || u.id, dueAt: str(f, "dueAt") ? new Date(str(f, "dueAt")) : new Date(Date.now() + DAY), priority: (str(f, "priority") || "normal") as "normal", source: "manual" });
  refresh();
}
export async function markAllRead() {
  const u = await requireUser();
  await db.update(S.notifications).set({ read: true }).where(eq(S.notifications.userId, u.id));
  refresh();
}
export async function openNotification(id: string, link: string) {
  await requireUser();
  await db.update(S.notifications).set({ read: true }).where(eq(S.notifications.id, id));
  redirect(link || "/notifications");
}

/* ───────── automations & settings ───────── */
export async function toggleRule(key: string) {
  const u = await requireUser();
  if (u.role !== "owner" && u.role !== "branch_head") return;
  const r = await db.query.automationRules.findFirst({ where: eq(S.automationRules.key, key) });
  await db.update(S.automationRules).set({ enabled: !r?.enabled }).where(eq(S.automationRules.key, key));
  await flash(`${r?.name} ${r?.enabled ? "paused" : "enabled"}`);
  refresh();
}
export async function saveRuleConfig(key: string, f: FormData) {
  const u = await requireUser();
  if (u.role !== "owner") return;
  const rule = RULES.find((r) => r.key === key);
  const cfg: Record<string, number> = {};
  for (const k of Object.keys(rule?.defaults ?? {})) cfg[k] = Number(f.get(k)) || rule!.defaults[k];
  await db.update(S.automationRules).set({ config: cfg }).where(eq(S.automationRules.key, key));
  await flash("Rule settings saved");
  refresh();
}
export async function runAutomationsNow() {
  await requireUser();
  const n = await runScheduled();
  await flash(n ? `Automations ran: ${n} actions taken` : "Automations ran: nothing needed attention");
  refresh();
}
export async function saveSettings(f: FormData) {
  const u = await requireUser();
  if (u.role !== "owner") return;
  const n = (k: string) => Number(f.get(k));
  await db
    .insert(S.settings)
    .values({ key: "app", value: { approvalMatrix: { salesMaxDiscount: n("salesMaxDiscount"), branchHeadMaxDiscount: n("branchHeadMaxDiscount"), ownerValueLakhs: n("ownerValueLakhs") }, sla: { P1: n("P1"), P2: n("P2"), P3: n("P3") }, enquiryResponseHours: n("enquiryResponseHours") } })
    .onConflictDoUpdate({ target: S.settings.key, set: { value: { approvalMatrix: { salesMaxDiscount: n("salesMaxDiscount"), branchHeadMaxDiscount: n("branchHeadMaxDiscount"), ownerValueLakhs: n("ownerValueLakhs") }, sla: { P1: n("P1"), P2: n("P2"), P3: n("P3") }, enquiryResponseHours: n("enquiryResponseHours") } } });
  await flash("Delegation matrix & SLA policy saved");
  refresh();
}

/* ───────── product codes & OMC ───────── */
const CODE_ROLES = ["owner", "branch_head", "sales", "estimator", "procurement"];
async function codeUser() {
  const u = await requireUser();
  if (!CODE_ROLES.includes(u.role)) throw new Error("Not allowed");
  return u;
}

export async function generateProductCodes(quotationId: string) {
  await codeUser();
  const r = await PC.generateCodes(quotationId);
  await flash(`Rules coded ${r.coded} of ${r.total} lines (lines already coded by a person or the AI were kept)`);
  refresh();
}

export async function aiReviewCodes(quotationId: string) {
  const u = await codeUser();
  const r = await PC.aiReview(quotationId);
  await log("quotation", quotationId, `AI reviewed ${r.done} product codes`, u.id);
  await flash(r.stopped ? `AI stopped after ${r.done} lines: ${r.stopped}` : `AI coded ${r.done} lines${r.failed ? `, ${r.failed} failed` : ""}${r.remaining ? `, ${r.remaining} still to review - run again` : ""}`);
  refresh();
}

export async function setProductCode(itemId: string, f: FormData) {
  await codeUser();
  try {
    await PC.setCode(itemId, str(f, "code"), str(f, "name"));
    await flash("Code saved");
  } catch (e) {
    await flash((e as Error).message);
  }
  refresh();
}

export async function approveProductCodes(quotationId: string, onlyClean: boolean) {
  const u = await codeUser();
  const r = await PC.approveCodes(quotationId, u.id, onlyClean);
  await log("quotation", quotationId, `${u.name} approved ${r.approved} product codes (${r.added} new in the register)`, u.id);
  await flash(`${r.approved} codes approved, ${r.added} added to the Code Register`);
  refresh();
}
