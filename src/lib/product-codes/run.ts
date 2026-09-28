/** Product coding for a quotation: rules on import, AI review of flagged lines, manual edits, approval. */
import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema as S } from "@/db";
import type { QuoteItem, Quotation } from "@/db/schema";
import { readBoqContext, type LineContext } from "@/lib/boq";
import { clashFlags, codeLine, type CodeLine } from "./engine";
import { AiStopped, aiAvailable, proposeCode, type Known } from "./ai";
import { MISC_CODE } from "./master";

export const CODE_RE = /^[A-Z0-9]{16}$/;
/** Lines sent to the AI per click - keeps one request well inside a server action's time. */
export const AI_BATCH = 25;

export async function contexts(q: Quotation) {
  const buf = q.sourceFile ? await readFile(q.sourceFile).catch(() => null) : null;
  return buf && q.sheets ? await readBoqContext(buf, q.sheets) : new Map<string, LineContext>();
}

function toLine(it: QuoteItem, ctx: Map<string, LineContext>): CodeLine {
  const c = ctx.get(`${it.sheet}!${it.sourceRow}`);
  return {
    sl: c?.sl ?? it.itemNo ?? "",
    line: it.description,
    heading: c?.heading ?? it.section ?? "",
    context: c?.context ?? "",
    contextLines: c?.contextLines ?? [],
    trailing: c?.trailing ?? "",
    group: c?.group ?? "",
    section: c?.section ?? "",
    unit: it.unit,
  };
}

async function items(qid: string) {
  return db.select().from(S.quoteItems).where(eq(S.quoteItems.quotationId, qid)).orderBy(asc(S.quoteItems.sort));
}

/** Rule-code every line that a person or the AI has not already coded. */
export async function generateCodes(qid: string, discipline = "A") {
  const q = await db.query.quotations.findFirst({ where: eq(S.quotations.id, qid) });
  if (!q) throw new Error("Quotation not found");
  const all = await items(qid);
  const ctx = await contexts(q);
  const register = new Map((await db.select().from(S.productCodes)).map((p) => [p.code, p]));
  const results = all.map((it) => ({ it, ln: toLine(it, ctx), r: codeLine(toLine(it, ctx), discipline) }));
  const clashes = clashFlags(results.map(({ ln, r }) => ({ code: r.code, heading: ln.heading, line: ln.line })));
  let coded = 0;
  for (const { it, r } of results) {
    if (it.codeApproved || it.codeSource === "manual" || it.codeSource === "ai") continue;
    const known = register.get(r.code);
    const flag = [
      r.flag,
      clashes.has(r.code) ? "Same code under different BOQ headings - confirm it is the same product" : "",
      known?.note ? `Register: ${known.note}` : "",
    ].filter(Boolean).join("; ");
    await db
      .update(S.quoteItems)
      .set({
        productCode: r.code,
        productName: known?.name ?? r.name,
        codeSource: known ? "register" : "rules",
        codeFlag: flag || null,
        codeInfo: { categoryText: known?.categoryText ?? r.categoryText, hsn: known?.hsn ?? r.hsn, abbreviation: known?.abbreviation ?? r.abbreviation, basis: r.basis },
      })
      .where(eq(S.quoteItems.id, it.id));
    coded++;
  }
  return { coded, total: all.length };
}

