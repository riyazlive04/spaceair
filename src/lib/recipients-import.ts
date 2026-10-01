import ExcelJS from "exceljs";
import { cellText } from "@/lib/xlsx-cell";

const EMAIL = /[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+/g;
const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

function emailsFromWorksheet(ws: ExcelJS.Worksheet): string[] {
  const found: string[] = [];
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      const matches = cellText(cell).match(EMAIL);
      if (matches) found.push(...matches);
    });
  });
  return [...new Set(found.map((e) => e.toLowerCase()))];
}

/** Every sheet name in an .xlsx workbook, in order. Empty for .csv (which has no sheets). */
export async function listSheetNames(file: File): Promise<string[]> {
  if (/\.csv$/i.test(file.name)) return [];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await file.arrayBuffer()) as ArrayBuffer);
  return wb.worksheets.map((ws) => ws.name);
}

/**
 * Extracts every email address found in an .xlsx or .csv file — works whether it's a single
 * column of addresses, a column with a header like "Email", or a wider sheet with an email
 * column among others. Order-preserving, de-duplicated. With `sheetName`, reads only that sheet;
 * otherwise all sheets (an .xlsx with just one sheet behaves the same either way).
 */
export async function extractEmails(file: File, sheetName?: string): Promise<string[]> {
  if (/\.csv$/i.test(file.name)) {
    const text = await file.text();
    const matches = text.match(EMAIL);
    return [...new Set((matches ?? []).map((e) => e.toLowerCase()))];
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await file.arrayBuffer()) as ArrayBuffer);
  const sheets = sheetName ? wb.worksheets.filter((ws) => ws.name === sheetName) : wb.worksheets;
  const found: string[] = [];
  for (const ws of sheets) found.push(...emailsFromWorksheet(ws));
  return [...new Set(found.map((e) => e.toLowerCase()))];
}

export type BroadcastFileData = { emails: string[]; subject: string | null; body: string | null; cc: string | null; bcc: string | null; date: string | null; time: string | null };

/**
 * Like extractEmails, but also looks for Subject / Body / CC / BCC / Date / Time columns (header row
 * anywhere in the first 10 rows, matched loosely) and reads their value once from the first data row
 * that has it — applied to the whole broadcast, not per-recipient. Reads the given sheet (or the first
 * one if omitted). .csv files only ever return emails, since a flat comma-separated file has no
 * natural column layout for the other fields.
 */
export async function extractBroadcastData(file: File, sheetName?: string): Promise<BroadcastFileData> {
  if (/\.csv$/i.test(file.name)) {
    return { emails: await extractEmails(file), subject: null, body: null, cc: null, bcc: null, date: null, time: null };
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await file.arrayBuffer()) as ArrayBuffer);
  const ws = (sheetName ? wb.worksheets.find((w) => w.name === sheetName) : wb.worksheets[0]) ?? wb.worksheets[0];
  if (!ws) return { emails: await extractEmails(file, sheetName), subject: null, body: null, cc: null, bcc: null, date: null, time: null };

  let cols: { email?: number; subject?: number; body?: number; cc?: number; bcc?: number; date?: number; time?: number } = {};
  let headerRow = -1;
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const found: typeof cols = {};
    for (let c = 1; c <= 15; c++) {
      const t = norm(cellText(row.getCell(c)));
      if (!t) continue;
      if (t === "email" || t === "recipient" || t === "to") found.email = c;
      else if (t === "subject") found.subject = c;
      else if (t === "body" || t === "message") found.body = c;
      else if (t === "cc") found.cc = c;
      else if (t === "bcc") found.bcc = c;
      else if (t === "date" || t === "senddate") found.date = c;
      else if (t === "time" || t === "sendtime") found.time = c;
    }
    if (found.subject || found.body || found.date || found.cc || found.bcc) {
      headerRow = r;
      cols = found;
      break;
    }
  }

  let subject: string | null = null, body: string | null = null, cc: string | null = null, bcc: string | null = null, date: string | null = null, time: string | null = null;
  if (headerRow > 0) {
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (!subject && cols.subject) subject = cellText(row.getCell(cols.subject)).trim() || null;
      if (!body && cols.body) body = cellText(row.getCell(cols.body)).trim() || null;
      if (!cc && cols.cc) cc = cellText(row.getCell(cols.cc)).trim() || null;
      if (!bcc && cols.bcc) bcc = cellText(row.getCell(cols.bcc)).trim() || null;
      if (!date && cols.date) {
        const v = row.getCell(cols.date).value;
        date = v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").trim() || null;
      }
      if (!time && cols.time) {
        const v = row.getCell(cols.time).value;
        time = v instanceof Date ? v.toISOString().slice(11, 16) : String(v ?? "").trim() || null;
      }
      if (subject && body && cc && bcc && date && time) break;
    }
  }

  return { emails: emailsFromWorksheet(ws), subject, body, cc, bcc, date, time };
}

