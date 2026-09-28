import { asc, eq } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { getUser } from "@/lib/auth";
import { buildOmcWorkbook, buildProductCodeOmcWorkbook } from "@/lib/omc";
import { contexts } from "@/lib/product-codes/run";

/** Download the OMC workbook (?kind=omc, default) or just the Product Code OMC (?kind=codes). */
export async function GET(req: Request, ctx: RouteContext<"/api/quotations/[id]/omc">) {
  const user = await getUser();
  if (!user) return Response.redirect(new URL("/login", req.url), 303);
  const { id } = await ctx.params;
  const q = await db.query.quotations.findFirst({ where: eq(S.quotations.id, id) });
  if (!q) return new Response("Not found", { status: 404 });
  const items = await db.select().from(S.quoteItems).where(eq(S.quoteItems.quotationId, id)).orderBy(asc(S.quoteItems.sort));
  const o = await db.query.opportunities.findFirst({ where: eq(S.opportunities.id, q.opportunityId) });
  const a = o ? await db.query.accounts.findFirst({ where: eq(S.accounts.id, o.accountId) }) : undefined;
  const lineCtx = await contexts(q);
  const register = new Map((await db.select().from(S.productCodes)).map((p) => [p.code, p]));

  const kind = new URL(req.url).searchParams.get("kind") === "codes" ? "codes" : "omc";
  const title = q.meta?.project || o?.title || q.code;
  const buf =
    kind === "codes"
      ? await buildProductCodeOmcWorkbook(items, lineCtx, register)
      : await buildOmcWorkbook({ title, code: q.code, revision: q.revision, client: a?.name ?? q.meta?.client ?? "", preparedBy: user.name }, items, lineCtx, register);
  const name = `SPACEAIR ${q.code} R${q.revision} - ${kind === "codes" ? "Product Code OMC" : "OMC"}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
