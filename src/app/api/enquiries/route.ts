import { z } from "zod";
import { db, schema as S } from "@/db";
import { emit } from "@/lib/automation/engine";
import { nextCode, uid } from "@/lib/automation/ctx";
import { BRANCHES } from "@/lib/constants";

/**
 * Inbound enquiry API for integrations: website, WhatsApp Business webhook relay, IndiaMART, tender alerts.
 * POST /api/enquiries  (header: x-api-key)
 */
const Body = z.object({
  company: z.string().min(2),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  requirement: z.string().min(3),
  division: z.string().default("HVAC"),
  branch: z.enum(BRANCHES).default("Chennai"),
  source: z.string().default("API"),
  estValueLakhs: z.number().optional(),
});

export async function POST(req: Request) {
  const key = process.env.CRM_API_KEY ?? "spaceair-demo-key";
  if (req.headers.get("x-api-key") !== key) return Response.json({ error: "Invalid API key" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  const d = parsed.data;
  const id = uid();
  const code = await nextCode("E", 2301);
  await db.insert(S.enquiries).values({ id, code, company: d.company, contactName: d.contactName, phone: d.phone, email: d.email, requirement: d.requirement, division: d.division, branch: d.branch, source: d.source, estValue: d.estValueLakhs ? d.estValueLakhs * 1e5 : null });
  await emit("enquiry.created", { id });
  const e = await db.query.enquiries.findFirst({ where: (t, { eq }) => eq(t.id, id) });
  return Response.json({ id, code, assignedTo: e?.assignedTo, status: e?.status }, { status: 201 });
}
