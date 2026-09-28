/**
 * Consultant BOQ workbooks (.xlsx): import, auto-pricing against the rate library, and export back
 * into the client's own file. Handles the common Indian MEP layout:
 *   S.NO | ITEM CODE | DESCRIPTION | UNIT | <floor qty…> | TOTAL QTY | SUPPLY RATE | INSTALLATION RATE | amounts…
 * with section-heading rows (no unit), "QRO" (quote rate only) lines, a Summary sheet and an Approved Makes sheet.
 */
import ExcelJS from "exceljs";
import type { ApprovedMake, BoqSheetMap, RateItem } from "@/db/schema";
import { patchWorkbook, type CellPatch } from "@/lib/xlsx-patch";

export type BoqLine = {
  sheet: string;
  sourceRow: number;
  itemNo: string;
  section: string;
  description: string;
  unit: string;
  qty: number;
  qro: boolean;
  floorQty: Record<string, number>;
  supplyRate?: number;
  installRate?: number;
};
export type ParsedBoq = { meta: Record<string, string>; sheets: BoqSheetMap[]; lines: BoqLine[]; makes: ApprovedMake[] };

type CellVal = string | number | boolean | Date | null;
function val(c: ExcelJS.Cell): CellVal {
  // Only the top-left cell of a merged range holds the value; ExcelJS repeats it into the others.
  if (c.isMerged && c.master.address !== c.address) return null;
  const v = c.value as unknown;
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return (o.result as CellVal) ?? null;
    if ("richText" in o) return (o.richText as { text: string }[]).map((r) => r.text).join("");
    if ("text" in o) return String(o.text);
    if ("error" in o) return null;
  }
  return v as CellVal;
}
const txt = (c: ExcelJS.Cell) => {
  const v = val(c);
  if (v == null) return "";
  if (v instanceof Date) return v.toLocaleDateString("en-GB").replace(/\//g, ".");
  return String(v).replace(/\s+/g, " ").trim();
};
const num = (v: CellVal) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)) ? Number(v) : NaN);

const HEAD = {
  sno: /^(s|sl|sr)\.?\s*no/i,
  code: /item\s*code/i,
  desc: /description/i,
  unit: /^(units?|uom|u\.o\.m\.?)$/i,
  qty: /total\s*qty|total\s*quantity|^qty$|^quantity$/i,
  supplyRate: /supply\s*rate/i,
  installRate: /install\w*\s*rate|erection\s*rate|labou?r\s*rate/i,
  rate: /^(unit\s*)?rate$/i,
  supplyAmt: /supply\s*amount/i,
  installAmt: /install\w*\s*amount/i,
  amount: /total\s*amount|^amount$/i,
};

const META: [string, RegExp][] = [
  ["project", /^project(\s*name)?/i],
  ["client", /^client$/i],
  ["architect", /^architect$/i],
  ["consultant", /consultant$/i],
  ["docRef", /doc\.?\s*ref/i],
  ["revision", /^revision\s*no/i],
  ["date", /^initial\s*date|^date$/i],
  ["preparedBy", /^prepared\s*by/i],
  ["reviewedBy", /^reviewed\s*by/i],
  ["approvedBy", /^approved\s*by/i],
  ["service", /^service(\s*name)?$/i],
  ["document", /^document(\s*name)?$/i],
];

