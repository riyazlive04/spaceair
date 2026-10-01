import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { money, fmtDate } from "@/lib/format";

export type StatementData = {
  code: string;
  name: string;
  clientName: string;
  value: number;
  payments: { paidAt: Date; amount: number; note: string | null }[];
};

/** A one-page statement of account: order value, every payment received, and the running balance. */
export async function buildStatementPdf(s: StatementData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.1, 0.1);
  const muted = rgb(0.45, 0.45, 0.45);
  const accent = rgb(0.227, 0.447, 0.4); // #3a7266

  let y = 800;
  const left = 50;
  const draw = (text: string, x: number, size: number, f = font, color = ink) => {
    page.drawText(text, { x, y, size, font: f, color });
  };

  draw("SPACEAIR", left, 20, bold, accent);
  draw("Statement of account", left, 14, font, muted);
  y -= 20;
  draw(`${s.code} · ${s.name}`, left, 16, bold);
  y -= 18;
  draw(`Client: ${s.clientName}`, left, 11, font, muted);
  y -= 14;
  draw(`Generated: ${fmtDate(new Date())}`, left, 11, font, muted);
  y -= 30;

  draw(`Order value: ${money(s.value)}`, left, 13, bold);
  y -= 25;

  const paid = s.payments.reduce((sum, p) => sum + p.amount, 0);
  draw("Date", left, 11, bold);
  draw("Note", left + 100, 11, bold);
  draw("Amount", left + 380, 11, bold);
  y -= 16;
  page.drawLine({ start: { x: left, y: y + 5 }, end: { x: 545, y: y + 5 }, thickness: 0.5, color: muted });
  y -= 10;

  const sorted = s.payments.slice().sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());
  for (const p of sorted) {
    if (y < 80) break; // single page is enough for this use case
    draw(fmtDate(p.paidAt), left, 10.5);
    draw((p.note ?? "—").slice(0, 55), left + 100, 10.5, font, muted);
    draw(money(p.amount), left + 380, 10.5);
    y -= 16;
  }
  if (!sorted.length) {
    draw("No payments received yet.", left, 10.5, font, muted);
    y -= 16;
  }

  y -= 10;
  page.drawLine({ start: { x: left, y: y + 5 }, end: { x: 545, y: y + 5 }, thickness: 0.5, color: muted });
  y -= 20;
  draw(`Total paid: ${money(paid)}`, left, 12, bold);
  y -= 18;
  draw(`Balance outstanding: ${money(s.value - paid)}`, left, 13, bold, accent);

  return doc.save();
}
