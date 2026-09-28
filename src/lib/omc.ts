/**
 * OMC workbook: the internal version of the BOQ that procurement, stores and execution work from.
 * Columns follow SPACEAIR's existing OMC sheet (A-I selling, N-Z cost build-up with the same formulas),
 * with the 16-character product code in column K. Selling rates come from the CRM; cost inputs are
 * left for the estimator (yellow). A "Product Codes" sheet lists every code in the OMC format.
 */
import ExcelJS from "exceljs";
import type { ProductCode, QuoteItem } from "@/db/schema";
import { categoryText, kitFor } from "@/lib/product-codes/engine";
import { ITEMS } from "@/lib/product-codes/master";
import type { LineContext } from "@/lib/boq";

type Meta = { title: string; code: string; revision: number; client: string; preparedBy: string };

const FONT = "Arial";
const NAVY = "FF1F3864", YELLOW = "FFFFF2CC", ORANGE = "FFFCE4D6", SECTION = "FFDDEBF7", GREY = "FFF2F2F2";
const thin = { style: "thin" as const, color: { argb: "FFBFBFBF" } };
const BOX = { top: thin, left: thin, bottom: thin, right: thin };
const INR = "#,##,##0";

const HEAD = ["Sl. No.", "Description", "Make (BOQ)", "UoM", "QTY", "Supply Rate", "Erection Rate", "Supply Amount", "Erection Amount", "Make (selected)",
  "Product Code", "Vendor Make", "Comment", "Basic", "Dis", "P&F", "Freight", "Erec", 0.05, "Insulation", "Ins Erec", "Misc", "Rate", "Amount", "Rate", "Amount"];
const WIDTH = [7, 58, 14, 7, 8, 11, 11, 13, 13, 14, 19, 14, 18, 10, 8, 8, 8, 9, 9, 10, 9, 8, 11, 13, 11, 13];
const COST_INPUTS = [14, 15, 16, 17, 18, 20, 21, 22]; // N O P Q R T U V

export function omcSections(items: QuoteItem[], ctx: Map<string, LineContext>) {
  const out: { section: string; lines: { it: QuoteItem; heading: string; c?: LineContext }[] }[] = [];
  for (const it of items) {
    const c = ctx.get(`${it.sheet}!${it.sourceRow}`);
    // lettered section ("AIR DISTRIBUTION"), else the BOQ's group column ("VENTILATION FANS"), else the
    // sheet ("PUMPS", "AHUs" - multi-sheet BOQs); quotes built in the CRM have no file, so use their section
    const section = c ? c.section || c.group || it.sheet || "BOQ" : it.section || it.sheet || "BOQ";
    if (out.at(-1)?.section !== section) out.push({ section, lines: [] });
    out.at(-1)!.lines.push({ it, heading: c?.heading ?? "", c });
  }
  return out;
}

