/* Builds a sample unpriced consultant BOQ (fictional project) in the standard Indian MEP layout, for demos and tests. */
import ExcelJS from "exceljs";

type Row = [section: string, desc: string, unit: string, ground: number | "QRO", first: number | "QRO"];
const SPEC: Record<string, string> = {
  "CABINET DIDW FAN FOR EXHAUST AIR": "Supply, erection, testing and commissioning of double-skin cabinet DIDW centrifugal fans with backward-curved impeller, IE3 motor, VFD-ready, complete with anti-vibration mounts and flexible connections.",
  "SISW FAN FOR KITCHEN EXHAUST AIR": "Design, supply, installation, testing and commissioning of SISW kitchen exhaust fans rated for 250 °C for 2 hours, motor out of air stream, with grease drain and access door.",
  "PERFORATED TYPE CABLE TRAY": "Supply and laying of hot-dip galvanised perforated cable trays with couplers, bends, tees and supports.",
  "MS CONDUIT": "Supply and laying of hot-dip galvanised MS conduit with accessories, surface or concealed.",
  "ELECTRICAL CABLES TERMINATION": "Supply, termination, testing and commissioning of 1.1 kV grade XLPE armoured copper cables with glands and lugs.",
  "FIRE RATED SEALANT": "",
  "DUCT LEAKAGE AND PRESSURE TESTING WORKS": "",
  "HVAC TAB WORKS": "",
};
const ROWS: Row[] = [
  ["CABINET DIDW FAN FOR EXHAUST AIR", "3500 CFM 350 Pa ESP", "Nos", 2, 0],
  ["CABINET DIDW FAN FOR EXHAUST AIR", "6200 CFM 350 Pa ESP", "Nos", 1, 1],
  ["CABINET DIDW FAN FOR EXHAUST AIR", "10600 CFM 350 Pa ESP", "Nos", 0, 2],
  ["CABINET DIDW FAN FOR EXHAUST AIR", "14000 CFM 350 Pa ESP", "Nos", "QRO", "QRO"],
  ["CABINET DIDW FAN FOR EXHAUST AIR", "20500 CFM 350 Pa ESP", "Nos", 1, 0],
  ["SISW FAN FOR KITCHEN EXHAUST AIR", "5250 CFM 300 Pa ESP", "Nos", 1, 2],
  ["SISW FAN FOR KITCHEN EXHAUST AIR", "9700 CFM 300 Pa ESP", "Nos", 0, 1],
  ["PERFORATED TYPE CABLE TRAY", "100 mm W x 50 mm H", "Rmt", 120, 90],
  ["PERFORATED TYPE CABLE TRAY", "150 mm W x 50 mm H", "Rmt", 60, 60],
  ["PERFORATED TYPE CABLE TRAY", "300 mm W x 50 mm H", "Rmt", "QRO", "QRO"],
  ["MS CONDUIT", "20 mm Dia", "Rmt", 250, 180],
  ["MS CONDUIT", "25 mm Dia", "Rmt", 80, 60],
  ["ELECTRICAL CABLES TERMINATION", "3C x 4 Sq.mm XLPE Cu. Ar. Cable", "Nos", 12, 10],
  ["ELECTRICAL CABLES TERMINATION", "3C x 10 Sq.mm XLPE Cu. Ar. Cable", "Nos", 4, 4],
  ["FIRE RATED SEALANT", "FIRE RATED SEALANT : Supply and application of 2-hour fire rated intumescent sealant around duct and cable penetrations through fire-rated walls and slabs, complete with backing rod.", "Nos", "QRO", "QRO"],
  ["DUCT LEAKAGE AND PRESSURE TESTING WORKS", "DUCT LEAKAGE AND PRESSURE TESTING WORKS : Duct leakage and pressure testing of all ductwork using a calibrated rig as per SMACNA, reports submitted to the consultant.", "Lot", 1, 1],
  ["HVAC TAB WORKS", "HVAC TAB WORKS : Testing, adjusting and balancing of all air systems by a certified agency, with final TAB report for consultant approval.", "Lot", 1, 1],
];

