import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export type ChecklistItem = { item: string; done: boolean; phase?: string; doneAt?: string };
export type BoqSheetMap = { sheet: string; headerRow: number; floors: string[]; cols: Record<string, number> };
export type ApprovedMake = { item: string; makes: string[]; selected?: string; row?: number; col?: number; sheet?: string };

const ts = (name: string) => integer(name, { mode: "timestamp_ms" });
const created = () => ts("created_at").notNull().$defaultFn(() => new Date());

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  role: text("role", {
    enum: ["owner", "branch_head", "sales", "estimator", "projects", "procurement", "service_manager", "technician", "accounts"],
  }).notNull(),
  branch: text("branch").notNull(),
  title: text("title"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  industry: text("industry"),
  city: text("city"),
  branch: text("branch").notNull(),
  tier: text("tier", { enum: ["Key", "Growth", "New"] }).notNull().default("New"),
  kind: text("kind", { enum: ["client", "consultant", "architect"] }).notNull().default("client"),
  sector: text("sector"),
  gstin: text("gstin"),
  phone: text("phone"),
  ownerId: text("owner_id"),
  createdAt: created(),
});

export const contacts = sqliteTable("contacts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  name: text("name").notNull(),
  role: text("role"),
  phone: text("phone"),
  email: text("email"),
});

export const enquiries = sqliteTable("enquiries", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  source: text("source").notNull(),
  company: text("company").notNull(),
  contactName: text("contact_name"),
  phone: text("phone"),
  email: text("email"),
  requirement: text("requirement").notNull(),
  division: text("division").notNull(),
  branch: text("branch").notNull(),
  estValue: real("est_value"),
  status: text("status", { enum: ["new", "contacted", "qualified", "converted", "disqualified"] })
    .notNull()
    .default("new"),
  assignedTo: text("assigned_to"),
  accountId: text("account_id"),
  opportunityId: text("opportunity_id"),
  firstResponseAt: ts("first_response_at"),
  disqualifyReason: text("disqualify_reason"),
  createdAt: created(),
});

export const opportunities = sqliteTable("opportunities", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  accountId: text("account_id").notNull(),
  title: text("title").notNull(),
  division: text("division").notNull(),
  branch: text("branch").notNull(),
  stage: text("stage", {
    enum: ["qualified", "survey", "boq", "quotation", "negotiation", "won", "lost"],
  })
    .notNull()
    .default("qualified"),
  value: real("value").notNull().default(0),
  tonnage: real("tonnage"),
  sector: text("sector"),
  consultantId: text("consultant_id"),
  architectId: text("architect_id"),
  ownerId: text("owner_id"),
  source: text("source"),
  nextAction: text("next_action"),
  nextActionDue: ts("next_action_due"),
  expectedClose: ts("expected_close"),
  lostReason: text("lost_reason"),
  stageChangedAt: ts("stage_changed_at"),
  lastActivityAt: ts("last_activity_at"),
  createdAt: created(),
});

export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  kind: text("kind", { enum: ["note", "call", "meeting", "email", "whatsapp", "system", "automation"] }).notNull(),
  body: text("body").notNull(),
  userId: text("user_id"),
  createdAt: created(),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  assignedTo: text("assigned_to"),
  dueAt: ts("due_at"),
  priority: text("priority", { enum: ["high", "normal", "low"] }).notNull().default("normal"),
  status: text("status", { enum: ["open", "done"] }).notNull().default("open"),
  source: text("source").notNull().default("manual"),
  dedupeKey: text("dedupe_key").unique(),
  completedAt: ts("completed_at"),
  createdAt: created(),
});

export const quotations = sqliteTable("quotations", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  opportunityId: text("opportunity_id").notNull(),
  revision: integer("revision").notNull().default(0),
  status: text("status", {
    enum: ["draft", "pending_approval", "approved", "sent", "accepted", "rejected", "superseded"],
  })
    .notNull()
    .default("draft"),
  discountPct: real("discount_pct").notNull().default(0),
  gstPct: real("gst_pct").notNull().default(18),
  validityDays: integer("validity_days").notNull().default(30),
  terms: text("terms"),
  kind: text("kind", { enum: ["project", "amc_renewal"] }).notNull().default("project"),
  amcId: text("amc_id"),
  source: text("source", { enum: ["manual", "boq_import"] }).notNull().default("manual"),
  docRef: text("doc_ref"),
  dueAt: ts("due_at"),
  fileName: text("file_name"),
  sourceFile: text("source_file"),
  meta: text("meta", { mode: "json" }).$type<Record<string, string>>(),
  sheets: text("sheets", { mode: "json" }).$type<BoqSheetMap[]>(),
  makes: text("makes", { mode: "json" }).$type<ApprovedMake[]>(),
  createdBy: text("created_by"),
  sentAt: ts("sent_at"),
  createdAt: created(),
});

