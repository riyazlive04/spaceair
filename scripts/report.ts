/* Builds docs/Spaceair-CRM-Report.pdf from docs/report.html + docs/screenshots (run `npm run screenshots` first). */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RULES } from "../src/lib/automation/rules";

const ver = (p: string) => JSON.parse(readFileSync(`node_modules/${p}/package.json`, "utf8")).version as string;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const e2e = existsSync("docs/e2e-results.txt") ? readFileSync("docs/e2e-results.txt", "utf8").split("\n").filter((l) => /^(PASS|FAIL)/.test(l)) : [];
const passed = e2e.filter((l) => l.startsWith("PASS")).length;
const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

const shot = (file: string, title: string, text: string, tall = false) => `
  <figure class="shot${tall ? " tall" : ""}">
    <figcaption><b>${title}</b><span>${text}</span></figcaption>
    <img src="screenshots/${file}.png" alt="${esc(title)}">
  </figure>`;

const TECH: [string, string, string, string][] = [
  ["Framework", "Next.js", ver("next"), "App Router, React Server Components, Server Actions, Turbopack builds, instrumentation hook for the scheduler"],
  ["UI library", "React", ver("react"), "Server + client components; useOptimistic for instant drag-and-drop on the pipeline"],
  ["Language", "TypeScript", ver("typescript"), "Strict mode end to end: schema, queries, actions and UI share types"],
  ["Styling", "Tailwind CSS", ver("tailwindcss"), "v4 CSS-first theme tokens; light and dark themes; responsive down to phone width"],
  ["Database", "SQLite via libSQL", ver("@libsql/client"), "Zero-setup local file database; the same driver connects to Turso (hosted libSQL) in production"],
  ["ORM", "Drizzle ORM + Drizzle Kit", `${ver("drizzle-orm")} / ${ver("drizzle-kit")}`, "Type-safe schema and queries; `drizzle-kit push` creates tables; portable to PostgreSQL"],
  ["Validation", "Zod", ver("zod"), "Validates every form, the quotation editor payload and the public enquiry API"],
  ["Auth / sessions", "jose (JWT)", ver("jose"), "Signed, HTTP-only session cookie; role- and branch-scoped access. Swap-in point for Microsoft 365 / Google SSO"],
  ["Scheduler", "node-cron", ver("node-cron"), "Runs time-based automation rules every 15 minutes inside the Next.js server"],
  ["Charts", "Recharts", ver("recharts"), "Interactive report charts with tooltips, themed from the same design tokens"],
  ["Icons", "Lucide", ver("lucide-react"), "Consistent open-source icon set"],
  ["Fonts", "Archivo, IBM Plex Sans / Mono", "Google Fonts", "Loaded and self-hosted through next/font"],
  ["Testing & capture", "Playwright", ver("playwright"), "End-to-end workflow tests, screenshots and this PDF, driving the installed Chrome"],
  ["Tooling", "tsx, ESLint", ver("tsx"), "Runs seed / test / report scripts in TypeScript; linting"],
];

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Spaceair CRM – Solution Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..100,500..800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 16mm 14mm 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font: 10pt/1.5 "IBM Plex Sans", "Segoe UI", sans-serif; color: #13222b; margin: 0; }
  h1, h2, h3 { font-family: "Archivo", "Arial Narrow", sans-serif; font-stretch: 86%; margin: 0; text-wrap: balance; }
  h2 { font-size: 19pt; margin: 0 0 8pt; padding-top: 2pt; }
  h2 small { display: block; font: 600 8pt/1 "IBM Plex Mono", monospace; letter-spacing: .1em; color: #0a6f8c; margin-bottom: 6pt; }
  h3 { font-size: 12pt; margin: 12pt 0 4pt; }
  p { margin: 0 0 7pt; max-width: 170mm; }
  ul, ol { margin: 0 0 8pt; padding-left: 16pt; }
  li { margin-bottom: 2.5pt; }
  .mono { font-family: "IBM Plex Mono", monospace; font-size: 8.5pt; }
  .muted { color: #5d6e77; }
  section { page-break-before: always; }
  .cover { height: 262mm; display: flex; flex-direction: column; justify-content: space-between; page-break-before: auto; }
  .brand { font: 800 30pt/1 "Archivo", sans-serif; font-stretch: 78%; letter-spacing: .04em; }
  .brand span, .accent { color: #0a6f8c; }
  .cover h1 { font-size: 34pt; line-height: 1.05; margin-top: 30mm; max-width: 160mm; }
  .cover .lede { font-size: 12pt; color: #44555e; max-width: 150mm; margin-top: 8mm; }
  .cover .meta { border-top: 2px solid #0a6f8c; padding-top: 5mm; display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; font-size: 9pt; }
  .cover .meta b { display: block; font-size: 8pt; text-transform: uppercase; letter-spacing: .08em; color: #5d6e77; font-weight: 600; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin: 4mm 0 5mm; }
  .kpi { border: 1px solid #d3dcdb; border-radius: 6px; padding: 3mm; }
  .kpi b { display: block; font: 700 18pt/1.1 "Archivo", sans-serif; font-stretch: 85%; }
  .kpi span { font-size: 8pt; color: #5d6e77; }
  table { width: 100%; border-collapse: collapse; font-size: 8.6pt; margin: 3mm 0 5mm; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  th { text-align: left; background: #e7edec; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .05em; color: #44555e; padding: 5pt 6pt; }
  td { border-bottom: 1px solid #d3dcdb; padding: 5pt 6pt; vertical-align: top; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
  .box { border: 1px solid #d3dcdb; border-radius: 6px; padding: 4mm; page-break-inside: avoid; }
  .box.accent-b { border-top: 3px solid #0a6f8c; }
  .flow { display: flex; flex-wrap: wrap; gap: 2mm; align-items: center; margin: 3mm 0 5mm; font-size: 8.5pt; }
  .flow span.s { border: 1px solid #d3dcdb; border-radius: 4px; padding: 2mm 2.5mm; background: #f4f7f6; }
  .flow span.a { color: #7e9098; }
  figure.shot { margin: 0 0 6mm; page-break-inside: avoid; }
  figure.shot figcaption { margin-bottom: 2mm; }
  figure.shot figcaption b { font: 700 11pt "Archivo", sans-serif; font-stretch: 88%; display: block; }
  figure.shot figcaption span { color: #44555e; font-size: 9pt; }
  figure.shot img { width: 100%; max-height: 118mm; object-fit: contain; object-position: left top; border: 1px solid #d3dcdb; border-radius: 4px; display: block; }
  figure.shot.tall img { max-height: 225mm; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; }
  .arch { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; margin: 3mm 0 5mm; font-size: 8.6pt; }
  .arch div { border: 1px solid #d3dcdb; border-radius: 6px; padding: 3mm; }
  .arch div b { display: block; color: #0a6f8c; margin-bottom: 1mm; }
  .pass { color: #2c7a4b; font-weight: 600; }
  .fail { color: #b83227; font-weight: 600; }
  code, pre { font-family: "IBM Plex Mono", monospace; font-size: 8.5pt; }
  pre { background: #f0f4f3; border-radius: 4px; padding: 3mm; white-space: pre-wrap; margin: 2mm 0 4mm; }
  .tag { display: inline-block; font-size: 7.5pt; font-weight: 600; padding: 0 5pt; border-radius: 8pt; background: #dcedf2; color: #0a6f8c; }
</style></head><body>

<div class="cover">
  <div class="brand">SPACE<span>AIR</span> CRM</div>
  <div>
    <h1>A CRM that runs on process, not on the Founder</h1>
    <p class="lede">Solution report for the SPACEAIR CRM: business analysis, what was built, how the automations reduce owner dependency, the technology used, and screenshots of the working application.</p>
  </div>
  <div class="meta">
    <div><b>Prepared for</b>SPACEAIR – MEP Contracting<br>Chennai · Bangalore · Hyderabad · Renigunta · Colombo</div>
    <div><b>Prepared by</b>Sirah Digital<br>AI &amp; Automation</div>
    <div><b>Date · status</b>${today}<br>Working build, running locally, with sample data</div>
  </div>
</div>

<section>
  <h2><small>01 · EXECUTIVE SUMMARY</small>What we built</h2>
  <p>SPACEAIR has grown from 10 people in 2007 to roughly 200 across five locations and four MEP disciplines. Today, enquiries, quotations, AMC renewals and service complaints depend heavily on individuals, and many decisions and follow-ups still route through the Founder. This CRM replaces that with one shared system, a <b>delegation-of-authority matrix</b>, and an <b>automation engine</b> that does the chasing.</p>
  <div class="kpis">
    <div class="kpi"><b>13</b><span>modules, from enquiry to AMC renewal</span></div>
    <div class="kpi"><b>${RULES.length}</b><span>automation rules, each can be paused or tuned</span></div>
    <div class="kpi"><b>7</b><span>roles with branch-scoped access</span></div>
    <div class="kpi"><b>${passed}/${e2e.length}</b><span>end-to-end workflow checks passing</span></div>
  </div>
  <h3>How it reduces owner dependency</h3>
  <ul>
    <li><b>Decisions are delegated by rule.</b> Sales engineers self-approve discounts up to 3%, branch heads up to 8%, and only larger discounts or deals of ₹5 Cr and above reach the Founder. On the sample data, <b>over 90% of approvals never touch the Founder</b>.</li>
    <li><b>Work is assigned automatically.</b> New enquiries go to the right engineer, service calls go to the least-loaded technician, a won PO goes to the Projects handover, and renewals go to the account owner.</li>
    <li><b>Follow-ups are chased by the system, not by phone.</b> Response deadlines, overdue follow-ups, stale deals, pending approvals and SLA breaches escalate one level at a time: the person, then the branch head, and the Founder only as a last resort.</li>
    <li><b>Recurring revenue is protected.</b> AMC renewal quotations go out automatically 60 days before expiry, and PPM visits are planned and tracked.</li>
    <li><b>Visibility comes from exceptions.</b> The Founder gets one daily digest listing only what needs them, plus live dashboards and reports with no Excel MIS.</li>
  </ul>
  <h3>What was delivered</h3>
  <ul>
    <li>A complete, working web application (Next.js 16 + TypeScript + SQLite) that runs locally with one command, with realistic sample data.</li>
    <li>An automation engine with ${RULES.length} rules, a 15-minute scheduler and a full audit log of every automated action and client message.</li>
    <li>A public website enquiry form and a REST API for integrations (website, WhatsApp relay, IndiaMART, tender alerts).</li>
    <li>Automated end-to-end tests, and this report generated from the running application.</li>
  </ul>
</section>

<section>
  <h2><small>02 · BUSINESS ANALYSIS</small>Context, problems and users</h2>
  <div class="two">
    <div class="box">
      <h3 style="margin-top:0">SPACEAIR at a glance</h3>
      <ul>
        <li>MEP contractor: HVAC &amp; life safety, electrical (Class I), plumbing / PHE, retrofit, AMC and operations.</li>
        <li>HQ Chennai; branches in Bangalore, Hyderabad, Renigunta and Colombo (Sri Lanka).</li>
        <li>B2B clients: IT parks, data centres, automotive plants, pharma, retail chains, co-working spaces.</li>
        <li>LG System Air-Conditioning authorised dealer; about 200 people.</li>
      </ul>
    </div>
    <div class="box">
      <h3 style="margin-top:0">Problems the CRM addresses</h3>
      <ul>
        <li>Enquiries scattered across calls, WhatsApp, email, website, tenders and dealer leads, with no response tracking.</li>
        <li>No single branch-wise view of pipeline, win rate or order book.</li>
        <li>BOQ quotations and revisions kept in Excel and email.</li>
        <li>AMC renewals missed, so recurring revenue leaks.</li>
        <li>Service complaints on WhatsApp with no SLA measurement.</li>
        <li>Approvals and follow-ups bottlenecked on the Founder.</li>
      </ul>
    </div>
  </div>
  <h3>Lead-to-renewal flow covered</h3>
  <div class="flow">
    <span class="s">Enquiry</span><span class="a">→</span><span class="s">Qualify</span><span class="a">→</span><span class="s">Site survey</span><span class="a">→</span><span class="s">BOQ &amp; design</span><span class="a">→</span><span class="s">Quotation R0…Rn</span><span class="a">→</span><span class="s">Approval</span><span class="a">→</span><span class="s">Negotiation</span><span class="a">→</span><span class="s">PO / LOI</span><span class="a">→</span><span class="s">Project handover</span><span class="a">→</span><span class="s">AMC + PPM</span><span class="a">→</span><span class="s">Service tickets</span><span class="a">→</span><span class="s">Renewal / retrofit</span>
  </div>
  <h3>Users and what each gets</h3>
  <table>
    <tr><th>Role</th><th>Sees</th><th>Main benefit</th></tr>
    <tr><td>Founder / MD</td><td>All branches, exceptions only</td><td>Dashboard, owner-only approvals, daily exception digest, reports</td></tr>
    <tr><td>Branch head</td><td>Own branch</td><td>Pipeline, mid-level approvals, escalations, branch digest</td></tr>
    <tr><td>Sales engineer</td><td>Own enquiries &amp; deals</td><td>Auto-assigned enquiries, reminders, BOQ quotes, self-approval up to limit</td></tr>
    <tr><td>Estimation engineer</td><td>Pipeline &amp; quotations</td><td>BOQ templates by division, revision history</td></tr>
    <tr><td>Service manager</td><td>Tickets, AMC, visits</td><td>Auto-dispatch, SLA ladder, PPM planner, chargeable-call alerts</td></tr>
    <tr><td>Technician</td><td>Own jobs (mobile)</td><td>Job list ordered by SLA, PPM visits, one-tap resolve</td></tr>
    <tr><td>Accounts</td><td>All branches</td><td>Advance-invoice tasks on every PO, AMC values</td></tr>
  </table>
</section>

<section>
  <h2><small>03 · SOLUTION</small>Modules</h2>
  <table>
    <tr><th style="width:24%">Module</th><th>What it does</th></tr>
    <tr><td><b>Dashboard</b></td><td>Role-aware. KPIs for pipeline, orders, enquiries, AMC renewals and SLA; approvals waiting; alerts; tasks; live automation feed. Technicians get a mobile job list.</td></tr>
    <tr><td><b>Enquiries</b></td><td>One queue for every source; auto-assignment and acknowledgement; response-time tracking; log response, re-assign, disqualify, or convert to an opportunity in one click.</td></tr>
    <tr><td><b>Pipeline</b></td><td>Drag-and-drop kanban with MEP stages (Qualified → Site survey → BOQ &amp; design → Quotation sent → Negotiation → PO received / Lost). Lost deals require a reason.</td></tr>
    <tr><td><b>Opportunity</b></td><td>Stage tracker, value and weighted value, tonnage, next action and owner, quotations, tasks, contacts and full activity timeline.</td></tr>
    <tr><td><b>Clients</b></td><td>Client 360: contacts, opportunities, AMCs, service history, projects, lifetime value, and an "AMC upsell" flag.</td></tr>
    <tr><td><b>Quotations</b></td><td>BOQ line-item editor with live totals, discount and GST 18%. Revisions R0…Rn with history, approval routing preview, send to client, and a printable quotation.</td></tr>
    <tr><td><b>Approvals</b></td><td>Delegation matrix in action: pending approvals for the right person, decision history, and a "handled without Founder" metric.</td></tr>
    <tr><td><b>Projects</b></td><td>Created automatically from won POs, with a sales → projects → accounts handover checklist, progress and tasks.</td></tr>
    <tr><td><b>AMC contracts</b></td><td>Register with expiry countdown, automatic renewal quotations, lapse detection, and a planned PPM visit schedule with technician assignment.</td></tr>
    <tr><td><b>Service tickets</b></td><td>P1/P2/P3 SLA clock, AMC coverage check, auto-dispatch, escalation ladder, resolution and client feedback.</td></tr>
    <tr><td><b>Tasks &amp; Inbox</b></td><td>Personal and team task lists (most auto-created) and a notification inbox routed by role and branch.</td></tr>
    <tr><td><b>Automations</b></td><td>All rules with on/off switches, editable thresholds, run counts, a run log, and every WhatsApp/email sent on the team's behalf.</td></tr>
    <tr><td><b>Reports &amp; Settings</b></td><td>Branch performance, lead sources, lost reasons, SLA by branch, sales scorecard. Settings hold the delegation matrix, SLA policy, escalation ladder and users.</td></tr>
  </table>
  <h3>Integrations included</h3>
  <ul>
    <li><b>Public website form</b> at <code>/enquire</code>, ready to embed on spaceair.in/contactus.</li>
    <li><b>REST API</b> <code>POST /api/enquiries</code> with an API key, for a WhatsApp Business webhook relay, IndiaMART, tender alerts or any other lead source. New enquiries go straight through the automation engine.</li>
    <li><b>Outbox</b> for WhatsApp and email. Messages are composed and logged, ready to connect to the WhatsApp Business Cloud API and a transactional email provider.</li>
  </ul>
</section>

<section>
  <h2><small>04 · OWNER DEPENDENCY</small>Delegation and escalation, by design</h2>
  <p>The Founder sets the policy once in <b>Settings</b>. After that, the team and the automation engine apply it, and problems climb one level at a time.</p>
  <table>
    <tr><th>Situation</th><th>Level 1</th><th>Level 2</th><th>Founder</th></tr>
    <tr><td>New enquiry not answered</td><td>Assigned engineer: task with 4 h deadline</td><td>Branch head alerted at 4 h; auto re-assigned at 24 h</td><td>Daily digest only</td></tr>
    <tr><td>Follow-up overdue</td><td>Deal owner, daily reminder</td><td>Branch head after 3 days</td><td>Not involved</td></tr>
    <tr><td>Discount on a quotation</td><td>≤ 3%: auto-approved</td><td>≤ 8%: branch head</td><td>&gt; 8% or deal ≥ ₹5 Cr</td></tr>
    <tr><td>Approval left pending</td><td>Reminder to approver at 12 h</td><td>Branch-head approvals escalate at 48 h</td><td>Only after escalation</td></tr>
    <tr><td>Service ticket SLA</td><td>Technician + service manager at 75%</td><td>Branch head on breach</td><td>Only a P1 open for 2× its SLA</td></tr>
    <tr><td>AMC expiring</td><td>Renewal quote auto-emailed at 60 d; owner task</td><td>Reminder at 30 d; branch head at 7 d</td><td>Digest if lapsed</td></tr>
    <tr><td>PO received</td><td>Project, kick-off task, invoice task, client thank-you</td><td>—</td><td>Informed only for deals ≥ ₹5 Cr</td></tr>
  </table>
  <p>All limits and timings are editable, so the matrix can be tightened or loosened as branch heads grow into the role. The <b>Reports</b> page tracks "Decisions needing the Founder" as a KPI, with a target of under 10%.</p>
  ${shot("22-settings", "Settings: delegation matrix, SLA policy and escalation ladder", "The Founder's only recurring job in the system: setting the limits.", true)}
</section>

<section>
  <h2><small>05 · AUTOMATIONS</small>The ${RULES.length} rules</h2>
  <p>Each rule runs either on an event (for example, a new enquiry) or on the 15-minute schedule. Every action is idempotent, so running a rule twice never duplicates a task or a message, and every run is logged.</p>
  <table>
    <tr><th style="width:20%">Rule</th><th style="width:11%">Area</th><th style="width:21%">Trigger</th><th>What it does</th></tr>
    ${RULES.map((r) => `<tr><td><b>${esc(r.name)}</b></td><td>${r.category}</td><td>${esc(r.trigger)}</td><td>${esc(r.description)}</td></tr>`).join("")}
  </table>
</section>

<section>
  <h2><small>06 · WALKTHROUGH</small>The application, screen by screen</h2>
  <p class="muted">All screenshots were captured automatically from the running application with Playwright. All client names, people and figures are sample data.</p>
  ${shot("00-login", "Sign-in by role", "Each role sees its own branch, queue and approvals. Production would use Microsoft 365 / Google SSO.")}
  ${shot("03-dashboard-founder", "Founder dashboard", "KPIs across branches, the one approval that genuinely needs the Founder, alerts, and a live feed of what the automation engine did.", true)}
</section>
<section>
  <h3>Website enquiry → automatic assignment and acknowledgement</h3>
  <div class="pair">
    ${shot("01-website-form", "1. Public website form", "A client submits a requirement on the website.")}
    ${shot("02-website-thanks", "2. Instant confirmation", "The enquiry reference is shown immediately.")}
  </div>
  ${shot("05-enquiry-auto-assigned", "3. Inside the CRM, seconds later", "Auto-assigned to the least-loaded Chennai engineer, a first-response task is created, and a WhatsApp with the engineer's name and number is sent to the client. Nobody had to forward anything.")}
  ${shot("04-enquiries", "Enquiry queue", "Every source in one list; anything unanswered after 4 hours is flagged red and escalated.")}
</section>
<section>
  ${shot("06-pipeline", "Pipeline kanban", "Drag a deal between MEP stages. Moving it to “PO received” triggers the project handover automatically.")}
  ${shot("07-opportunity", "Opportunity", "Stage, value, next action and owner, quotations, tasks and the full timeline, including automation entries.", true)}
</section>
<section>
  ${shot("08-quotation-boq", "BOQ quotation with revisions", "Line items, live totals with GST, and revision history. While drafting, the editor shows who will need to approve the discount.")}
  ${shot("09-quotation-print", "Printable quotation", "Branded quotation ready to print or save as PDF.", true)}
</section>
<section>
  ${shot("10-approvals", "Approvals under the delegation matrix", "Auto-approved, branch head and Founder decisions, with the share handled without the Founder.", true)}
  ${shot("26-approvals-branch-head", "The Bangalore branch head's view", "A 6% discount lands with the branch head, not the Founder.")}
</section>
<section>
  ${shot("11-clients", "Clients", "Pipeline, orders, AMC value and open tickets per client; clients without an AMC are flagged as an upsell.")}
  ${shot("12-client-360", "Client 360", "Everything about a client on one page, so any team member can pick up the relationship.", true)}
</section>
<section>
  ${shot("13-projects", "Projects", "Created automatically from won POs.")}
  ${shot("14-project-handover", "Handover checklist", "Sales → Projects → Accounts handover, with automatically created kick-off and advance-invoice tasks.")}
</section>
<section>
  ${shot("15-amc", "AMC contracts", "Renewal quotations generated automatically at 60 days, lapsed contracts flagged, PPM visit progress shown.", true)}
</section>
<section>
  ${shot("16-amc-detail", "AMC detail and PPM schedule", "Visits planned for the contract year and assigned to a technician; missed visits are flagged to the service manager.", true)}
</section>
<section>
  ${shot("17-service", "Service tickets", "SLA clock by priority, AMC coverage, escalation level and technician, ordered by urgency.", true)}
</section>
<section>
  ${shot("18-ticket", "Ticket detail", "SLA meter, coverage check, messages sent to the client, and the escalation trail.", true)}
</section>
<section>
  ${shot("19-automations", "Automation control centre", "Every rule with an on/off switch, editable thresholds, action counts and the run log.", true)}
</section>
<section>
  ${shot("20-messages", "Messages sent on the team's behalf", "Every WhatsApp and email the CRM sent: acknowledgements, quotation emails, reminders, renewal quotes and digests.")}
  ${shot("23-inbox", "Inbox", "Alerts routed by role and branch.")}
</section>
<section>
  ${shot("21-reports", "Reports", "Branch performance, who decides, lead sources, automation workload, lost reasons, SLA by branch and sales scorecard. No Excel MIS.", true)}
</section>
<section>
  ${shot("24-dashboard-sales", "Sales engineer's dashboard", "Their own pipeline, enquiries and auto-created tasks.", true)}
</section>
<section>
  ${shot("25-tasks-sales", "Tasks", "Most tasks are created by automations, so nobody has to remember to assign work.")}
  <div class="pair">
    ${shot("27-technician-mobile", "Technician on mobile", "Jobs ordered by SLA and upcoming PPM visits.", true)}
    ${shot("28-dashboard-dark", "Dark mode", "Every screen supports light and dark themes.")}
  </div>
</section>

<section>
  <h2><small>07 · TECHNOLOGY</small>Technologies used</h2>
  <table>
    <tr><th style="width:15%">Layer</th><th style="width:20%">Technology</th><th style="width:11%">Version</th><th>Role in the CRM</th></tr>
    ${TECH.map(([l, t, v, r]) => `<tr><td>${l}</td><td><b>${t}</b></td><td class="mono">${v}</td><td>${esc(r)}</td></tr>`).join("")}
    <tr><td>Runtime</td><td><b>Node.js</b></td><td class="mono">${process.versions.node}</td><td>Server runtime (Next.js 16 requires 20.9+)</td></tr>
  </table>
  <h3>Architecture</h3>
  <div class="arch">
    <div><b>Presentation</b>React Server Components render pages on the server with data already loaded. Small client components handle the kanban, BOQ editor, charts and forms.</div>
    <div><b>Application</b>Server Actions for every mutation (validated with Zod). Each action emits a domain event, such as <code>enquiry.created</code> or <code>opportunity.won</code>, to the automation engine.</div>
    <div><b>Automation engine</b>A rule registry with event and scheduled handlers. All side effects (tasks, alerts, messages) go through one context with de-duplication keys and a run log.</div>
    <div><b>Data</b>Drizzle ORM over libSQL/SQLite: 19 tables covering users, clients, contacts, enquiries, opportunities, activities, tasks, quotations, BOQ items, approvals, projects, AMCs, PPM visits, tickets, notifications, outbox, rules, runs and settings.</div>
    <div><b>Security</b>Signed JWT session cookie (HTTP-only), role- and branch-scoped queries, owner-only settings, and an API key on the integration endpoint.</div>
    <div><b>Integrations</b>Public web form, REST enquiry API, and a WhatsApp/email outbox ready for the WhatsApp Business Cloud API and an email service.</div>
  </div>
  <h3>Path to production</h3>
  <ul>
    <li><b>Hosting:</b> deploy the Next.js app to Vercel, Azure App Service or an Indian-region VM; move the database to Turso (same driver) or PostgreSQL (Drizzle supports both).</li>
    <li><b>Sign-in:</b> Microsoft 365 or Google SSO, with OTP for technicians.</li>
    <li><b>Messaging:</b> connect the outbox to the WhatsApp Business Cloud API (approved templates) and to SES, Resend or SMTP for email.</li>
    <li><b>Accounting:</b> Tally / Zoho Books sync for invoices raised from project and AMC tasks.</li>
    <li><b>Next phases:</b> technician PWA with photos and client sign-off; client portal; AI reading of tender and BOQ PDFs into draft quotations; BMS / LG cloud alarms creating tickets automatically; INR + LKR for Colombo.</li>
  </ul>
</section>

<section>
  <h2><small>08 · QUALITY</small>Testing and verification</h2>
  <p>The production build compiles with strict TypeScript and no errors. An automated Playwright test drives the real UI through the core workflows and checks the database after each step:</p>
  <table>
    <tr><th style="width:12%">Result</th><th>Check</th></tr>
    ${e2e.map((l) => `<tr><td class="${l.startsWith("PASS") ? "pass" : "fail"}">${l.slice(0, 4)}</td><td>${esc(l.slice(6))}</td></tr>`).join("")}
  </table>
  <p><b>${passed} of ${e2e.length} checks passed.</b> The workflows covered are: discount routing to the branch head, branch-head approval, sending the quotation with its auto-email and follow-ups, PO → project and invoice task, service ticket auto-dispatch with the chargeable flag, feedback on resolution, enquiry conversion, and every main page loading.</p>
  <h3>Known limitations of this build</h3>
  <ul>
    <li>WhatsApp and email messages are recorded in the outbox, not delivered; delivery needs the provider accounts listed above.</li>
    <li>Sign-in is a role picker for demonstration; SSO is a production task.</li>
    <li>Sample data only. Client names come from SPACEAIR's public client list and do not represent real transactions.</li>
  </ul>
</section>

<section>
  <h2><small>09 · RUN IT LOCALLY</small>Setup and demo script</h2>
  <pre>cd spaceair-crm
npm install          # first time only
npm run setup        # creates the database and loads sample data
npm run build
npm start            # open http://localhost:3000</pre>
  <p>Other scripts: <code>npm run dev</code> (development mode), <code>npm run db:seed</code> (reset the sample data), <code>npm run e2e</code> (workflow tests, run against port 3100), <code>npm run screenshots</code> and <code>npm run report</code> (regenerate this PDF).</p>
  <h3>Suggested 10-minute demo</h3>
  <ol>
    <li>Sign in as <b>Founder</b>. The dashboard shows only exceptions: one approval, one critical ticket, and the automation feed.</li>
    <li>Open <code>/enquire</code> in a second tab, submit an enquiry, then open it in <b>Enquiries</b>: it is auto-assigned and the WhatsApp is logged.</li>
    <li><b>Pipeline</b>: drag a deal to <i>PO received</i>, then open <b>Projects</b> to see the handover checklist and tasks.</li>
    <li><b>Quotations</b> → Q-26-187: change a quantity and the discount, and watch the approval route change.</li>
    <li>Sign in as <b>Karthik (sales)</b>, draft a quote at 5% and submit it. Sign in as <b>Ramesh (branch head)</b> and approve it. The Founder is never involved.</li>
    <li><b>AMC contracts</b>: renewal quotes already sent, and a lapsed contract flagged.</li>
    <li><b>Service</b>: SLA ladder and chargeable calls. Sign in as <b>Manoj (technician)</b> on a phone-sized window.</li>
    <li><b>Automations</b> and <b>Reports</b>: every rule and threshold, and the "decisions needing the Founder" KPI.</li>
  </ol>
</section>
</body></html>`;

async function main() {
  writeFileSync("docs/report.html", html);
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage();
  await page.goto(pathToFileURL(resolve("docs/report.html")).href, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({
    path: "docs/Spaceair-CRM-Report.pdf",
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate: `<div style="width:100%;font:8px 'Segoe UI',sans-serif;color:#6b7c85;padding:0 14mm;display:flex;justify-content:space-between"><span>SPACEAIR CRM · Solution report · Sirah Digital</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    margin: { top: "14mm", bottom: "16mm", left: "14mm", right: "14mm" },
  });
  await browser.close();
  console.log("Wrote docs/Spaceair-CRM-Report.pdf");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
