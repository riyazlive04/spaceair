import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { uid } from "@/lib/automation/ctx";
import { cellText } from "@/lib/xlsx-cell";

export type ReminderScheduleImportResult = {
  imported: number;
  skipped: { row: number; reason: string; code: string; email: string; date: string; time: string }[];
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Reads a workbook with columns Project code / Email / Date / Time (optional, default 09:00) —
 * header names matched loosely — and for each matched project sets its reminder "To" address and
 * schedules a balance reminder for that date/time. Existing reminder emails and other scheduled
 * dates for the project are left alone; this only adds.
 */
export async function importReminderSchedule(file: File): Promise<ReminderScheduleImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await file.arrayBuffer()) as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("The workbook has no sheets");

  const projects = await db.select().from(S.projects);
  const byCode = new Map(projects.map((p) => [norm(p.code), p]));

  let headerRow = -1;
  let cols: { code?: number; email?: number; date?: number; time?: number } = {};
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const found: typeof cols = {};
    for (let c = 1; c <= 15; c++) {
      const t = norm(cellText(row.getCell(c)));
      if (!t) continue;
      if (/^(project)?code$/.test(t) || t === "project") found.code = c;
      else if (t === "email" || t === "recipient" || t === "to") found.email = c;
      else if (t === "date" || t === "reminderdate" || t === "senddate") found.date = c;
      else if (t === "time" || t === "remindertime" || t === "sendtime") found.time = c;
    }
    if (found.code && found.email && found.date) {
      headerRow = r;
      cols = found;
      break;
    }
  }
  if (headerRow < 0) throw new Error('Could not find a header row with "Project code", "Email" and "Date" columns');

  const skipped: ReminderScheduleImportResult["skipped"] = [];
  const rows: { projectId: string; email: string; sendAt: Date }[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const code = cellText(row.getCell(cols.code!)).trim();
    const email = cellText(row.getCell(cols.email!)).trim();
    const dateCell = row.getCell(cols.date!).value;
    const dateRaw = dateCell instanceof Date ? dateCell.toISOString().slice(0, 10) : String(dateCell ?? "").trim();
    const timeCell = cols.time ? row.getCell(cols.time).value : undefined;
    const timeRaw = timeCell instanceof Date ? timeCell.toISOString().slice(11, 16) : String(timeCell ?? "").trim();
    if (!code && !email && !dateRaw) continue;

    const p = byCode.get(norm(code));
    if (!p) {
      skipped.push({ row: r, reason: `Unknown project code "${code}"`, code, email, date: dateRaw, time: timeRaw });
      continue;
    }
    if (!EMAIL_RE.test(email)) {
      skipped.push({ row: r, reason: `Invalid email "${email}"`, code, email, date: dateRaw, time: timeRaw });
      continue;
    }
    const time = /^\d{1,2}:\d{2}$/.test(timeRaw) ? timeRaw : "09:00";
    const sendAt = dateCell instanceof Date ? new Date(`${dateCell.toISOString().slice(0, 10)}T${time}`) : new Date(`${dateRaw}T${time}`);
    if (Number.isNaN(sendAt.getTime())) {
      skipped.push({ row: r, reason: `Invalid date "${dateRaw}"`, code, email, date: dateRaw, time: timeRaw });
      continue;
    }
    rows.push({ projectId: p.id, email, sendAt });
  }

  for (const row of rows) {
    await db.update(S.projects).set({ reminderTo: row.email }).where(eq(S.projects.id, row.projectId));
    await db.insert(S.paymentReminders).values({ id: uid(), projectId: row.projectId, sendAt: row.sendAt });
  }

  return { imported: rows.length, skipped };
}