function findHeader(ws: ExcelJS.Worksheet) {
  for (let r = 1; r <= Math.min(40, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const cols: Record<string, number> = {};
    for (let c = 1; c <= Math.min(60, row.cellCount || 60); c++) {
      const t = txt(row.getCell(c));
      if (!t) continue;
      for (const [k, re] of Object.entries(HEAD)) if (!(k in cols) && re.test(t)) cols[k] = c;
    }
    if (cols.desc && cols.unit && (cols.supplyRate || cols.rate || cols.qty)) {
      if (!cols.supplyRate) splitHeader(ws, r, cols);
      return { r, cols };
    }
  }
  return null;
}

/** Two-row headers, e.g. "Rate (Rs)" over "Supply | Erection" and "Amount" over "Supply | Erection". */
function splitHeader(ws: ExcelJS.Worksheet, r: number, cols: Record<string, number>) {
  const top = ws.getRow(r), sub = ws.getRow(r + 1);
  let group = "";
  for (let c = 1; c <= Math.min(60, Math.max(top.cellCount, sub.cellCount)); c++) {
    const g = txt(top.getCell(c));
    if (g) group = g;
    const t = txt(sub.getCell(c));
    if (!t) continue;
    const supply = /^supply/i.test(t), install = /erect|install|labou?r/i.test(t);
    if (/rate/i.test(group)) {
      if (supply) cols.supplyRate = c;
      else if (install) cols.installRate = c;
    } else if (/amount/i.test(group)) {
      if (supply) cols.supplyAmt = c;
      else if (install) cols.installAmt = c;
    } else if (/^supply/i.test(group) || /erect|install|labou?r/i.test(group)) {
      // the other common layout: "SUPPLY" over "Rate | Amount", "INSTALL" over "Rate | Amount"
      const g = /^supply/i.test(group) ? "supply" : "install";
      if (/^rate/i.test(t)) cols[`${g}Rate`] = c;
      else if (/^amount/i.test(t)) cols[`${g}Amt`] = c;
    }
  }
  if (cols.supplyRate) delete cols.rate;
}

export async function parseBoq(buf: ArrayBuffer | Buffer): Promise<ParsedBoq> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  const meta: Record<string, string> = {};
  const sheets: BoqSheetMap[] = [];
  const lines: BoqLine[] = [];
  const makes: ApprovedMake[] = [];

  for (const ws of wb.worksheets) {
    // Key/value metadata in the first rows of any sheet (Summary first wins).
    for (let r = 1; r <= Math.min(12, ws.rowCount); r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= 20; c++) {
        const label = txt(row.getCell(c));
        const hit = label && META.find(([, re]) => re.test(label));
        if (!hit || meta[hit[0]]) continue;
        for (let d = c + 1; d <= c + 4; d++) {
          const v = txt(row.getCell(d));
          if (v && !META.some(([, re]) => re.test(v))) {
            meta[hit[0]] = v;
            break;
          }
        }
      }
    }

    // Approved makes sheet.
    const makeHdr = (() => {
      for (let r = 1; r <= Math.min(15, ws.rowCount); r++) {
        const row = ws.getRow(r);
        const m: number[] = [];
        let item = 0, sel = 0;
        for (let c = 1; c <= 15; c++) {
          const t = txt(row.getCell(c));
          if (/^make[-\s]?\d/i.test(t)) m.push(c);
          else if (/selected/i.test(t)) sel = c;
          else if (/^item/i.test(t)) item = c;
        }
        if (m.length && item) return { r, m, item, sel };
      }
      return null;
    })();
    if (makeHdr) {
      for (let r = makeHdr.r + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const item = txt(row.getCell(makeHdr.item));
        if (!item) continue;
        makes.push({ item, makes: makeHdr.m.map((c) => txt(row.getCell(c))).filter(Boolean), selected: makeHdr.sel ? txt(row.getCell(makeHdr.sel)) || undefined : undefined, row: r, col: makeHdr.sel || undefined, sheet: ws.name });
      }
      continue;
    }

    // BOQ sheets.
    const h = findHeader(ws);
    if (!h) continue;
    const { cols } = h;
    const qtyCol = cols.qty ?? 0;
    const floors: string[] = [];
    const floorCols: number[] = [];
    if (qtyCol > cols.unit + 1)
      for (let c = cols.unit + 1; c < qtyCol; c++) {
        const t = txt(ws.getRow(h.r).getCell(c));
        if (t) (floors.push(t), floorCols.push(c));
      }
    sheets.push({ sheet: ws.name, headerRow: h.r, floors, cols });

    let heading = "", headingCode = "";
    for (let r = h.r + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const desc = txt(row.getCell(cols.desc));
      if (!desc) continue;
      const unit = txt(row.getCell(cols.unit));
      const code = cols.code ? txt(row.getCell(cols.code)) : "";
      if (!unit || /^(units?|uom)$/i.test(unit)) {
        if (/^(sub\s*)?total/i.test(desc)) continue;
        heading = desc.split(":")[0].trim().slice(0, 90);
        headingCode = code;
        continue;
      }
      const sn = val(row.getCell(cols.sno ?? 1));
      const itemNo = typeof sn === "number" ? (Number.isInteger(sn) ? String(sn) : sn.toFixed(2)) : String(sn ?? "").trim();
      const floorQty: Record<string, number> = {};
      let qro = false;
      floorCols.forEach((c, i) => {
        const v = val(row.getCell(c));
        if (typeof v === "string" && /qro/i.test(v)) qro = true;
        const n = num(v);
        if (!isNaN(n) && n) floorQty[floors[i]] = n;
      });
      const qv = qtyCol ? val(row.getCell(qtyCol)) : null;
      if (typeof qv === "string" && /qro/i.test(qv)) qro = true;
      let qty = num(qv);
      if (isNaN(qty)) qty = Object.values(floorQty).reduce((s, n) => s + n, 0);
      const sr = cols.supplyRate ? num(val(row.getCell(cols.supplyRate))) : cols.rate ? num(val(row.getCell(cols.rate))) : NaN;
      const ir = cols.installRate ? num(val(row.getCell(cols.installRate))) : NaN;
      const ownSection = code && code !== headingCode;
      lines.push({
        sheet: ws.name,
        sourceRow: r,
        itemNo,
        section: (ownSection ? code : heading || code || ws.name).replace(/\s*:\s*$/, ""),
        description: desc,
        unit,
        qty: qro ? 0 : qty || 0,
        qro,
        floorQty,
        supplyRate: isNaN(sr) || !sr ? undefined : sr,
        installRate: isNaN(ir) || !ir ? undefined : ir,
      });
    }
  }
  return { meta, sheets, lines, makes };
}

