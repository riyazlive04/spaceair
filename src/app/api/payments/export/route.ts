import ExcelJS from "exceljs";
import { inArray } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { getUser } from "@/lib/auth";
import { lookups } from "@/lib/data";
import { fmtDate } from "@/lib/format";

/** Download every project with an outstanding balance as .xlsx, for sharing with accounts or a bank. */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user || user.role !== "owner") return Response.redirect(new URL("/login", req.url), 303);

  const [projects, payments, L] = await Promise.all([
    db.select().from(S.projects).where(inArray(S.projects.status, ["handover", "execution"])),
    db.select().from(S.payments),
    lookups(),
  ]);
  const paidByProject = new Map<string, number>();
  for (const pay of payments) paidByProject.set(pay.projectId, (paidByProject.get(pay.projectId) ?? 0) + pay.amount);
  const rows = projects
    .map((p) => ({ p, paid: paidByProject.get(p.id) ?? 0, balance: p.value - (paidByProject.get(p.id) ?? 0) }))
    .filter((x) => x.balance > 0)
    .sort((a, b) => b.balance - a.balance);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Spaceair CRM";
  const ws = wb.addWorksheet("Balance due", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.getRow(1).values = ["Project code", "Project name", "Client", "Branch", "Value", "Paid", "Balance", "Since"];
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3A7266" } }));
  rows.forEach(({ p, paid, balance }, i) => {
    ws.getRow(i + 2).values = [p.code, p.name, L.acctName(p.accountId), p.branch, p.value, paid, balance, fmtDate(p.createdAt)];
  });
  ws.columns = [{ width: 12 }, { width: 32 }, { width: 24 }, { width: 12 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 12 }];
  for (const c of [5, 6, 7]) ws.getColumn(c).numFmt = "#,##,##0";

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const name = `SPACEAIR balance due – ${fmtDate(new Date())}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${name.replace(/[–—]/g, "-").replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
