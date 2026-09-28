/* End-to-end workflow check against a running server (npm start on :3100). Mutates data: re-seed afterwards. */
import { chromium, type Page } from "playwright";
import { createClient } from "@libsql/client";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const db = createClient({ url: "file:./data/spaceair.db" });
const q1 = async (sql: string, args: (string | number)[] = []) => (await db.execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;
let failures = 0;
const check = (name: string, ok: unknown) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };

async function login(page: Page, userId: string) {
  await page.context().clearCookies();
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.evaluate(() => document.querySelector("details")?.setAttribute("open", ""));
  await page.locator(`form:has(input[value="${userId}"]) button`).first().click();
  await page.waitForURL("**/dashboard");
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on("pageerror", (e) => { console.log("PAGE ERROR", e.message); failures++; });

  // 1. Sales engineer drafts a quotation with 5% discount → routed to branch head
  await login(page, "u-karthik");
  const opp = (await q1("select id from opportunities where code='O-1044'"))!.id as string;
  await page.goto(`${BASE}/opportunities/${opp}`);
  await Promise.all([page.waitForURL("**/quotations/**"), page.getByRole("button", { name: "+ New quotation" }).click()]);
  const qid = page.url().split("/quotations/")[1];
  await page.getByLabel("Discount %").fill("5");
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await page.waitForTimeout(1500);
  let q = await q1("select status from quotations where id=?", [qid]);
  check("5% discount quotation goes to pending approval", q?.status === "pending_approval");
  const ap = await q1("select approver_role from approvals where entity_id=? order by created_at desc", [qid]);
  check("…routed to the branch head, not the Founder", ap?.approver_role === "branch_head");

  // 2. Branch head approves
  await login(page, "u-bh-che");
  await page.goto(`${BASE}/approvals`);
  const row = page.locator("div.grid", { has: page.locator(`a[href="/quotations/${qid}"]`) }).first();
  await row.getByRole("button", { name: "Approve" }).click();
  await page.waitForTimeout(1200);
  q = await q1("select status from quotations where id=?", [qid]);
  check("Branch head approval marks quotation approved", q?.status === "approved");

  // 3. Sales sends it → email in outbox, follow-up tasks, stage moves to Quotation sent
  await login(page, "u-karthik");
  await page.goto(`${BASE}/quotations/${qid}`);
  await page.getByRole("button", { name: "Send to client" }).click();
  await page.waitForTimeout(1500);
  check("Quotation emailed to client", await q1("select id from outbox where related_id=? and channel='email'", [qid]));
  check("Two follow-up tasks scheduled", Number((await q1("select count(*) n from tasks where dedupe_key like ?", [`q-fu-${qid}-%`]))?.n) === 2);
  check("Deal moved to Quotation sent", (await q1("select stage from opportunities where id=?", [opp]))?.stage === "quotation");

  // 4. PO received → project + invoice task + thank-you
  await page.goto(`${BASE}/opportunities/${opp}`);
  await page.locator('select[name="stage"]').selectOption("won");
  await page.getByRole("button", { name: "Update stage" }).click();
  await page.waitForTimeout(1500);
  check("Won deal created a project", await q1("select id from projects where opportunity_id=?", [opp]));
  check("Advance-invoice task for Accounts", await q1("select id from tasks where dedupe_key=?", [`won-inv-${opp}`]));

  // 5. Service manager logs a call for a client without AMC → chargeable, technician assigned
  await login(page, "u-prakash");
  await page.goto(`${BASE}/service/new`);
  await page.locator('select[name="accountId"]').selectOption("A11");
  await page.locator('textarea[name="issue"]').fill("RO plant low output (test)");
  await Promise.all([page.waitForURL(/\/service\/[0-9a-f-]{36}$/), page.getByRole("button", { name: "Create ticket" }).click()]);
  const tid = page.url().split("/service/")[1];
  const t = await q1("select chargeable, technician_id, status from tickets where id=?", [tid]);
  check("New ticket auto-assigned to a technician", t?.technician_id && t?.status === "assigned");
  check("No AMC → marked chargeable", Number(t?.chargeable) === 1);
  await page.getByLabel("Resolution").fill("Membrane flushed; output restored");
  await page.getByRole("button", { name: "Resolve & notify client" }).click();
  await page.waitForTimeout(1200);
  check("Feedback WhatsApp sent on resolution", await q1("select id from outbox where dedupe_key=?", [`tk-fb-${tid}`]));

  // 6. Enquiry conversion
  await login(page, "u-owner");
  const enq = (await q1("select id from enquiries where code='E-2305'"))!.id as string;
  await page.goto(`${BASE}/enquiries/${enq}`);
  await Promise.all([page.waitForURL("**/opportunities/**"), page.getByRole("button", { name: "Convert to opportunity" }).click()]);
  check("Enquiry converted to opportunity", (await q1("select status from enquiries where id=?", [enq]))?.status === "converted");

  // 7. Estimator imports a consultant BOQ (.xlsx) → auto-priced → exported back into the client's own file
  await login(page, "u-anitha");
  await page.goto(`${BASE}/quotations/import`);
  await page.setInputFiles('input[name="file"]', "public/samples/Sample-Unpriced-BOQ-HVAC.xlsx");
  await Promise.all([page.waitForURL(/\/quotations\/[0-9a-f-]{36}$/, { timeout: 60000 }), page.getByRole("button", { name: "Import & auto-price" }).click()]);
  const bq = page.url().split("/quotations/")[1];
  const cnt = await q1("select count(*) n, sum(rate_source='library') lib, sum(rate_source='estimated') est, sum(qro) qro from quote_items where quotation_id=?", [bq]);
  check(`BOQ imported: ${cnt?.n} lines, ${cnt?.qro} QRO`, Number(cnt?.n) === 17 && Number(cnt?.qro) === 3);
  check(`Auto-priced: ${cnt?.lib} from library, ${cnt?.est} estimated`, Number(cnt?.lib) >= 10 && Number(cnt?.est) >= 2);
  const bqq = await q1("select q.meta, o.consultant_id c, o.architect_id a from quotations q join opportunities o on o.id=q.opportunity_id where q.id=?", [bq]);
  check("Consultant and architect linked from the BOQ header", bqq?.c && bqq?.a && String(bqq?.meta).includes("Airtech"));
  check("Estimator review task created", await q1("select id from tasks where dedupe_key=?", [`boq-review-${bq}`]));
  const dl = await page.request.get(`${BASE}/api/quotations/${bq}/boq`);
  check("Priced BOQ downloads as .xlsx", dl.ok() && (dl.headers()["content-type"] ?? "").includes("spreadsheetml"));
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await dl.body()) as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("Ventilation BOQ")!;
  const sr = (await q1("select source_row r, supply_rate s from quote_items where quotation_id=? and rate_source='library' order by sort limit 1", [bq]))!;
  check("Rates written into the client's workbook, formulas kept", Number(ws.getRow(Number(sr.r)).getCell(8).value) === Number(sr.s) && typeof ws.getRow(Number(sr.r)).getCell(10).value === "object");
  // Priced → approved → sent teaches the rate library
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await page.waitForTimeout(1500);
  await page.reload();
  const libBefore = Number((await q1("select count(*) n from rate_items"))?.n);
  await page.getByRole("button", { name: "Send to client" }).click();
  await page.waitForTimeout(1500);
  check("Sending the quote grows the rate library", Number((await q1("select count(*) n from rate_items"))?.n) > libBefore);

  // 8. Project phase gates: finishing engineering approvals moves the project to Procurement
  await login(page, "u-gokul");
  const pj = (await q1("select id from projects where code='P-2603'"))!.id as string;
  await page.goto(`${BASE}/projects/${pj}`);
  for (const item of ["Material approvals (approved makes)", "Shop drawings approved"]) {
    await page.getByRole("button", { name: item }).click();
    await page.waitForTimeout(900);
  }
  check("Engineering done → project moves to Procurement", (await q1("select phase from projects where id=?", [pj]))?.phase === "procurement");
  check("Procurement team notified", await q1("select id from notifications where user_id='u-divya' and link=?", [`/projects/${pj}`]));

  // 9. Every main page renders without a server error
  await login(page, "u-owner");
  for (const p of ["/dashboard", "/enquiries", "/pipeline", "/clients", "/clients?tab=Consultants", "/quotations", "/quotations/import", "/quotations/rates", "/references", "/approvals", "/projects", "/amc", "/service", "/tasks", "/reports", "/automations", "/automations/messages", "/settings", "/notifications"]) {
    const res = await page.goto(BASE + p);
    check(`GET ${p} → ${res?.status()}`, res?.status() === 200);
  }
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