/* ───────── context for product coding ───────── */

export type LineContext = { sl: string; heading: string; context: string; contextLines: string[]; trailing: string; group: string; section: string };

/**
 * The text around each priced line, keyed "sheet!row": its numbered heading, the description rows under
 * that heading, the unit-less rows just below it (e.g. "Motor rating : 15 KW") and its section. The
 * product-code engine needs this because the size or spec is often written outside the line itself.
 */
export async function readBoqContext(buf: ArrayBuffer | Buffer, sheets: BoqSheetMap[]) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  const out = new Map<string, LineContext>();
  for (const map of sheets) {
    const ws = wb.getWorksheet(map.sheet);
    if (!ws) continue;
    const { desc: dc, unit: uc, sno: sc = 1, code: gc } = map.cols;
    let section = "", heading = "";
    let context: string[] = [];
    let last: LineContext | null = null;
    for (let r = map.headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const desc = txt(row.getCell(dc));
      if (!desc) continue;
      const unit = txt(row.getCell(uc));
      const snv = val(row.getCell(sc));
      const sl = typeof snv === "number" ? String(Math.round(snv * 100) / 100) : String(snv ?? "").trim();
      if (/^[A-Z]$/.test(sl) || /^(units?|uom)$/i.test(unit)) {
        section = desc;
        heading = "";
        context = [];
        last = null;
        continue;
      }
      if (/^\d+$/.test(sl) || (typeof snv === "number" && Number.isInteger(snv))) {
        heading = desc;
        context = [];
        last = null;
      }
      if (unit) {
        last = { sl, heading: heading !== desc ? heading : "", context: context.join(" "), contextLines: [...context], trailing: "", group: gc ? txt(row.getCell(gc)) : "", section };
        out.set(`${map.sheet}!${r}`, last);
      } else if (last && !sl) {
        last.trailing = `${last.trailing}\n${desc}`.trim();
        context.push(desc);
      } else if (heading !== desc) context.push(desc);
    }
  }
  return out;
}

/* ───────── pricing ───────── */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]+/g, " ").replace(/\s+/g, " ").trim();
/** Library key. Long, self-describing lump-sum lines (e.g. "HVAC TAB works : Perform…") key on section + unit only. */
export function rateKey(section: string | null | undefined, description: string, unit: string) {
  const d = description.length > 80 ? "*" : norm(description);
  return `${norm(section ?? "")}|${d}|${norm(unit)}`;
}
const shape = (d: string) => norm(d).replace(/\d+(\.\d+)?/g, "#");
const primary = (d: string) => Number((d.match(/\d+(\.\d+)?/) ?? [])[0]);

export type Priced = { supplyRate: number; installRate: number; source: "library" | "estimated" } | null;

/** Exact match from the rate library, else a size-based estimate from similar items in the same section. */
export function priceLine(line: { section?: string | null; description: string; unit: string }, lib: RateItem[]): Priced {
  const key = rateKey(line.section, line.description, line.unit);
  const hit = lib.find((r) => r.key === key);
  if (hit) return { supplyRate: hit.supplyRate, installRate: hit.installRate, source: "library" };
  const sec = norm(line.section ?? "");
  const shp = shape(line.description);
  const x = primary(line.description);
  if (line.description.length > 80 || isNaN(x)) return null;
  const peers = lib.filter((r) => norm(r.section ?? "") === sec && norm(r.unit) === norm(line.unit) && shape(r.description) === shp && !isNaN(primary(r.description)));
  const xs = [...new Set(peers.map((p) => primary(p.description)))];
  if (xs.length < 2) return null;
  const lo = Math.min(...xs), hi = Math.max(...xs);
  if (x < lo * 0.5 || x > hi * 1.5) return null;
  const fit = (pick: (r: RateItem) => number) => {
    const n = peers.length, mx = peers.reduce((s, p) => s + primary(p.description), 0) / n, my = peers.reduce((s, p) => s + pick(p), 0) / n;
    const b = peers.reduce((s, p) => s + (primary(p.description) - mx) * (pick(p) - my), 0) / peers.reduce((s, p) => s + (primary(p.description) - mx) ** 2, 0);
    return Math.max(0, Math.round((my + b * (x - mx)) / 10) * 10);
  };
  return { supplyRate: fit((r) => r.supplyRate), installRate: fit((r) => r.installRate), source: "estimated" };
}