export async function makeSampleBoq(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Spaceair CRM sample";
  const sum = wb.addWorksheet("Summary");
  const meta: [string, string, string, string][] = [
    ["Project Name & Location", "Sunrise Food Court, Madurai (sample)", "Doc.Ref No.", "SMP-HVAC-01"],
    ["Client", "Sunrise Food Court (sample)", "Revision No", "R0"],
    ["Architect", "Studio Lines Architects (sample)", "Initial Date", "15.09.2026"],
    ["MEP Consultant", "Airtech MEP Consultants (sample)", "Prepared By", "Consultant team"],
    ["Document", "HVAC - BOQ", "Reviewed By", "—"],
    ["Service", "HVAC", "Approved By", "—"],
  ];
  meta.forEach(([a, b, c, d], i) => sum.getRow(i + 1).values = [a, b, , , , , c, d]);
  sum.getRow(8).values = ["S.No", "Descriptions", "Supply Amount (INR)", "Installation Amount (INR)", "Total Amount (INR)"];
  sum.getRow(9).values = [1, "Ventilation BOQ"];

  const ws = wb.addWorksheet("Ventilation BOQ");
  ws.getCell("A1").value = "Client"; ws.getCell("B1").value = meta[1][1];
  ws.getCell("A2").value = "Architect"; ws.getCell("B2").value = meta[2][1];
  ws.getCell("A3").value = "HVAC Consultant"; ws.getCell("B3").value = meta[3][1];
  ws.getRow(6).values = ["S.NO", "ITEM CODE", "DESCRIPTION OF ITEM", "UNIT", "Ground Floor", "First Floor", "TOTAL QUANTITY", "SUPPLY RATE", "INSTALLATION RATE", "SUPPLY AMOUNT", "INSTALLATION AMOUNT", "TOTAL AMOUNT"];
  ws.getRow(6).font = { bold: true };
  ws.getRow(7).values = [, , , , , , , "INR", "INR", "INR", "INR", "INR"];
  let r = 8, sec = "", n = 0, sub = 0;
  for (const [section, desc, unit, g, f] of ROWS) {
    if (section !== sec) {
      sec = section; n++; sub = 0;
      if (SPEC[section]) {
        ws.getRow(r).values = [n, section, `${section} : ${SPEC[section]}`];
        r++;
      }
    }
    const own = !SPEC[section];
    sub++;
    const qro = g === "QRO";
    ws.getRow(r).values = [own ? n : Number(`${n}.${String(sub).padStart(2, "0")}`), section, desc, unit, qro ? null : g || null, qro ? null : f || null, qro ? "QRO" : undefined];
    if (!qro) ws.getCell(r, 7).value = { formula: `E${r}+F${r}` };
    ws.getCell(r, 10).value = { formula: `IF(G${r}="QRO",0,G${r}*H${r})` };
    ws.getCell(r, 11).value = { formula: `IF(G${r}="QRO",0,G${r}*I${r})` };
    ws.getCell(r, 12).value = { formula: `J${r}+K${r}` };
    r++;
  }
  ws.getCell(r, 3).value = "TOTAL VALUE OF HVAC WORKS";
  for (const c of ["J", "K", "L"]) ws.getCell(`${c}${r}`).value = { formula: `SUM(${c}8:${c}${r - 1})` };
  ws.columns = [{ width: 7 }, { width: 24 }, { width: 70 }, { width: 7 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 13 }, { width: 13 }, { width: 14 }, { width: 14 }, { width: 15 }];
  sum.getCell("C9").value = { formula: `'Ventilation BOQ'!J${r}` };
  sum.getCell("D9").value = { formula: `'Ventilation BOQ'!K${r}` };
  sum.getCell("E9").value = { formula: "C9+D9" };

  const mk = wb.addWorksheet("HVAC Approved Makes");
  mk.getRow(1).values = ["S.NO", "ITEM", "MAKE-1", "MAKE-2", "MAKE-3", "MAKE SELECTED BY VENDOR"];
  [["Ventilation Fans", "Kruger", "Nicotra", "Systemair"], ["Cable Trays", "Profab", "Pushpak", "HBS"], ["Electrical Cables", "KEI", "Polycab", "RR Kabel"], ["Conduits", "Precision", "Prince", "VIP"], ["Fire Sealant", "Hilti", "3M", "Promat"]].forEach((m, i) => (mk.getRow(i + 2).values = [i + 1, ...m]));
  wb.calcProperties.fullCalcOnLoad = true;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

if (process.argv[1]?.endsWith("sample-boq.ts")) {
  import("node:fs").then(async ({ mkdirSync, writeFileSync }) => {
    mkdirSync("public/samples", { recursive: true });
    writeFileSync("public/samples/Sample-Unpriced-BOQ-HVAC.xlsx", await makeSampleBoq());
    console.log("Wrote public/samples/Sample-Unpriced-BOQ-HVAC.xlsx");
  });
}
