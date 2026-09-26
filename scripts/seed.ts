/* Seeds the local database with sample data, then runs the automation engine over it. */
import { db, schema as S } from "../src/db";
import { ensureRules, emit, runScheduled } from "../src/lib/automation/engine";

const NOW = Date.now();
const H = 36e5, D = 864e5;
const hAgo = (h: number) => new Date(NOW - h * H);
const dFrom = (d: number) => new Date(NOW + d * D);
const L = (lakhs: number) => lakhs * 1e5;
const id = () => crypto.randomUUID();

async function wipe() {
  for (const t of [S.automationRuns, S.automationRules, S.outbox, S.notifications, S.tickets, S.ppmVisits, S.amcContracts, S.projects, S.approvals, S.quoteItems, S.quotations, S.tasks, S.activities, S.opportunities, S.enquiries, S.contacts, S.accounts, S.users, S.settings])
    await db.delete(t);
}

const users = [
  ["u-owner", "Founder", "owner", "Chennai", "Founder & Managing Director"],
  ["u-bh-che", "Ramesh Kumar", "branch_head", "Chennai", "Branch Head – Chennai"],
  ["u-bh-blr", "Suresh Hegde", "branch_head", "Bangalore", "Branch Head – Karnataka"],
  ["u-bh-hyd", "Srinivas Rao", "branch_head", "Hyderabad", "Branch Head – Telangana"],
  ["u-bh-ren", "Venkata Naidu", "branch_head", "Renigunta", "Branch Head – Andhra Pradesh"],
  ["u-bh-col", "Nuwan Perera", "branch_head", "Colombo", "Country Head – Sri Lanka"],
  ["u-karthik", "Karthik R", "sales", "Chennai", "Sales Engineer – HVAC"],
  ["u-deepa", "Deepa N", "sales", "Chennai", "Sales Engineer – Fire & PHE"],
  ["u-priya", "Priya S", "sales", "Bangalore", "Sales Engineer"],
  ["u-rohan", "Rohan D", "sales", "Bangalore", "Sales Engineer"],
  ["u-arjun", "Arjun M", "sales", "Hyderabad", "Sales Engineer"],
  ["u-ravi", "Ravi Teja", "sales", "Renigunta", "Sales Engineer"],
  ["u-anitha", "Anitha V", "estimator", "Chennai", "Estimation & Design Lead"],
  ["u-prakash", "Prakash M", "service_manager", "Chennai", "Service Manager – South"],
  ["u-kiran", "Kiran B", "service_manager", "Bangalore", "Service Manager – Karnataka"],
  ["u-manoj", "Manoj K", "technician", "Chennai", "HVAC Technician"],
  ["u-sureshv", "Suresh V", "technician", "Chennai", "Chiller Technician"],
  ["u-imran", "Imran A", "technician", "Bangalore", "HVAC Technician"],
  ["u-venkat", "Venkat R", "technician", "Renigunta", "Fire Systems Technician"],
  ["u-mahesh", "Mahesh T", "technician", "Hyderabad", "HVAC Technician"],
  ["u-dinesh", "Dinesh S", "technician", "Colombo", "Chiller Technician"],
  ["u-lakshmi", "Lakshmi P", "accounts", "Chennai", "Accounts & Billing"],
] as const;

