import ExcelJS from "exceljs";
import { db, schema as S } from "@/db";
import { uid } from "@/lib/automation/ctx";
import { cellText } from "@/lib/xlsx-cell";

export type PaymentsImportResult = {
  imported: number;
  skipped: { row: number; reason: string; code: string; amount: string; date: string; note: string }[];
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Reads a payments workbook with columns Project code / Amount / Date (optional) / Note (optional)
 * — header names are matched loosely (case/space/punctuation-insensitive) — and inserts one row per
 * matched line into `payments`, for projects that already exist (matched by project code).
 */
export async function importPayments(file: File): Promise<PaymentsImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await file.arrayBuffer()) as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("The workbook has no sheets");

  const projects = await db.select().from(S.projects);
  const byCode = new Map(projects.map((p) => [norm(p.code), p]));

  let headerRow = -1;
  let cols: { code?: number; amount?: number; date?: number; note?: number } = {};
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const found: typeof cols = {};
    for (let c = 1; c <= 15; c++) {
      const t = norm(cellText(row.getCell(c)));
      if (!t) continue;
      if (/^(project)?code$/.test(t) || t === "project") found.code = c;
      else if (/^amount(paid|received)?$/.test(t) || t === "paid") found.amount = c;
      else if (t === "date" || t === "paidon" || t === "paymentdate") found.date = c;
      else if (t === "note" || t === "notes" || t === "remarks") found.note = c;
    }
    if (found.code && found.amount) {
      headerRow = r;
      cols = found;
      break;
    }
  }
  if (headerRow < 0) throw new Error('Could not find a header row with "Project code" and "Amount" columns');

  const skipped: PaymentsImportResult["skipped"] = [];
  const rows: { projectId: string; amount: number; paidAt?: Date; note: string | null }[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const code = cellText(row.getCell(cols.code!)).trim();
    const amountCell = row.getCell(cols.amount!).value;
    const amountRaw = String(amountCell ?? "");
    const dateCell = cols.date ? row.getCell(cols.date).value : undefined;
    const dateRaw = dateCell instanceof Date ? dateCell.toISOString().slice(0, 10) : String(dateCell ?? "");
    const noteRaw = cols.note ? cellText(row.getCell(cols.note)) : "";
    if (!code) continue;
    const p = byCode.get(norm(code));
    if (!p) {
      skipped.push({ row: r, reason: `Unknown project code "${code}"`, code, amount: amountRaw, date: dateRaw, note: noteRaw });
      continue;
    }
    const amount = typeof amountCell === "number" ? amountCell : Number(amountRaw.replace(/[^0-9.-]/g, ""));
    if (!amount || amount <= 0) {
      skipped.push({ row: r, reason: `Invalid amount for ${code}`, code, amount: amountRaw, date: dateRaw, note: noteRaw });
      continue;
    }
    const paidAt = dateCell instanceof Date ? dateCell : undefined;
    const note = noteRaw.trim() || null;
    rows.push({ projectId: p.id, amount, paidAt, note });
  }

  if (rows.length)
    await db.insert(S.payments).values(rows.map((x) => ({ id: uid(), projectId: x.projectId, amount: x.amount, note: x.note, ...(x.paidAt ? { paidAt: x.paidAt } : {}) })));

  return { imported: rows.length, skipped };
}
