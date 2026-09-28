export const BRANCHES = ["Chennai", "Bangalore", "Hyderabad", "Renigunta", "Colombo"] as const;

export const DIVISIONS = {
  HVAC: "var(--c-hvac)",
  "Fire & Safety": "var(--c-fire)",
  Electrical: "var(--c-elec)",
  Plumbing: "var(--c-plumb)",
  "Turnkey MEP": "var(--c-mep)",
  "ELV & Security": "var(--c-elv)",
  Interiors: "var(--c-int)",
  "AMC / Service": "var(--c-amc)",
} as const;
export type Division = keyof typeof DIVISIONS;

export const STAGES = [
  { key: "qualified", label: "Qualified", prob: 15 },
  { key: "survey", label: "Site survey", prob: 25 },
  { key: "boq", label: "BOQ & design", prob: 40 },
  { key: "quotation", label: "Quotation sent", prob: 50 },
  { key: "negotiation", label: "Negotiation", prob: 70 },
  { key: "won", label: "PO received", prob: 100 },
  { key: "lost", label: "Lost", prob: 0 },
] as const;
export type StageKey = (typeof STAGES)[number]["key"];
export const OPEN_STAGES: StageKey[] = ["qualified", "survey", "boq", "quotation", "negotiation"];
export const stageLabel = (k: string) => STAGES.find((s) => s.key === k)?.label ?? k;
export const stageProb = (k: string) => STAGES.find((s) => s.key === k)?.prob ?? 0;

export const ROLE_LABELS: Record<string, string> = {
  owner: "Founder / MD",
  branch_head: "Branch Head",
  sales: "Sales Engineer",
  estimator: "Estimation Engineer",
  projects: "Projects / Planning",
  procurement: "Procurement",
  service_manager: "Service Manager",
  technician: "Technician",
  accounts: "Accounts",
};

export const ENQUIRY_SOURCES = [
  "Website form",
  "Phone",
  "WhatsApp",
  "Email",
  "Tender portal",
  "LG dealer lead",
  "Architect / PMC",
  "Referral",
  "Existing client",
] as const;

export const LOST_REASONS = ["Price", "Technical", "Timeline", "Relationship", "Project dropped", "Other"];

export const DEFAULT_SETTINGS = {
  approvalMatrix: { salesMaxDiscount: 3, branchHeadMaxDiscount: 8, ownerValueLakhs: 500 },
  sla: { P1: 4, P2: 24, P3: 72 },
  enquiryResponseHours: 4,
};
export type AppSettings = typeof DEFAULT_SETTINGS;

export const SECTORS = ["Commercial", "Industrial", "Hospital", "Institution", "Hotel", "Data centre", "Retail", "Residential"] as const;

/** Delivery workflow (Client award → Engineering & approvals → Procurement → Execution → QA/QC & commissioning → Handover). */
export const PROJECT_PHASES = [
  { key: "award", label: "Client award", owner: "projects", items: ["PO / LOI received and filed", "Project plan & execution schedule", "Kick-off meeting with client & consultant", "Advance invoice raised"] },
  { key: "engineering", label: "Engineering & approvals", owner: "projects", items: ["Technical submittals approved", "Material approvals (approved makes)", "Shop drawings approved"] },
  { key: "procurement", label: "Procurement", owner: "procurement", items: ["Supplier evaluation & comparison", "PO / WO released to vendors", "Material received & inspected at site"] },
  { key: "execution", label: "Site execution", owner: "projects", items: ["Work permits & safety induction", "Site execution as per approved drawings", "Progress billing (RA bills) submitted"] },
  { key: "commissioning", label: "QA/QC & commissioning", owner: "projects", items: ["QA/QC inspections", "Snag list rectified", "Pre-commissioning checks", "Testing, TAB & system commissioning"] },
  { key: "handover", label: "Handover", owner: "projects", items: ["As-built drawings & O&M manuals", "Client training", "Handover certificate signed", "Warranty & AMC proposal shared"] },
] as const;
export type PhaseKey = (typeof PROJECT_PHASES)[number]["key"] | "closed";
export const phaseLabel = (k: string) => PROJECT_PHASES.find((p) => p.key === k)?.label ?? (k === "closed" ? "Closed" : k);
export const projectChecklist = (doneUpTo = -1) =>
  PROJECT_PHASES.flatMap((p, pi) => p.items.map((item) => ({ item, phase: p.key as string, done: pi < doneUpTo })));
