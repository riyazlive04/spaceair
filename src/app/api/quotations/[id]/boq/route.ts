import { readFile } from "node:fs/promises";
import { asc, eq } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { getUser } from "@/lib/auth";
import { buildWorkbook, fillWorkbook } from "@/lib/boq";

/** Download the priced BOQ: the client's own workbook with rates filled in, or a fresh one in the same layout. */
export async function GET(req: Request, ctx: RouteContext<"/api/quotations/[id]/boq">) {
  if (!(await getUser())) return Response.redirect(new URL("/login", req.url), 303);
  const { id } = await ctx.params;
  const q = await db.query.quotations.findFirst({ where: eq(S.quotations.id, id) });
  if (!q) return new Response("Not found", { status: 404 });
  const items = await db.select().from(S.quoteItems).where(eq(S.quoteItems.quotationId, id)).orderBy(asc(S.quoteItems.sort));
  const o = await db.query.opportunities.findFirst({ where: eq(S.opportunities.id, q.opportunityId) });
  const a = o ? await db.query.accounts.findFirst({ where: eq(S.accounts.id, o.accountId) }) : undefined;
  const owner = o?.ownerId ? await db.query.users.findFirst({ where: eq(S.users.id, o.ownerId) }) : undefined;

  let buf: Buffer;
  let name: string;
  const original = q.sourceFile ? await readFile(q.sourceFile).catch(() => null) : null;
  if (original) {
    buf = await fillWorkbook(original, q, items);
    name = (q.fileName ?? `${q.code}.xlsx`).replace(/unpriced/i, "Priced").replace(/\.xlsx$/i, "") + ` – SPACEAIR ${q.code} R${q.revision}.xlsx`;
  } else {
    buf = await buildWorkbook({ code: q.code, revision: q.revision, client: a?.name ?? "", project: o?.title ?? "", preparedBy: owner?.name ?? "" }, items);
    name = `SPACEAIR ${q.code} R${q.revision} – Priced BOQ.xlsx`;
  }
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // Header values must be ASCII: plain fallback name, full UTF-8 name in filename*.
      "content-disposition": `attachment; filename="${name.replace(/[–—]/g, "-").replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