export const quoteItems = sqliteTable("quote_items", {
  id: text("id").primaryKey(),
  quotationId: text("quotation_id").notNull(),
  itemNo: text("item_no"),
  section: text("section"),
  description: text("description").notNull(),
  unit: text("unit").notNull(),
  qty: real("qty").notNull(),
  /** Combined unit rate = supply + installation (kept for simple quotes and totals). */
  rate: real("rate").notNull(),
  supplyRate: real("supply_rate"),
  installRate: real("install_rate"),
  /** "Quote rate only": client wants a rate, quantity to be decided. Excluded from totals. */
  qro: integer("qro", { mode: "boolean" }).notNull().default(false),
  floorQty: text("floor_qty", { mode: "json" }).$type<Record<string, number>>(),
  rateSource: text("rate_source", { enum: ["manual", "library", "estimated"] }),
  sheet: text("sheet"),
  sourceRow: integer("source_row"),
  sort: integer("sort").notNull().default(0),
  /** 16-char SAPL product code used in the OMC; see src/lib/product-codes. */
  productCode: text("product_code"),
  productName: text("product_name"),
  codeSource: text("code_source", { enum: ["rules", "ai", "manual", "register"] }),
  /** Why a human should check this code (weak match, clash, AI question); null when confident. */
  codeFlag: text("code_flag"),
  codeApproved: integer("code_approved", { mode: "boolean" }).notNull().default(false),
  codeInfo: text("code_info", { mode: "json" }).$type<ProductCodeInfo>(),
});

export type ProductCodeInfo = { categoryText: string; hsn: string; abbreviation: string; basis?: string; reasoning?: string; questions?: string[]; confidence?: string };

/** Every product code issued, reused across projects so the same product keeps the same code. */
export const productCodes = sqliteTable("product_codes", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  categoryText: text("category_text").notNull(),
  hsn: text("hsn"),
  unit: text("unit"),
  description: text("description"),
  abbreviation: text("abbreviation"),
  source: text("source").notNull(),
  /** Known problem with this code (e.g. issued for two different sizes); shown wherever it is reused. */
  note: text("note"),
  quotationId: text("quotation_id"),
  createdBy: text("created_by"),
  createdAt: created(),
});

/** Price book learned from every quotation sent; used to auto-price imported BOQs. */
export const rateItems = sqliteTable("rate_items", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  section: text("section"),
  description: text("description").notNull(),
  unit: text("unit").notNull(),
  supplyRate: real("supply_rate").notNull(),
  installRate: real("install_rate").notNull(),
  source: text("source"),
  uses: integer("uses").notNull().default(1),
  updatedAt: ts("updated_at").notNull().$defaultFn(() => new Date()),
});

/** Completed projects the team can quote as references without asking the Founder. */
export const referenceProjects = sqliteTable("reference_projects", {
  id: text("id").primaryKey(),
  client: text("client").notNull(),
  city: text("city").notNull(),
  sector: text("sector").notNull(),
  highlight: text("highlight").notNull(),
  scope: text("scope", { mode: "json" }).$type<Record<string, string>>().notNull(),
  private: integer("private", { mode: "boolean" }).notNull().default(false),
});

export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  title: text("title").notNull(),
  detail: text("detail"),
  requestedBy: text("requested_by"),
  approverRole: text("approver_role").notNull(),
  branch: text("branch"),
  status: text("status", { enum: ["pending", "approved", "rejected", "auto_approved"] })
    .notNull()
    .default("pending"),
  level: integer("level").notNull().default(1),
  decidedBy: text("decided_by"),
  decidedAt: ts("decided_at"),
  comment: text("comment"),
  createdAt: created(),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  opportunityId: text("opportunity_id"),
  accountId: text("account_id").notNull(),
  name: text("name").notNull(),
  branch: text("branch").notNull(),
  value: real("value").notNull(),
  pmId: text("pm_id"),
  status: text("status", { enum: ["handover", "execution", "completed"] }).notNull().default("handover"),
  phase: text("phase", { enum: ["award", "engineering", "procurement", "execution", "commissioning", "handover", "closed"] }).notNull().default("award"),
  progress: integer("progress").notNull().default(0),
  checklist: text("checklist", { mode: "json" }).$type<ChecklistItem[]>().notNull(),
  createdAt: created(),
});

