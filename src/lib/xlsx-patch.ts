/**
 * Write values into specific cells of an existing .xlsx without re-building the workbook.
 *
 * Consultant BOQs carry images, OLE objects, comments, external links and years of stale named ranges.
 * Loading and re-saving them through a spreadsheet library drops some of those parts, and Excel can then
 * refuse to open the result. Here only the touched cells change; every other byte of the file is kept.
 */
import JSZip from "jszip";

export type CellPatch = { sheet: string; row: number; col: number; value: number | string };

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

export function colLetter(n: number) {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
const colNumber = (ref: string) => [...ref.replace(/\d+$/, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

/** sheet name -> part path, e.g. "BOQ HVAC" -> "xl/worksheets/sheet2.xml" */
async function sheetPaths(zip: JSZip) {
  const wb = await zip.file("xl/workbook.xml")!.async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id"), t = attr(m[0], "Target");
    if (id && t) target.set(id, t.startsWith("/") ? t.slice(1) : `xl/${t}`);
  }
  const out = new Map<string, string>();
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], "name"), id = attr(m[0], "r:id");
    if (name && id && target.has(id)) out.set(decode(name), target.get(id)!);
  }
  return out;
}

function cellXml(ref: string, style: string | undefined, value: number | string) {
  const s = style ? ` s="${style}"` : "";
  return typeof value === "number"
    ? `<c r="${ref}"${s}><v>${value}</v></c>`
    : `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
}

/** Apply all patches for one row; returns the new row XML (or null to leave it unchanged). */
function patchRow(rowXml: string, rowNo: number, patches: CellPatch[], skipped: string[]) {
  let open = rowXml.match(/^<row\b[^>]*?\/?>/)![0];
  let body = open.endsWith("/>") ? "" : rowXml.slice(open.length, rowXml.length - "</row>".length);
  if (open.endsWith("/>")) open = open.slice(0, -2) + ">";
  open = open.replace(/\sspans="[^"]*"/, ""); // optional hint; would be stale once cells are added
  for (const p of patches) {
    const ref = `${colLetter(p.col)}${rowNo}`;
    const existing = body.match(new RegExp(`<c\\b[^>]*\\sr="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`));
    if (existing) {
      // never break a shared formula's master cell - other cells depend on it
      if (/<f\b[^>]*\bt="shared"[^>]*\bref="/.test(existing[0])) {
        skipped.push(ref);
        continue;
      }
      const tag = existing[0].match(/^<c\b[^>]*?\/?>/)![0];
      body = body.replace(existing[0], cellXml(ref, attr(tag, "s"), p.value));
    } else {
      // keep cells in column order
      const after = [...body.matchAll(/<c\b[^>]*\sr="([A-Z]+)\d+"/g)].find((m) => colNumber(m[1]) > p.col);
      body = after ? body.slice(0, after.index) + cellXml(ref, undefined, p.value) + body.slice(after.index) : body + cellXml(ref, undefined, p.value);
    }
  }
  return `${open}${body}</row>`;
}

function patchSheet(xml: string, patches: CellPatch[], skipped: string[]) {
  const byRow = new Map<number, CellPatch[]>();
  for (const p of patches) byRow.set(p.row, [...(byRow.get(p.row) ?? []), p]);
  if (/<sheetData\s*\/>/.test(xml)) xml = xml.replace(/<sheetData\s*\/>/, "<sheetData></sheetData>");
  for (const [rowNo, ps] of [...byRow].sort((a, b) => a[0] - b[0])) {
    const row = xml.match(new RegExp(`<row\\b[^>]*\\sr="${rowNo}"[^>]*?(?:/>|>[\\s\\S]*?</row>)`));
    if (row) {
      xml = xml.replace(row[0], patchRow(row[0], rowNo, ps, skipped));
    } else {
      const fresh = patchRow(`<row r="${rowNo}"></row>`, rowNo, ps, skipped);
      const next = [...xml.matchAll(/<row\b[^>]*\sr="(\d+)"/g)].find((m) => Number(m[1]) > rowNo);
      xml = next ? xml.slice(0, next.index) + fresh + xml.slice(next.index) : xml.replace("</sheetData>", `${fresh}</sheetData>`);
    }
  }
  return xml;
}

export async function patchWorkbook(original: Buffer, patches: CellPatch[]) {
  const zip = await JSZip.loadAsync(original);
  const paths = await sheetPaths(zip);
  const skipped: string[] = [];
  const bySheet = new Map<string, CellPatch[]>();
  for (const p of patches) bySheet.set(p.sheet, [...(bySheet.get(p.sheet) ?? []), p]);
  for (const [sheet, ps] of bySheet) {
    const path = paths.get(sheet);
    const file = path && zip.file(path);
    if (!file) continue;
    zip.file(path, patchSheet(await file.async("string"), ps, skipped));
  }

  // The calculation chain lists formula cells; drop it (Excel rebuilds it) and recalculate on open.
  if (zip.file("xl/calcChain.xml")) {
    zip.remove("xl/calcChain.xml");
    const ct = await zip.file("[Content_Types].xml")!.async("string");
    zip.file("[Content_Types].xml", ct.replace(/<Override\b[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ""));
    const rels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
    zip.file("xl/_rels/workbook.xml.rels", rels.replace(/<Relationship\b[^>]*Target="[^"]*calcChain\.xml"[^>]*\/>/, ""));
  }
  let wb = await zip.file("xl/workbook.xml")!.async("string");
  if (/<calcPr\b/.test(wb)) wb = wb.replace(/<calcPr\b([^>]*?)(\s*\/?>)/, (_, a: string, end: string) => `<calcPr${a.replace(/\sfullCalcOnLoad="[^"]*"/, "")} fullCalcOnLoad="1"${end}`);
  else {
    const anchor = ["</definedNames>", "</externalReferences>", "</sheets>"].find((t) => wb.includes(t))!;
    wb = wb.replace(anchor, `${anchor}<calcPr fullCalcOnLoad="1"/>`);
  }
  zip.file("xl/workbook.xml", wb);

  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { buf, skipped };
}