export type PersonalizedRow = { name: string | null; email: string; subject: string; body: string; cc: string | null; bcc: string | null; date: string | null; time: string | null; balance: string | null };

/**
 * Reads one email per row — each row carries its own Name/Email/Subject/Body/CC/BCC/Date/Time, plus
 * an optional Balance figure — unlike extractBroadcastData which applies one shared subject/body to
 * every recipient. Balance is plain text inserted wherever a {balance} token appears in that row's
 * Subject/Body; it is not matched against any project or recorded anywhere — just text substitution.
 * Header row is matched loosely within the first 10 rows. Rows missing Email, Subject or Body are
 * skipped.
 */
export async function extractPersonalizedRows(file: File, sheetName?: string): Promise<PersonalizedRow[]> {
  const wb = new ExcelJS.Workbook();
  let sheet: ExcelJS.Worksheet | undefined;
  if (/\.csv$/i.test(file.name)) {
    const { Readable } = await import("stream");
    sheet = await wb.csv.read(Readable.from(Buffer.from(await file.arrayBuffer())));
  } else {
    await wb.xlsx.load((await file.arrayBuffer()) as ArrayBuffer);
    sheet = (sheetName ? wb.worksheets.find((w) => w.name === sheetName) : wb.worksheets[0]) ?? wb.worksheets[0];
  }
  if (!sheet) return [];

  let cols: { name?: number; email?: number; subject?: number; body?: number; cc?: number; bcc?: number; date?: number; time?: number; balance?: number } = {};
  let headerRow = -1;
  for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
    const row = sheet.getRow(r);
    const found: typeof cols = {};
    for (let c = 1; c <= 15; c++) {
      const t = norm(cellText(row.getCell(c)));
      if (!t) continue;
      if (t === "name" || t === "recipientname") found.name = c;
      else if (t === "email" || t === "recipient" || t === "to") found.email = c;
      else if (t === "subject") found.subject = c;
      else if (t === "body" || t === "message") found.body = c;
      else if (t === "cc") found.cc = c;
      else if (t === "bcc") found.bcc = c;
      else if (t === "date" || t === "senddate") found.date = c;
      else if (t === "time" || t === "sendtime") found.time = c;
      else if (t === "balance" || t === "balancetobepaid" || t === "balancedue" || t === "amountdue") found.balance = c;
    }
    if (found.email && (found.subject || found.body)) {
      headerRow = r;
      cols = found;
      break;
    }
  }
  if (headerRow < 0 || !cols.email) return [];

  const rows: PersonalizedRow[] = [];
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const email = cellText(row.getCell(cols.email)).match(EMAIL)?.[0]?.toLowerCase();
    const subject = cols.subject ? cellText(row.getCell(cols.subject)).trim() : "";
    const body = cols.body ? cellText(row.getCell(cols.body)).trim() : "";
    if (!email || !subject || !body) continue;
    const dateVal = cols.date ? row.getCell(cols.date).value : null;
    const timeVal = cols.time ? row.getCell(cols.time).value : null;
    rows.push({
      name: cols.name ? cellText(row.getCell(cols.name)).trim() || null : null,
      email,
      subject,
      body,
      cc: cols.cc ? cellText(row.getCell(cols.cc)).trim() || null : null,
      bcc: cols.bcc ? cellText(row.getCell(cols.bcc)).trim() || null : null,
      date: dateVal instanceof Date ? dateVal.toISOString().slice(0, 10) : dateVal ? String(dateVal).trim() || null : null,
      time: timeVal instanceof Date ? timeVal.toISOString().slice(11, 16) : timeVal ? String(timeVal).trim() || null : null,
      balance: cols.balance ? cellText(row.getCell(cols.balance)).trim() || null : null,
    });
  }
  return rows;
}