const accounts = [
  ["A01", "Amazon Development Centre", "IT campus", "Chennai", "Chennai", "Key", "u-karthik"],
  ["A02", "Reliance Retail", "Retail chain", "Bangalore", "Bangalore", "Key", "u-priya"],
  ["A03", "Zoho Corporation", "IT campus", "Renigunta", "Renigunta", "Key", "u-ravi"],
  ["A04", "Cognizant", "IT services", "Chennai", "Chennai", "Key", "u-karthik"],
  ["A05", "KIA India", "Automotive plant", "Anantapur", "Renigunta", "Key", "u-ravi"],
  ["A06", "Pfizer", "Pharma", "Chennai", "Chennai", "Growth", "u-deepa"],
  ["A07", "ThoughtWorks", "IT services", "Hyderabad", "Hyderabad", "Growth", "u-arjun"],
  ["A08", "RMZ Corp", "Commercial real estate", "Bangalore", "Bangalore", "Key", "u-priya"],
  ["A09", "Uber", "Office / co-working", "Hyderabad", "Hyderabad", "Growth", "u-arjun"],
  ["A10", "Wistron", "Electronics manufacturing", "Kolar", "Bangalore", "Growth", "u-rohan"],
  ["A11", "Viasat", "R&D centre", "Chennai", "Chennai", "Growth", "u-deepa"],
  ["A12", "Shriram Properties", "Residential developer", "Chennai", "Chennai", "Growth", "u-deepa"],
  ["A13", "Harbour Tech Park (sample)", "Commercial real estate", "Colombo", "Colombo", "New", "u-bh-col"],
  ["A14", "Olympia Tech Park", "Commercial real estate", "Chennai", "Chennai", "Growth", "u-karthik"],
] as const;

const contacts: Record<string, [string, string][]> = {
  A01: [["S. Venkatesh", "Facility Manager"], ["Meera Iyer", "Procurement Lead"], ["R. Balaji", "MEP Consultant (PMC)"]],
  A02: [["Anand Kulkarni", "Projects Head – South"], ["Kavya Rao", "Procurement"]],
  A03: [["P. Sridhar", "Admin & Facilities"], ["Lakshmi N", "Finance"]],
  A04: [["Joseph Mathew", "Data Centre Ops"], ["Hari Prasad", "Facility Manager"]],
  A05: [["Kim Joon-ho", "Plant Engineering"], ["G. Reddy", "Purchase"]],
  A06: [["Dr. Nisha Menon", "QA / Validation"], ["Arun Kumar", "Engineering"]],
  A07: [["Sneha Rao", "Workplace Lead"]],
  A08: [["Vikram Shetty", "Project Director"], ["Asha Pai", "Contracts"]],
  A09: [["Rahul Varma", "Workplace Ops"]],
  A10: [["Chen Wei", "Facilities"], ["Manjunath B", "Purchase"]],
  A11: [["Karthik Subramanian", "Site Admin"]],
  A12: [["V. Ramesh", "Project Manager"]],
  A13: [["Nimal Perera", "Chief Engineer"]],
  A14: [["S. Ganesh", "Estate Manager"]],
};