/** Send flagged lines (up to AI_BATCH) to the AI agent. */
export async function aiReview(qid: string) {
  if (!aiAvailable()) throw new Error("AI review needs ANTHROPIC_API_KEY on the server.");
  const q = await db.query.quotations.findFirst({ where: eq(S.quotations.id, qid) });
  if (!q) throw new Error("Quotation not found");
  const all = await items(qid);
  const todo = all.filter((it) => !it.codeApproved && it.codeSource !== "manual" && it.codeSource !== "ai" && (it.codeFlag || !it.productCode));
  const ctx = await contexts(q);
  const known: Known[] = (await db.select().from(S.productCodes)).map((p) => ({ code: p.code, name: p.name, categoryText: p.categoryText, unit: p.unit }));
  const client = new Anthropic();
  let done = 0, failed = 0, stopped = "";
  for (const it of todo.slice(0, AI_BATCH)) {
    const ln = toLine(it, ctx);
    const context = [ln.section, ln.heading, ln.context, ln.trailing].filter(Boolean).join("\n");
    try {
      const r = await proposeCode(client, { description: it.description, context, ruleCode: it.productCode }, known);
      const flag = [...r.checks, ...r.questions.map((x) => `Question for sales: ${x}`), r.confidence !== "high" ? `AI confidence ${r.confidence}` : ""].filter(Boolean).join("; ");
      await db
        .update(S.quoteItems)
        .set({
          productCode: r.code,
          productName: r.name,
          codeSource: "ai",
          codeFlag: flag || null,
          codeInfo: { categoryText: r.categoryText, hsn: "", abbreviation: r.abbreviation, reasoning: r.reasoning, questions: r.questions, confidence: r.confidence },
        })
        .where(eq(S.quoteItems.id, it.id));
      // later lines in this BOQ should see this proposal, so repeated items stay consistent
      if (!known.some((k) => k.code === r.code)) known.push({ code: r.code, name: r.name, categoryText: r.categoryText, unit: it.unit });
      done++;
    } catch (e) {
      if (e instanceof AiStopped) {
        stopped = e.message;
        break;
      }
      failed++;
    }
  }
  return { done, failed, remaining: Math.max(0, todo.length - done), stopped };
}

/** Manual code for one line (a person's decision is final: no flag). */
export async function setCode(itemId: string, code: string, name: string) {
  const c = code.trim().toUpperCase();
  if (!CODE_RE.test(c)) throw new Error("A product code is exactly 16 letters/digits");
  const known = await db.query.productCodes.findFirst({ where: eq(S.productCodes.code, c) });
  const it = await db.query.quoteItems.findFirst({ where: eq(S.quoteItems.id, itemId) });
  if (!it) throw new Error("Line not found");
  await db
    .update(S.quoteItems)
    .set({
      productCode: c,
      productName: known?.name ?? (name.trim().toUpperCase() || it.productName),
      codeSource: known ? "register" : "manual",
      codeFlag: null,
      codeApproved: false,
      codeInfo: { ...(it.codeInfo ?? { categoryText: "", hsn: "", abbreviation: "" }), ...(known ? { categoryText: known.categoryText, hsn: known.hsn ?? "", abbreviation: known.abbreviation ?? "" } : {}) },
    })
    .where(eq(S.quoteItems.id, itemId));
  return it.quotationId;
}

/** Approve codes and add new ones to the register. `onlyClean` skips lines still flagged. */
export async function approveCodes(qid: string, userId: string, onlyClean: boolean) {
  const all = (await items(qid)).filter((it) => it.productCode && !it.productCode.includes(MISC_CODE) && !it.codeApproved && (!onlyClean || !it.codeFlag));
  const existing = new Set((await db.select({ code: S.productCodes.code }).from(S.productCodes)).map((p) => p.code));
  let added = 0;
  for (const it of all) {
    const code = it.productCode!;
    if (!existing.has(code)) {
      await db.insert(S.productCodes).values({
        code, name: it.productName ?? code, categoryText: it.codeInfo?.categoryText ?? "", hsn: it.codeInfo?.hsn || null, unit: it.unit,
        description: it.description, abbreviation: it.codeInfo?.abbreviation ?? null, source: it.codeSource ?? "rules", quotationId: qid, createdBy: userId,
      });
      existing.add(code);
      added++;
    }
  }
  if (all.length) await db.update(S.quoteItems).set({ codeApproved: true, codeFlag: null }).where(and(eq(S.quoteItems.quotationId, qid), inArray(S.quoteItems.id, all.map((i) => i.id))));
  return { approved: all.length, added };
}

export async function codeStats(qid: string) {
  const all = await items(qid);
  const coded = all.filter((i) => i.productCode && !i.productCode.includes(MISC_CODE));
  return {
    total: all.length,
    coded: coded.length,
    flagged: all.filter((i) => !i.codeApproved && (i.codeFlag || !i.productCode || i.productCode.includes(MISC_CODE))).length,
    approved: all.filter((i) => i.codeApproved).length,
    priced: all.filter((i) => i.qro || (i.supplyRate ?? 0) + (i.installRate ?? 0) > 0 || i.rate > 0).length,
  };
}
