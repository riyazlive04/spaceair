import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { parseBoq } from "@/lib/boq";
import { generateCodes } from "@/lib/product-codes/run";
import { emit } from "@/lib/automation/engine";
import { nextCode, uid, pickSales } from "@/lib/automation/ctx";
import { DAY } from "@/lib/format";
import type { User } from "@/db/schema";

export const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");

const DIVISION_BY_SERVICE: [RegExp, string][] = [
  [/hvac|ventilation|air.?cond|chiller|vrf/i, "HVAC"],
  [/fire|sprinkler|hydrant/i, "Fire & Safety"],
  [/elv|cctv|access|security/i, "ELV & Security"],
  [/electric/i, "Electrical"],
  [/plumb|phe|sanitary|stp/i, "Plumbing"],
  [/interior/i, "Interiors"],
];
const clean = (s?: string) => (s ?? "").replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").trim();

async function findOrCreateAccount(name: string, kind: "client" | "consultant" | "architect", branch: string, ownerId: string | null, city?: string) {
  if (!name) return null;
  const all = await db.select().from(S.accounts);
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const hit = all.find((a) => a.name.toLowerCase().replace(/[^a-z0-9]/g, "") === key);
  if (hit) return hit.id;
  const id = `A${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 90 + 10)}`;
  await db.insert(S.accounts).values({ id, name, kind, branch, city: city ?? branch, industry: kind === "client" ? "New client" : kind === "consultant" ? "MEP consultant" : "Architect", tier: "New", ownerId });
  return id;
}

/** Import a client/consultant BOQ workbook as a new quotation (and opportunity, if none is chosen). */
export async function importBoq(file: File, opts: { user: User; opportunityId?: string; branch: string; division?: string; dueAt?: Date | null }) {
  const buf = Buffer.from(await file.arrayBuffer());
  const boq = await parseBoq(buf);
  if (!boq.lines.length) throw new Error("No BOQ lines found. Expected a sheet with DESCRIPTION and UNIT columns.");
  const m = boq.meta;
  const division = opts.division || DIVISION_BY_SERVICE.find(([re]) => re.test(`${m.service ?? ""} ${m.document ?? ""} ${file.name}`))?.[1] || "Turnkey MEP";
  const city = clean(m.project).split(",").pop()?.trim();

  let oppId = opts.opportunityId || "";
  if (!oppId) {
    const owner = await pickSales(opts.branch);
    const clientName = clean(m.client) || clean(m.project).split(",")[0] || file.name.replace(/\.xlsx?$/i, "");
    const accountId = (await findOrCreateAccount(clientName, "client", opts.branch, owner?.id ?? opts.user.id, city))!;
    const consultantId = await findOrCreateAccount(clean(m.consultant), "consultant", opts.branch, opts.user.id);
    const architectId = await findOrCreateAccount(clean(m.architect), "architect", opts.branch, opts.user.id);
    oppId = uid();
    await db.insert(S.opportunities).values({
      id: oppId, code: await nextCode("O", 1041), accountId, title: `${division} – ${clean(m.project) || clientName}`, division, branch: opts.branch, stage: "boq",
      value: 0, ownerId: owner?.id ?? opts.user.id, source: m.consultant ? "Architect / PMC" : "Tender", consultantId, architectId,
      nextAction: "Price BOQ and submit", nextActionDue: opts.dueAt ?? new Date(Date.now() + 5 * DAY), stageChangedAt: new Date(), lastActivityAt: new Date(),
    });
  } else {
    await db.update(S.opportunities).set({ stage: "boq", lastActivityAt: new Date() }).where(eq(S.opportunities.id, oppId));
  }

  const qid = uid();
  await mkdir(UPLOAD_DIR, { recursive: true });
  const stored = path.join(UPLOAD_DIR, `${qid}.xlsx`);
  await writeFile(stored, buf);
  await db.insert(S.quotations).values({
    id: qid, code: await nextCode("Q-26", 187), opportunityId: oppId, createdBy: opts.user.id, source: "boq_import", docRef: m.docRef, dueAt: opts.dueAt ?? null,
    fileName: file.name, sourceFile: stored, meta: m, sheets: boq.sheets, makes: boq.makes, validityDays: 30,
    terms: "Rates as per client BOQ format. GST extra. Makes as per approved list. QRO items are rate-only; quantities as per actuals.",
  });
  for (let i = 0; i < boq.lines.length; i += 200)
    await db.insert(S.quoteItems).values(
      boq.lines.slice(i, i + 200).map((l, j) => ({
        id: uid(), quotationId: qid, itemNo: l.itemNo, section: l.section, description: l.description, unit: l.unit, qty: l.qty, qro: l.qro,
        floorQty: l.floorQty, supplyRate: l.supplyRate ?? null, installRate: l.installRate ?? null, rate: (l.supplyRate ?? 0) + (l.installRate ?? 0),
        rateSource: l.supplyRate || l.installRate ? ("manual" as const) : null, sheet: l.sheet, sourceRow: l.sourceRow, sort: i + j,
      })),
    );
  await db.insert(S.activities).values({ id: uid(), entityType: "opportunity", entityId: oppId, kind: "system", body: `BOQ "${file.name}" imported by ${opts.user.name}`, userId: opts.user.id });
  await emit("quotation.imported", { id: qid, userId: opts.user.id });
  // Product codes for the OMC. A coding problem must never block the import itself.
  const codes = await generateCodes(qid).catch(() => ({ coded: 0, total: boq.lines.length }));
  return { quotationId: qid, opportunityId: oppId, lines: boq.lines.length, coded: codes.coded };
}