export const amcContracts = sqliteTable("amc_contracts", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  accountId: text("account_id").notNull(),
  site: text("site").notNull(),
  scope: text("scope").notNull(),
  type: text("type", { enum: ["comprehensive", "non_comprehensive"] }).notNull(),
  annualValue: real("annual_value").notNull(),
  startDate: ts("start_date").notNull(),
  endDate: ts("end_date").notNull(),
  visitsPerYear: integer("visits_per_year").notNull().default(4),
  status: text("status", { enum: ["active", "renewal_sent", "renewed", "lapsed"] }).notNull().default("active"),
  branch: text("branch").notNull(),
  ownerId: text("owner_id"),
  createdAt: created(),
});

export const ppmVisits = sqliteTable("ppm_visits", {
  id: text("id").primaryKey(),
  amcId: text("amc_id").notNull(),
  scheduledFor: ts("scheduled_for").notNull(),
  technicianId: text("technician_id"),
  status: text("status", { enum: ["scheduled", "done", "missed"] }).notNull().default("scheduled"),
  completedAt: ts("completed_at"),
  notes: text("notes"),
});

export const tickets = sqliteTable("tickets", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  accountId: text("account_id").notNull(),
  amcId: text("amc_id"),
  site: text("site").notNull(),
  issue: text("issue").notNull(),
  priority: text("priority", { enum: ["P1", "P2", "P3"] }).notNull(),
  slaHours: integer("sla_hours").notNull(),
  source: text("source").notNull().default("Phone"),
  status: text("status", { enum: ["open", "assigned", "in_progress", "resolved"] }).notNull().default("open"),
  technicianId: text("technician_id"),
  branch: text("branch").notNull(),
  chargeable: integer("chargeable", { mode: "boolean" }).notNull().default(false),
  escalationLevel: integer("escalation_level").notNull().default(0),
  resolution: text("resolution"),
  resolvedAt: ts("resolved_at"),
  createdAt: created(),
});

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  link: text("link"),
  severity: text("severity", { enum: ["info", "warn", "crit"] }).notNull().default("info"),
  read: integer("read", { mode: "boolean" }).notNull().default(false),
  dedupeKey: text("dedupe_key").unique(),
  createdAt: created(),
});

export const outbox = sqliteTable("outbox", {
  id: text("id").primaryKey(),
  channel: text("channel", { enum: ["email", "whatsapp", "sms"] }).notNull(),
  to: text("to").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  status: text("status", { enum: ["queued", "sent", "failed"] }).notNull().default("sent"),
  relatedType: text("related_type"),
  relatedId: text("related_id"),
  dedupeKey: text("dedupe_key").unique(),
  createdAt: created(),
});

export const automationRules = sqliteTable("automation_rules", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  trigger: text("trigger").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  config: text("config", { mode: "json" }).$type<Record<string, number>>().notNull(),
  runCount: integer("run_count").notNull().default(0),
  actionCount: integer("action_count").notNull().default(0),
  lastRunAt: ts("last_run_at"),
});

export const automationRuns = sqliteTable("automation_runs", {
  id: text("id").primaryKey(),
  ruleKey: text("rule_key").notNull(),
  summary: text("summary").notNull(),
  actions: integer("actions").notNull().default(0),
  createdAt: created(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
});

export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Enquiry = typeof enquiries.$inferSelect;
export type Opportunity = typeof opportunities.$inferSelect;
export type Quotation = typeof quotations.$inferSelect;
export type QuoteItem = typeof quoteItems.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type Amc = typeof amcContracts.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Role = User["role"];
export type RateItem = typeof rateItems.$inferSelect;
export type ReferenceProject = typeof referenceProjects.$inferSelect;
export type ProductCode = typeof productCodes.$inferSelect;