export async function buildOmcWorkbook(meta: Meta, items: QuoteItem[], ctx: Map<string, LineContext>, register: Register) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Spaceair CRM";
  const summary = wb.addWorksheet("Summary");
  const ws = wb.addWorksheet("OMC", { views: [{ state: "frozen", ySplit: 5, xSplit: 2 }] });

  // ── OMC sheet header ──
  ws.getCell("A1").value = `${meta.title} - OMC (internal cost build-up)`;
  ws.getCell("A1").font = { name: FONT, bold: true, size: 13, color: { argb: NAVY } };
  ws.getCell("A2").value = `${meta.code} R${meta.revision} · ${meta.client} · generated ${new Date().toLocaleDateString("en-GB")} by ${meta.preparedBy}. Yellow = enter cost; orange product code = not yet approved.`;
  ws.getCell("A2").font = { name: FONT, italic: true, size: 9, color: { argb: "FF595959" } };
  for (const [range, label] of [["F4:I4", "SELLING PRICE (from CRM)"], ["N4:V4", "COST BUILD-UP - enter"], ["W4:X4", "Supply cost"], ["Y4:Z4", "Installation cost"]] as const) {
    ws.mergeCells(range);
    const c = ws.getCell(range.split(":")[0]);
    c.value = label;
    c.font = { name: FONT, bold: true, size: 9, color: { argb: NAVY } };
    c.alignment = { horizontal: "center" };
  }
  const hr = ws.getRow(5);
  HEAD.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = BOX;
  });
  hr.getCell(19).numFmt = "0%";
  hr.getCell(19).note = "Contingency on erection (Erec + Ins Erec). Change this % to update every line.";
  hr.height = 30;
  WIDTH.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  // ── lines ──
  const sections = omcSections(items, ctx);
  const subtotals: { section: string; row: number }[] = [];
  let r = 6;
  const style = (row: ExcelJS.Row, fill?: string, bold = false) => {
    for (let c = 1; c <= 26; c++) {
      const cell = row.getCell(c);
      cell.font = { name: FONT, size: 9, bold };
      cell.border = BOX;
      if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    }
  };
  sections.forEach((sec, si) => {
    const sr = ws.getRow(r++);
    sr.getCell(1).value = String.fromCharCode(65 + (si % 26));
    sr.getCell(2).value = sec.section.toUpperCase();
    style(sr, SECTION, true);
    const first = r;
    let heading = "";
    for (const { it, heading: h } of sec.lines) {
      if (h && h !== heading) {
        heading = h;
        const row = ws.getRow(r++);
        row.getCell(2).value = h;
        style(row, undefined, true);
        row.getCell(2).alignment = { wrapText: true, vertical: "top" };
      }
      const row = ws.getRow(r);
      const qty: ExcelJS.CellValue = it.qro ? "QRO" : it.qty;
      const supply = it.supplyRate ?? (it.installRate == null ? it.rate : 0);
      row.values = [it.itemNo ?? "", it.description, null, it.unit, qty, supply || null, it.installRate || null];
      row.getCell(8).value = { formula: `IF(ISNUMBER(E${r}),E${r}*F${r},0)` };
      row.getCell(9).value = { formula: `IF(ISNUMBER(E${r}),E${r}*G${r},0)` };
      row.getCell(11).value = it.productCode ?? null;
      row.getCell(19).value = { formula: `(R${r}+U${r})*$S$5` };
      row.getCell(23).value = { formula: `ROUNDUP(N${r}-O${r}+P${r}+Q${r}+T${r}+V${r},0)` };
      row.getCell(24).value = { formula: `ROUNDUP(IF(ISNUMBER(E${r}),E${r}*W${r},0),0)` };
      row.getCell(25).value = { formula: `ROUNDUP(R${r}+S${r}+U${r},0)` };
      row.getCell(26).value = { formula: `ROUNDUP(IF(ISNUMBER(E${r}),E${r}*Y${r},0),0)` };
      style(row);
      row.getCell(2).alignment = { wrapText: true, vertical: "top" };
      for (const c of COST_INPUTS) row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: YELLOW } };
      const code = row.getCell(11);
      code.font = { name: "Consolas", size: 9, bold: true };
      if (!it.codeApproved) {
        code.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ORANGE } };
        if (it.codeFlag) code.note = it.codeFlag;
      }
      r++;
    }
    const tr = ws.getRow(r);
    tr.getCell(2).value = `SUB TOTAL - ${sec.section.toUpperCase()}`;
    for (const col of ["H", "I", "X", "Z"]) tr.getCell(col).value = { formula: `SUM(${col}${first}:${col}${r - 1})` };
    style(tr, GREY, true);
    subtotals.push({ section: sec.section, row: r });
    r += 2;
  });
  for (const col of [6, 7, 8, 9, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26]) ws.getColumn(col).numFmt = INR;
  ws.autoFilter = { from: "A5", to: `Z${r}` };

  // ── Summary sheet ──
  summary.getCell("A1").value = `${meta.title} - SUMMARY OF COSTING`;
  summary.getCell("A1").font = { name: FONT, bold: true, size: 13, color: { argb: NAVY } };
  summary.getCell("A2").value = `${meta.code} R${meta.revision} · ${meta.client}`;
  summary.getCell("A2").font = { name: FONT, italic: true, size: 9 };
  const sh = ["Sl. No.", "System", "Selling Supply", "Selling Erection", "Selling Total", "Cost Supply", "Cost Erection", "Cost Total", "Margin %"];
  sh.forEach((h, i) => {
    const c = summary.getRow(4).getCell(i + 1);
    c.value = h;
    c.font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.border = BOX;
  });
  let s = 5;
  subtotals.forEach((t, i) => {
    const row = summary.getRow(s);
    row.values = [String.fromCharCode(65 + (i % 26)), t.section.toUpperCase()];
    row.getCell(3).value = { formula: `OMC!H${t.row}` };
    row.getCell(4).value = { formula: `OMC!I${t.row}` };
    row.getCell(5).value = { formula: `C${s}+D${s}` };
    row.getCell(6).value = { formula: `OMC!X${t.row}` };
    row.getCell(7).value = { formula: `OMC!Z${t.row}` };
    row.getCell(8).value = { formula: `F${s}+G${s}` };
    row.getCell(9).value = { formula: `IF(OR(E${s}=0,H${s}=0),"",(E${s}-H${s})/E${s})` };
    s++;
  });
  const tot = summary.getRow(s);
  tot.getCell(2).value = "Sub-Total (Rs)";
  for (const col of ["C", "D", "E", "F", "G", "H"]) tot.getCell(col).value = { formula: `SUM(${col}5:${col}${s - 1})` };
  tot.getCell(9).value = { formula: `IF(OR(E${s}=0,H${s}=0),"",(E${s}-H${s})/E${s})` };
  for (let row = 5; row <= s; row++)
    for (let c = 1; c <= 9; c++) {
      const cell = summary.getRow(row).getCell(c);
      cell.font = { name: FONT, size: 10, bold: row === s };
      cell.border = BOX;
      cell.numFmt = c === 9 ? "0.0%" : INR;
    }
  summary.getCell(`B${s + 2}`).value = "Margin % stays blank until cost is entered on the OMC sheet.";
  summary.getCell(`B${s + 2}`).font = { name: FONT, italic: true, size: 9, color: { argb: "FF595959" } };
  [7, 36, 15, 15, 15, 15, 15, 15, 10].forEach((w, i) => (summary.getColumn(i + 1).width = w));

  addProductCodeOmcSheet(wb, items, ctx, register);
  wb.calcProperties.fullCalcOnLoad = true;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export type Register = Map<string, ProductCode>;