/* ───────── export ───────── */

type ExportItem = { sheet: string | null; sourceRow: number | null; supplyRate: number | null; installRate: number | null; rate: number };
type ExportQuote = { code: string; revision: number; sheets: BoqSheetMap[] | null; makes: ApprovedMake[] | null; meta: Record<string, string> | null };

/**
 * Writes rates (and selected makes) into the client's original workbook; Excel recalculates all totals on
 * open. Only those cells change - images, comments, links and formulas in the client's file are untouched.
 */
export async function fillWorkbook(original: Buffer, q: ExportQuote, items: ExportItem[]) {
  const patches: CellPatch[] = [];
  for (const it of items) {
    const map = it.sheet && it.sourceRow ? q.sheets?.find((s) => s.sheet === it.sheet) : undefined;
    if (!map) continue;
    const at = (col: number, value: number) => patches.push({ sheet: it.sheet!, row: it.sourceRow!, col, value });
    if (map.cols.supplyRate && map.cols.installRate) {
      if (it.supplyRate != null) at(map.cols.supplyRate, it.supplyRate);
      if (it.installRate != null) at(map.cols.installRate, it.installRate);
    } else if (map.cols.rate || map.cols.supplyRate) {
      at(map.cols.rate ?? map.cols.supplyRate, it.rate);
    }
  }
  for (const m of q.makes ?? []) if (m.selected && m.sheet && m.row && m.col) patches.push({ sheet: m.sheet, row: m.row, col: m.col, value: m.selected });
  return (await patchWorkbook(original, patches)).buf;
}

/** For quotations built inside the CRM: a clean workbook in the same consultant layout. */
export async function buildWorkbook(
  q: { code: string; revision: number; client: string; project: string; preparedBy: string },
  items: { itemNo?: string | null; section?: string | null; description: string; unit: string; qty: number; qro: boolean; supplyRate: number | null; installRate: number | null; rate: number }[],
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Spaceair CRM";
  const ws = wb.addWorksheet("Priced BOQ", { views: [{ state: "frozen", ySplit: 6 }] });
  const meta: [string, string][] = [["Client", q.client], ["Project", q.project], ["Doc.Ref No.", `${q.code} R${q.revision}`], ["Prepared By", q.preparedBy]];
  meta.forEach(([k, v], i) => { ws.getCell(i + 1, 1).value = k; ws.getCell(i + 1, 2).value = v; ws.getCell(i + 1, 1).font = { bold: true }; });
  const header = ["S.NO", "SECTION", "DESCRIPTION OF ITEM", "UNIT", "TOTAL QUANTITY", "SUPPLY RATE", "INSTALLATION RATE", "SUPPLY AMOUNT", "INSTALLATION AMOUNT", "TOTAL AMOUNT"];
  ws.getRow(6).values = header;
  ws.getRow(6).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(6).eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3A7266" } }));
  let r = 7;
  for (const [i, it] of items.entries()) {
    const s = it.supplyRate ?? it.rate, ins = it.installRate ?? 0;
    ws.getRow(r).values = [it.itemNo || i + 1, it.section ?? "", it.description, it.unit, it.qro ? "QRO" : it.qty, s, ins];
    ws.getCell(r, 8).value = { formula: `IF(E${r}="QRO",0,E${r}*F${r})` };
    ws.getCell(r, 9).value = { formula: `IF(E${r}="QRO",0,E${r}*G${r})` };
    ws.getCell(r, 10).value = { formula: `H${r}+I${r}` };
    r++;
  }
  ws.getCell(r, 3).value = "TOTAL";
  ws.getCell(r, 3).font = { bold: true };
  for (const c of [8, 9, 10]) ws.getCell(r, c).value = { formula: `SUM(${String.fromCharCode(64 + c)}7:${String.fromCharCode(64 + c)}${r - 1})` };
  ws.columns = [{ width: 7 }, { width: 26 }, { width: 60 }, { width: 7 }, { width: 11 }, { width: 13 }, { width: 13 }, { width: 15 }, { width: 15 }, { width: 16 }];
  for (let c = 6; c <= 10; c++) ws.getColumn(c).numFmt = "#,##,##0";
  wb.calcProperties.fullCalcOnLoad = true;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