// code, acc, title, division, branch, stage, lakhs, owner, source, next action, due (days), last activity (days ago), TR
const opps = [
  ["O-1041", "A01", "VRF retrofit – Tower B (220 TR)", "HVAC", "Chennai", "negotiation", 358, "u-karthik", "Existing client", "Send revised commercials after L1 comparison", 1, 2, 220],
  ["O-1042", "A02", "Fire fighting – 6 Smart stores", "Fire & Safety", "Bangalore", "quotation", 96, "u-priya", "Existing client", "Follow up with procurement on R1", -2, 4, null],
  ["O-1043", "A03", "New office block – HVAC, electrical & plumbing", "Turnkey MEP", "Renigunta", "boq", 1240, "u-ravi", "Architect / PMC", "Submit BOQ to PMC", 4, 1, 480],
  ["O-1044", "A04", "Data centre precision cooling upgrade", "HVAC", "Chennai", "survey", 210, "u-karthik", "Existing client", "Site survey with DC ops team", 2, 3, 120],
  ["O-1045", "A05", "Paint shop ventilation & exhaust", "HVAC", "Renigunta", "won", 560, "u-ravi", "Tender", "Kick-off & handover to Projects", 3, 5, null],
  ["O-1046", "A06", "Clean room HVAC – ISO 8 suite", "HVAC", "Chennai", "quotation", 318, "u-deepa", "Referral", "Answer technical clarifications", -1, 6, 240],
  ["O-1047", "A07", "Office fit-out – electrical", "Electrical", "Hyderabad", "negotiation", 74, "u-arjun", "Website form", "Final price call", 0, 1, null],
  ["O-1048", "A08", "Sprinkler & hydrant – Tower 3", "Fire & Safety", "Bangalore", "boq", 188, "u-priya", "Existing client", "Hydraulic calculation sign-off", 6, 2, null],
  ["O-1049", "A09", "Co-working floor – HVAC + plumbing", "Turnkey MEP", "Hyderabad", "qualified", 65, "u-arjun", "Website form", "Schedule site survey", 1, 1, 60],
  ["O-1050", "A10", "Process cooling – SMT line", "HVAC", "Bangalore", "survey", 142, "u-rohan", "LG dealer lead", "Heat load study", 5, 18, 150],
  ["O-1051", "A11", "STP 60 KLD & RO plant", "Plumbing", "Chennai", "qualified", 38, "u-deepa", "Phone", "Confirm capacity (KLD) with client", -4, 16, null],
  ["O-1052", "A12", "Residential tower plumbing & RWH", "Plumbing", "Chennai", "lost", 92, "u-deepa", "Tender", "—", -20, 20, null],
  ["O-1053", "A13", "Chiller plant 2 × 350 TR", "HVAC", "Colombo", "quotation", 610, "u-bh-col", "Email", "Share LKR quotation", 3, 2, 700],
  ["O-1054", "A14", "VRF retrofit + AMC conversion", "HVAC", "Chennai", "won", 48, "u-karthik", "AMC upsell", "Raise AMC contract", 2, 9, 60],
  ["O-1055", "A01", "Fire alarm upgrade – Hyderabad site", "Fire & Safety", "Hyderabad", "qualified", 56, "u-arjun", "Existing client", "Get existing panel details", 2, 3, null],
  ["O-1056", "A02", "HVAC for 4 new Trends stores", "HVAC", "Bangalore", "negotiation", 132, "u-priya", "Existing client", "PO expected this week", 1, 1, 96],
] as const;

const quotes: { code: string; opp: string; rev: number; status: "sent" | "draft" | "approved" | "pending_approval"; sentDaysAgo: number | null; disc: number; items: [string, string, number, number][] }[] = [
  { code: "Q-26-187", opp: "O-1041", rev: 2, status: "sent", sentDaysAgo: 6, disc: 0, items: [
    ["VRF outdoor unit, LG Multi V i, 24 HP", "Nos", 9, 1640000], ["Ducted indoor unit, 3 TR, ceiling concealed", "Nos", 48, 118000],
    ["4-way cassette indoor unit, 2 TR", "Nos", 36, 82000], ["Copper refrigerant piping with nitrile insulation", "Rmt", 3800, 1450],
    ["GI ducting 24/22 G with insulation", "Sqm", 4200, 980], ["Supply & return grilles / diffusers", "Nos", 620, 2150],
    ["Central controller & BMS integration", "Lot", 1, 680000], ["Dismantling & disposal of existing units", "Lot", 1, 420000],
    ["Testing, commissioning & air balancing", "Lot", 1, 350000]] },
  { code: "Q-26-191", opp: "O-1046", rev: 0, status: "sent", sentDaysAgo: 9, disc: 0, items: [
    ["AHU, double-skin, 12,000 CFM with HEPA terminal", "Nos", 4, 2650000], ["Air-cooled scroll chiller, 120 TR", "Nos", 2, 4800000],
    ["Pre-insulated chilled water piping", "Rmt", 640, 6200], ["Clean room ducting, SS 304 at critical zones", "Sqm", 1600, 2900],
    ["HEPA filter boxes with DOP port", "Nos", 86, 38500], ["Validation – DQ, IQ, OQ, particle count", "Lot", 1, 850000]] },
  { code: "Q-26-193", opp: "O-1042", rev: 1, status: "pending_approval", sentDaysAgo: null, disc: 6, items: [
    ["Sprinkler heads, pendent, 68°C", "Nos", 1450, 720], ["MS C-class piping, 25–150 mm, painted", "Rmt", 5200, 980],
    ["Fire pump set – main, jockey & diesel", "Set", 6, 640000], ["Hydrant valves, hose reels & cabinets", "Nos", 48, 42000],
    ["Addressable fire alarm panel & devices", "Lot", 6, 360000], ["Testing & fire NOC liaison", "Lot", 6, 120000]] },
  { code: "Q-26-195", opp: "O-1053", rev: 0, status: "pending_approval", sentDaysAgo: null, disc: 2, items: [
    ["Water-cooled screw chiller, 350 TR", "Nos", 2, 14800000], ["Cooling tower, 450 TR, FRP", "Nos", 2, 3200000],
    ["Primary & secondary pumps with VFD", "Nos", 6, 720000], ["Chilled & condenser water piping, insulated", "Rmt", 2400, 7800],
    ["Plant room BMS & electricals", "Lot", 1, 4600000]] },
  { code: "Q-26-180", opp: "O-1047", rev: 3, status: "sent", sentDaysAgo: 3, disc: 2, items: [
    ["LT panel with ACBs", "Nos", 2, 1150000], ["Distribution boards & MCBs", "Nos", 34, 48000],
    ["Wiring – points (light, power, data)", "Pts", 2600, 1350], ["Cable tray & raceways", "Rmt", 1800, 820],
    ["LED fixtures supply & fix", "Nos", 980, 1650], ["Earthing & lightning protection", "Lot", 1, 380000]] },
  { code: "Q-26-182", opp: "O-1056", rev: 1, status: "sent", sentDaysAgo: 5, disc: 3, items: [
    ["Ductable split units, 11 TR", "Nos", 8, 610000], ["Ducting & insulation", "Sqm", 2400, 1050],
    ["Copper piping & drain", "Rmt", 900, 1500], ["Installation, testing & commissioning", "Lot", 4, 180000]] },
];