type PcoRow = { code: string; name: string; category: string; hsn: string; unit: string; description: string; abbreviation: string; component: boolean; approved: boolean; flag?: string | null };

/** A component code's details: from the Code Register, else built from the item master. */
function componentRow(code: string, unit: string, register: Register): PcoRow {
  const known = register.get(code);
  if (known) {
    return { code, name: known.name, category: known.categoryText, hsn: known.hsn ?? "", unit, description: known.description || `Supply of ${known.name}`,
      abbreviation: known.abbreviation ?? "", component: true, approved: true };
  }
  const item = ITEMS.find((i) => i.code === code.slice(2, 6));
  const name = [item?.name.toUpperCase() ?? code.slice(2, 6), code.slice(6, 10), code.slice(10, 14)].filter((s) => s && !/^X+$/.test(s)).join(" - ");
  return { code, name, category: categoryText(code[1]), hsn: item?.hsn ?? "", unit, description: `Supply of ${item?.name ?? name}`, abbreviation: "", component: true, approved: false };
}

/**
 * The team's "Product Code OMC": every BOQ line in order, each followed by the components it is split into
 * for purchasing (kits in master.ts - e.g. an insulated pipe brings aluminium cladding + nitrile insulation).
 */
export function productCodeOmcRows(items: QuoteItem[], ctx: Map<string, LineContext>, register: Register): PcoRow[] {
  const rows: PcoRow[] = [];
  for (const it of items) {
    if (!it.productCode) continue;
    const c = ctx.get(`${it.sheet}!${it.sourceRow}`);
    const known = register.get(it.productCode);
    rows.push({
      code: it.productCode, name: it.productName ?? known?.name ?? "", category: it.codeInfo?.categoryText || known?.categoryText || "",
      hsn: it.codeInfo?.hsn || known?.hsn || "", unit: it.unit, description: [c?.heading, c?.context, it.description, c?.trailing].filter(Boolean).join("\n"),
      abbreviation: it.codeInfo?.abbreviation || known?.abbreviation || "", component: false, approved: it.codeApproved, flag: it.codeFlag,
    });
    for (const k of kitFor(it.productCode)) rows.push(componentRow(k, it.unit, register));
  }
  return rows;
}

/** Product Code OMC in SPACEAIR's 7-column format. Orange = code not approved yet; grey = component row. */
export function addProductCodeOmcSheet(wb: ExcelJS.Workbook, items: QuoteItem[], ctx: Map<string, LineContext>, register: Register) {
  const ws = wb.addWorksheet("Product Code OMC", { views: [{ state: "frozen", ySplit: 1 }] });
  const head = ["Product Code", "Product Name", "Category", "HSN Code", "Unit", "Description", "Abbreviation"];
  head.forEach((h, i) => {
    const c = ws.getRow(1).getCell(i + 1);
    c.value = h;
    c.font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.border = BOX;
  });
  productCodeOmcRows(items, ctx, register).forEach((p, i) => {
    const row = ws.getRow(i + 2);
    row.values = [p.code, p.name, p.category, p.hsn || null, p.unit, p.description, p.abbreviation];
    for (let c = 1; c <= 7; c++) {
      const cell = row.getCell(c);
      cell.font = c === 1 ? { name: "Consolas", size: 10, bold: !p.component } : { name: FONT, size: 9, color: p.component ? { argb: "FF595959" } : undefined };
      cell.alignment = { wrapText: c >= 6 || c === 2, vertical: "top", indent: c === 2 && p.component ? 1 : 0 };
      cell.border = BOX;
      if (!p.approved) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: p.component ? GREY : ORANGE } };
    }
    if (!p.component && !p.approved && p.flag) row.getCell(1).note = p.flag;
  });
  [20, 42, 14, 11, 7, 80, 34].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  return ws;
}

export async function buildProductCodeOmcWorkbook(items: QuoteItem[], ctx: Map<string, LineContext>, register: Register) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Spaceair CRM";
  addProductCodeOmcSheet(wb, items, ctx, register);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
