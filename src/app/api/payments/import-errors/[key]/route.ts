import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { getUser } from "@/lib/auth";

/** Downloads the skipped-row report for any import (payments, reminder schedule, …) as .xlsx, columns matched to whatever fields that import's skip rows have. */
export async function GET(req: Request, ctx: RouteContext<"/api/payments/import-errors/[key]">) {
  const user = await getUser();
  if (!user || user.role !== "owner") return Response.redirect(new URL("/login", req.url), 303);
  const { key } = await ctx.params;
  const row = await db.query.settings.findFirst({ where: eq(S.settings.key, `import-errors:${key}`) });
  const skipped = (row?.value ?? []) as Record<string, string | number>[];
  if (!skipped.length) return new Response("Not found", { status: 404 });

  const columns = Object.keys(skipped[0]);
  const labels: Record<string, string> = { row: "Row", code: "Project code", amount: "Amount", date: "Date", note: "Note", email: "Email", time: "Time", reason: "Reason skipped" };

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Skipped rows");
  ws.getRow(1).values = columns.map((c) => labels[c] ?? c);
  ws.getRow(1).font = { bold: true };
  skipped.forEach((s, i) => {
    ws.getRow(i + 2).values = columns.map((c) => s[c]);
  });
  ws.columns = columns.map((c) => ({ width: c === "reason" ? 40 : c === "note" ? 24 : 14 }));

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="import-errors.xlsx"`,
    },
  });
}
