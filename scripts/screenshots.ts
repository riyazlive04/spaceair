/* Captures screenshots of the running CRM (npm start on :3100) for the report. Uses the installed Chrome. */
import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import { createClient } from "@libsql/client";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = "docs/screenshots";
mkdirSync(OUT, { recursive: true });
const db = createClient({ url: "file:./data/spaceair.db" });
const idOf = async (table: string, code: string) => String((await db.execute({ sql: `select id from ${table} where code = ? order by rowid desc limit 1`, args: [code] })).rows[0]?.id);

async function shot(page: Page, name: string, path: string, opts: { full?: boolean; wait?: number } = {}) {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(opts.wait ?? 400);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: opts.full ?? false });
  console.log("✓", name);
}
async function login(page: Page, userId: string) {
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.evaluate(() => document.querySelector("details")?.setAttribute("open", ""));
  const btn = page.locator(`form:has(input[value="${userId}"]) button`).first();
  await btn.click();
  await page.waitForURL("**/dashboard");
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, colorScheme: "light" });
  const page = await ctx.newPage();

  // Public website form → live automation
  await page.goto(BASE + "/enquire", { waitUntil: "networkidle" });
  await page.fill('input[name="company"]', "Chennai One IT SEZ (sample)");
  await page.fill('input[name="contactName"]', "Vivek Raman, Facility Head");
  await page.fill('input[name="phone"]', "+91 98401 55120");
  await page.fill('input[name="email"]', "vivek@client.example");
  await page.fill('textarea[name="requirement"]', "Replace 2 × 250 TR air-cooled chillers with a VRF / water-cooled solution; budgetary quote needed in 10 days");
  await page.screenshot({ path: `${OUT}/01-website-form.png` });
  console.log("✓ 01-website-form");
  await Promise.all([page.waitForURL("**/enquire?ref=*"), page.click('button[type="submit"]')]);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/02-website-thanks.png` });
  console.log("✓ 02-website-thanks");
  const newEnq = String((await db.execute("select id from enquiries order by created_at desc limit 1")).rows[0].id);

  await shot(page, "00-login", "/login");
  await login(page, "u-owner");
  await shot(page, "03-dashboard-founder", "/dashboard", { full: true });
  await shot(page, "04-enquiries", "/enquiries");
  await shot(page, "05-enquiry-auto-assigned", `/enquiries/${newEnq}`, { full: true });
  await shot(page, "06-pipeline", "/pipeline");
  await shot(page, "07-opportunity", `/opportunities/${await idOf("opportunities", "O-1041")}`, { full: true });
  await shot(page, "08-quotation-boq", `/quotations/${await idOf("quotations", "Q-26-187")}`, { full: true });
  await shot(page, "09-quotation-print", `/quotations/${await idOf("quotations", "Q-26-187")}/print`, { full: true });
  await shot(page, "10-approvals", "/approvals", { full: true });
  await shot(page, "11-clients", "/clients");
  await shot(page, "12-client-360", "/clients/A01", { full: true });
  await shot(page, "13-projects", "/projects");
  await shot(page, "14-project-handover", `/projects/${await idOf("projects", "P-2601")}`);
  await shot(page, "15-amc", "/amc", { full: true });
  await shot(page, "16-amc-detail", `/amc/${await idOf("amc_contracts", "AMC-301")}`, { full: true });
  await shot(page, "17-service", "/service", { full: true });
  await shot(page, "18-ticket", `/service/${await idOf("tickets", "T-5502")}`, { full: true });
  await shot(page, "19-automations", "/automations", { full: true });
  await shot(page, "20-messages", "/automations/messages");
  await shot(page, "21-reports", "/reports", { full: true, wait: 1200 });
  await shot(page, "22-settings", "/settings", { full: true });
  await shot(page, "23-inbox", "/notifications");

  // Discount above the sales limit → routed to branch head (live demo of the approval matrix)
  await ctx.clearCookies();
  await login(page, "u-karthik");
  await shot(page, "24-dashboard-sales", "/dashboard", { full: true });
  await shot(page, "25-tasks-sales", "/tasks");

  await ctx.clearCookies();
  await login(page, "u-bh-blr");
  await shot(page, "26-approvals-branch-head", "/approvals");

  await ctx.clearCookies();
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await mobile.newPage();
  await login(m, "u-manoj");
  await shot(m, "27-technician-mobile", "/dashboard", { full: true });

  // Dark mode sample
  const dark = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, colorScheme: "dark" });
  const d = await dark.newPage();
  await login(d, "u-owner");
  await shot(d, "28-dashboard-dark", "/dashboard");

  await browser.close();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
