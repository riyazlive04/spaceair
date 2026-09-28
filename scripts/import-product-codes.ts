/**
 * Load product codes the team has already issued into the Code Register, so the CRM reuses them.
 *
 *   npm run codes:import -- "Product Code OMC - BESS.xlsx" [--project "BESS"]
 *
 * Expects SPACEAIR's product-code list layout: Product Code | Product Name | Category | HSN Code | Unit |
 * Description | Abbreviation (first sheet, header in row 1). Codes that are not 16 characters are skipped;
 * a code issued for two different products is imported once with a note, so people see the conflict.
 */
import ExcelJS from "exceljs";
import { db, schema as S } from "../src/db";

const text = (v: ExcelJS.CellValue) => {
  if (v == null) return "";
  if (typeof v === "object" && "richText" in v) return v.richText.map((r) => r.text).join("");
  if (typeof v === "object" && "result" in v) return String(v.result ?? "");
  return String(v);
};
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const pi = args.indexOf("--project");
  const project = pi >= 0 ? args[pi + 1] : file?.replace(/^.*[\\/]/, "").replace(/\.xlsx$/i, "");
  if (!file) throw new Error('Usage: npm run codes:import -- "Product Codes.xlsx" [--project NAME]');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  type Row = { code: string; name: string; cat: string; hsn: string; unit: string; desc: string; abbr: string };
  const byCode = new Map<string, Row[]>();
  const skipped: string[] = [];
  ws.eachRow((row, r) => {
    if (r === 1) return;
    const code = clean(text(row.getCell(1).value)).toUpperCase();
    if (!code) return;
    if (!/^[A-Z0-9]{16}$/.test(code)) return void skipped.push(code);
    const rec = {
      code, name: clean(text(row.getCell(2).value)).toUpperCase(), cat: clean(text(row.getCell(3).value)).toUpperCase(),
      hsn: clean(text(row.getCell(4).value)), unit: clean(text(row.getCell(5).value)), desc: text(row.getCell(6).value).trim(), abbr: text(row.getCell(7).value).trim(),
    };
    byCode.set(code, [...(byCode.get(code) ?? []), rec]);
  });

  const existing = new Set((await db.select({ code: S.productCodes.code }).from(S.productCodes)).map((p) => p.code));
  const sizeOf = (n: string) => n.replace(/SQ\.?MM|SQMT/g, "SQMM").replace(/[^A-Z0-9]/g, "");
  let added = 0, conflicts = 0;
  for (const [code, recs] of byCode) {
    if (existing.has(code)) continue;
    const names = [...new Set(recs.map((r) => r.name))];
    const distinct = [...new Set(names.map(sizeOf))];
    const note = distinct.length > 1 ? `Issued for different products: ${names.join(" / ")}` : null;
    if (note) conflicts++;
    const r = recs[0];
    await db.insert(S.productCodes).values({
      code, name: r.name || code, categoryText: r.cat, hsn: r.hsn || null, unit: r.unit || null, description: r.desc || null,
      abbreviation: r.abbr || null, source: "team", note, createdBy: null, quotationId: null,
    });
    added++;
  }
  console.log(`${project}: ${byCode.size} codes read, ${added} added to the register, ${byCode.size - added} already there.`);
  if (conflicts) console.log(`${conflicts} codes were issued for different products - marked with a note.`);
  if (skipped.length) console.log(`Skipped (not 16 characters): ${skipped.join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