async function main() {
  await wipe();
  await ensureRules();
  await db.insert(S.users).values(
    users.map(([uid, name, role, branch, title]) => ({
      id: uid, name, role, branch, title,
      email: `${name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/\.$/, "")}@spaceair.in`,
      phone: `+91 9${String(Math.abs([...uid].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % 1e9).padStart(9, "0")}`,
    })),
  );
  await db.insert(S.accounts).values(accounts.map(([aid, name, ind, city, branch, tier, owner], i) => ({ id: aid, name, industry: ind, city, branch, tier, ownerId: owner, createdAt: new Date(NOW - (400 - i * 20) * D) })));
  let ci = 0;
  for (const [aid, list] of Object.entries(contacts))
    for (const [name, role] of list)
      await db.insert(S.contacts).values({ id: id(), accountId: aid, name, role, phone: `+91 98${String(40012000 + ++ci * 1373).slice(0, 3)} ${String(40012000 + ci * 1373).slice(3, 8)}`, email: `${name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "")}@client.example` });

  const oppIds: Record<string, string> = {};
  for (const [code, acc, title, div, branch, stage, lakhs, owner, src, next, due, act, tr] of opps) {
    const oid = id();
    oppIds[code] = oid;
    await db.insert(S.opportunities).values({
      id: oid, code, accountId: acc, title, division: div, branch, stage, value: L(lakhs), ownerId: owner, source: src,
      nextAction: next, nextActionDue: dFrom(due), lastActivityAt: dFrom(-act), stageChangedAt: dFrom(-act - 3),
      expectedClose: dFrom(30 + due), tonnage: tr, lostReason: stage === "lost" ? "Price – L2 by 6%" : null, createdAt: dFrom(-60 - act),
    });
    await db.insert(S.activities).values([
      { id: id(), entityType: "opportunity", entityId: oid, kind: "system", body: `Created from enquiry (${src})`, userId: owner, createdAt: dFrom(-60 - act) },
      { id: id(), entityType: "opportunity", entityId: oid, kind: "meeting", body: "Requirement discussion with facility team; drawings requested", userId: owner, createdAt: dFrom(-40 - act) },
      { id: id(), entityType: "opportunity", entityId: oid, kind: "call", body: next === "—" ? "Client informed us the order went to another bidder" : `Discussed: ${next.toLowerCase()}`, userId: owner, createdAt: dFrom(-act) },
    ]);
  }

  for (const q of quotes) {
    const qid = id();
    await db.insert(S.quotations).values({ id: qid, code: q.code, opportunityId: oppIds[q.opp], revision: q.rev, status: q.status, discountPct: q.disc, sentAt: q.sentDaysAgo != null ? dFrom(-q.sentDaysAgo) : null, createdBy: opps.find((o) => o[0] === q.opp)![7], createdAt: dFrom(-(q.sentDaysAgo ?? 1) - 1), terms: "Prices ex-works, GST extra. Payment: 30% advance, 60% against supply, 10% on commissioning." });
    await db.insert(S.quoteItems).values(q.items.map(([d, u, qty, rate], i) => ({ id: id(), quotationId: qid, description: d, unit: u, qty, rate, sort: i })));
    // Earlier revisions (superseded), each a little dearer, so the history reads like a real negotiation.
    for (let r = 0; r < q.rev; r++) {
      const rid = id();
      const bump = 1 + (q.rev - r) * 0.035;
      await db.insert(S.quotations).values({ id: rid, code: q.code, opportunityId: oppIds[q.opp], revision: r, status: "superseded", discountPct: 0, sentAt: dFrom(-(q.sentDaysAgo ?? 1) - (q.rev - r) * 9), createdBy: opps.find((o) => o[0] === q.opp)![7], createdAt: dFrom(-(q.sentDaysAgo ?? 1) - (q.rev - r) * 9 - 1), terms: "Prices ex-works, GST extra." });
      await db.insert(S.quoteItems).values(q.items.map(([d, u, qty, rate], i) => ({ id: id(), quotationId: rid, description: d, unit: u, qty, rate: Math.round(rate * bump), sort: i })));
    }
    if (q.status === "sent")
      await db.insert(S.approvals).values({ id: id(), entityType: "quotation", entityId: qid, title: `${q.code} R${q.rev}`, detail: `discount ${q.disc}%`, requestedBy: opps.find((o) => o[0] === q.opp)![7], approverRole: q.disc <= 3 ? "sales" : "branch_head", status: q.disc <= 3 ? "auto_approved" : "approved", decidedAt: dFrom(-(q.sentDaysAgo ?? 1)), comment: q.disc <= 3 ? "Within sales limit of 3%" : null, createdAt: dFrom(-(q.sentDaysAgo ?? 1) - 0.1) });
    if (q.status === "pending_approval") {
      const owner = q.code === "Q-26-195";
      await db.insert(S.approvals).values({ id: id(), entityType: "quotation", entityId: qid, title: `${q.code} R${q.rev} · ${accounts.find((a) => a[0] === opps.find((o) => o[0] === q.opp)![1])![1]}`, detail: owner ? "Net ₹6.21 Cr · discount 2% · deal value ≥ ₹5.00 Cr" : "Net ₹1.02 Cr · discount 6% · discount > 3%", requestedBy: opps.find((o) => o[0] === q.opp)![7], approverRole: owner ? "owner" : "branch_head", branch: owner ? "Colombo" : "Bangalore", createdAt: hAgo(owner ? 5 : 14) });
    }
  }
  // Decision history for the "decisions handled without the Founder" KPI.
  const hist: ["auto_approved" | "approved", string, string][] = [
    ["auto_approved", "sales", "u-karthik"], ["auto_approved", "sales", "u-priya"], ["auto_approved", "sales", "u-arjun"], ["auto_approved", "sales", "u-ravi"],
    ["auto_approved", "sales", "u-deepa"], ["auto_approved", "sales", "u-rohan"], ["auto_approved", "sales", "u-karthik"], ["approved", "branch_head", "u-bh-che"],
    ["approved", "branch_head", "u-bh-blr"], ["approved", "branch_head", "u-bh-ren"], ["approved", "branch_head", "u-bh-hyd"], ["approved", "owner", "u-owner"],
  ];
  for (const [i, [st, role, by]] of hist.entries())
    await db.insert(S.approvals).values({ id: id(), entityType: "quotation", entityId: "history", title: `Earlier quotation Q-26-${150 + i * 2}`, detail: role === "owner" ? "Deal value ≥ ₹5 Cr" : role === "branch_head" ? "Discount 5%" : "Discount 2%", requestedBy: by, approverRole: role, status: st, decidedBy: st === "approved" ? by : null, decidedAt: dFrom(-(i + 3) * 2), createdAt: dFrom(-(i + 3) * 2 - 0.3) });

  // Enquiries: older ones already worked; the newest two arrive "now" and go through automation.
  const enq = [
    ["E-2302", 26, "Phone", "Lotus Warehousing (sample)", "Mahesh", "Sprinkler system for fire NOC compliance – 1.2 lakh sq ft", "Fire & Safety", "Bangalore", "contacted", "u-rohan", 30],
    ["E-2303", 30, "LG dealer lead", "Metro Mall Hyderabad (sample)", "Farhan", "VRF 180 HP for mall expansion", "HVAC", "Hyderabad", "new", "u-arjun", 85],
    ["E-2304", 72, "Tender portal", "State hostel project (sample)", "—", "Internal electrification, tender due in 14 days", "Electrical", "Renigunta", "qualified", "u-ravi", 140],
    ["E-2305", 96, "Architect / PMC", "Greenfield IT park (sample)", "Ar. Nandini", "4 lakh sq ft – full MEP package", "Turnkey MEP", "Chennai", "contacted", "u-karthik", 2200],
    ["E-2306", 7, "Website form", "Brew & Bake Cafés (sample)", "Kiran", "Kitchen exhaust & fresh air – 5 outlets", "HVAC", "Bangalore", "new", "u-priya", 18],
    ["E-2307", 50, "Email", "Galle Face Hotel (sample)", "Ruwan", "Chiller AMC – 3 × 250 TR", "AMC / Service", "Colombo", "contacted", "u-bh-col", 25],
    ["E-2301", 200, "Website form", "Sri Kaveri Hospitals (sample)", "Dr. Suresh", "AMC for 40 splits + 2 VRF systems", "AMC / Service", "Chennai", "converted", "u-deepa", 12],
  ] as const;
  for (const [code, h, src, co, person, req, div, branch, status, who, lakhs] of enq)
    await db.insert(S.enquiries).values({ id: id(), code, source: src, company: co, contactName: person, phone: "+91 98400 1" + code.slice(2), email: `${person.toLowerCase().replace(/[^a-z]+/g, "")}@client.example`, requirement: req, division: div, branch, status, assignedTo: who, estValue: L(lakhs), firstResponseAt: status === "new" ? null : hAgo(h - 2), createdAt: hAgo(h) });

  // AMC contracts: [code, acc, site, scope, type, lakhs/yr, daysToEnd, branch, owner, visitsDone]
  const amcs = [
    ["AMC-301", "A01", "Tower A, Chennai", "VRF 320 HP (LG Multi V)", "comprehensive", 18.4, 42, "Chennai", "u-karthik", 3],
    ["AMC-302", "A04", "Siruseri campus", "Chillers 2 × 400 TR + 18 AHUs", "non_comprehensive", 26, 210, "Chennai", "u-karthik", 1],
    ["AMC-303", "A02", "38 stores, Karnataka", "Splits & cassettes", "comprehensive", 12.6, 18, "Bangalore", "u-priya", 4],
    ["AMC-304", "A03", "Renigunta campus", "Fire hydrant, sprinkler & pumps", "non_comprehensive", 6.8, 300, "Renigunta", "u-ravi", 0],
    ["AMC-305", "A08", "Tower 1, Bangalore", "HVAC + fire fighting", "non_comprehensive", 22.5, -5, "Bangalore", "u-priya", 4],
    ["AMC-306", "A06", "Chennai plant", "Clean room AHUs & HEPA validation", "comprehensive", 9.2, 95, "Chennai", "u-deepa", 2],
    ["AMC-307", "A14", "Olympia Tech Park", "VRF 180 HP", "comprehensive", 8.8, 365, "Chennai", "u-karthik", -1],
    ["AMC-308", "A13", "Colombo", "Chiller plant & cooling towers", "non_comprehensive", 14, 150, "Colombo", "u-bh-col", 2],
  ] as const;
  const amcIds: Record<string, string> = {};
  const techFor: Record<string, string> = { Chennai: "u-manoj", Bangalore: "u-imran", Renigunta: "u-venkat", Hyderabad: "u-mahesh", Colombo: "u-dinesh" };
  for (const [code, acc, site, scope, type, lakhs, toEnd, branch, owner, done] of amcs as readonly (readonly [string, string, string, string, "comprehensive" | "non_comprehensive", number, number, string, string, number])[]) {
    const aid = id();
    amcIds[code] = aid;
    const end = dFrom(toEnd), start = new Date(end.getTime() - 365 * D);
    await db.insert(S.amcContracts).values({ id: aid, code, accountId: acc, site, scope, type, annualValue: L(lakhs), startDate: start, endDate: end, visitsPerYear: 4, branch, ownerId: owner, createdAt: start });
    if (done < 0) continue; // left for the PPM planner automation to schedule
    for (let i = 0; i < 4; i++) {
      const at = new Date(start.getTime() + (i + 0.5) * (365 / 4) * D);
      const missed = code === "AMC-302" && i === 1;
      const status = !missed && at.getTime() < NOW ? "done" : "scheduled";
      await db.insert(S.ppmVisits).values({ id: id(), amcId: aid, scheduledFor: missed ? dFrom(-3) : at, technicianId: techFor[branch], status, completedAt: status === "done" ? at : null, notes: status === "done" ? "PPM completed; report shared with client" : null });
    }
    await db.insert(S.settings).values({ key: `mark:ppm-plan-${aid}-${start.getTime()}`, value: 1 });
  }

  // Service tickets
  const tks = [
    ["T-5501", "A01", "Tower A, Chennai", "ODU error E-21 – floors 4–6 not cooling", "P1", 4, 3, "in_progress", "u-manoj", "AMC-301", "Chennai"],
    ["T-5502", "A04", "Siruseri campus", "Chiller 2 tripping on high head pressure", "P1", 4, 9, "assigned", "u-sureshv", "AMC-302", "Chennai"],
    ["T-5504", "A06", "Chennai plant", "AHU-3 filter DP high – change pre-filters", "P2", 24, 20, "in_progress", "u-sureshv", "AMC-306", "Chennai"],
    ["T-5505", "A03", "Renigunta campus", "Jockey pump auto-start not working", "P2", 24, 2, "assigned", "u-venkat", "AMC-304", "Renigunta"],
    ["T-5506", "A14", "Olympia Tech Park", "VRF indoor unit noise – level 3", "P3", 72, 30, "assigned", "u-manoj", "AMC-307", "Chennai"],
    ["T-5507", "A08", "Tower 1, Bangalore", "Fire alarm panel fault", "P2", 24, 26, "open", null, null, "Bangalore"],
    ["T-5508", "A13", "Colombo", "Condenser water pump noise", "P3", 72, 40, "resolved", "u-dinesh", "AMC-308", "Colombo"],
  ] as const;
  for (const [code, acc, site, issue, pri, sla, h, status, tech, amc, branch] of tks)
    await db.insert(S.tickets).values({ id: id(), code, accountId: acc, site, issue, priority: pri, slaHours: sla, status, technicianId: tech, amcId: amc ? amcIds[amc] : null, branch, chargeable: code === "T-5507", createdAt: hAgo(h), resolvedAt: status === "resolved" ? hAgo(h - 20) : null, resolution: status === "resolved" ? "Pump bearing replaced; vibration within limits" : null, source: code === "T-5501" ? "WhatsApp" : "Phone" });

  // Projects already in execution
  await db.insert(S.projects).values({ id: id(), code: "P-2601", opportunityId: oppIds["O-1045"], accountId: "A05", name: "Paint shop ventilation & exhaust", branch: "Renigunta", value: L(560), pmId: "u-bh-ren", status: "execution", progress: 35,
    checklist: ["PO / LOI copy filed", "Approved drawings & final BOQ handed to Projects", "Kick-off meeting with client & PMC", "Advance invoice raised", "Material indent & vendor POs", "Site mobilisation, permits & safety induction", "Execution schedule shared with client"].map((item, i) => ({ item, done: i < 5 })), createdAt: dFrom(-40) });
  await db.insert(S.projects).values({ id: id(), code: "P-2602", opportunityId: oppIds["O-1054"], accountId: "A14", name: "VRF retrofit + AMC conversion", branch: "Chennai", value: L(48), pmId: "u-bh-che", status: "completed", progress: 100,
    checklist: ["PO / LOI copy filed", "Kick-off meeting with client & PMC", "Advance invoice raised", "Handover & AMC signed"].map((item) => ({ item, done: true })), createdAt: dFrom(-120) });

  // A few manual tasks
  await db.insert(S.tasks).values([
    { id: id(), title: "Prepare heat-load calculation for Cognizant DC", assignedTo: "u-anitha", dueAt: dFrom(2), entityType: "opportunity", entityId: oppIds["O-1044"], priority: "high" },
    { id: id(), title: "Share LG Multi V i technical submittals with PMC", assignedTo: "u-karthik", dueAt: dFrom(1), entityType: "opportunity", entityId: oppIds["O-1041"] },
    { id: id(), title: "Collect hydraulic calc approval from RMZ consultant", assignedTo: "u-priya", dueAt: dFrom(-1), entityType: "opportunity", entityId: oppIds["O-1048"], priority: "high" },
  ]);

  for (const [k, v] of [["seq:E", 2307], ["seq:O", 1056], ["seq:T", 5508], ["seq:P", 2602], ["seq:Q-26", 195], ["seq:AMC", 308]] as const)
    await db.insert(S.settings).values({ key: k, value: v });

  // ── Let the automation engine do its job on the sample data ──
  const newEnq = [
    ["Nexa Data Centres (sample)", "Arvind", "UPS room cooling, ~40 TR, urgent", "HVAC", "Chennai", "WhatsApp", 1.5, 45],
    ["Prestige Tech Park (sample)", "Sanjay", "Chilled-water plant retrofit, 2 × 300 TR", "HVAC", "Bangalore", "Website form", 0.4, 380],
    ["Amazon", "Meera Iyer", "Additional cassette units for Tower C cafeteria", "HVAC", "Chennai", "Email", 0.2, 22],
  ] as const;
  let seq = 2308;
  for (const [co, person, req, div, branch, src, h, lakhs] of newEnq) {
    const eid = id();
    await db.insert(S.enquiries).values({ id: eid, code: `E-${seq}`, source: src, company: co, contactName: person, phone: `+91 98410 ${seq}0`, email: `${person.toLowerCase().replace(/[^a-z]+/g, "")}@client.example`, requirement: req, division: div, branch, estValue: L(lakhs), createdAt: hAgo(h) });
    await db.update(S.settings).set({ value: seq }).where((await import("drizzle-orm")).eq(S.settings.key, "seq:E"));
    seq++;
    await emit("enquiry.created", { id: eid });
  }
  const t3 = id();
  await db.insert(S.tickets).values({ id: t3, code: "T-5509", accountId: "A02", site: "Store #212, Koramangala", issue: "Cassette unit water leakage", priority: "P2", slaHours: 24, status: "open", branch: "Bangalore", source: "WhatsApp", createdAt: hAgo(10) });
  await db.update(S.settings).set({ value: 5509 }).where((await import("drizzle-orm")).eq(S.settings.key, "seq:T"));
  await emit("ticket.created", { id: t3 });
  await emit("quotation.sent", { id: (await db.query.quotations.findFirst({ where: (q, { eq }) => eq(q.code, "Q-26-180") }))!.id });
  await emit("opportunity.lost", { id: oppIds["O-1052"] });
  const n = await runScheduled();
  console.log(`Seeded. Automation engine performed ${n} scheduled actions.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
