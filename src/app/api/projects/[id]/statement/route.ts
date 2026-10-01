import { eq } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { getUser } from "@/lib/auth";
import { buildStatementPdf } from "@/lib/statement-pdf";

/** Downloads a one-page PDF statement of account for a project: value, payments received, balance. */
export async function GET(req: Request, ctx: RouteContext<"/api/projects/[id]/statement">) {
  if (!(await getUser())) return Response.redirect(new URL("/login", req.url), 303);
  const { id } = await ctx.params;
  const p = await db.query.projects.findFirst({ where: eq(S.projects.id, id) });
  if (!p) return new Response("Not found", { status: 404 });
  const [account, payments] = await Promise.all([
    db.query.accounts.findFirst({ where: eq(S.accounts.id, p.accountId) }),
    db.select().from(S.payments).where(eq(S.payments.projectId, id)),
  ]);
  const buf = await buildStatementPdf({ code: p.code, name: p.name, clientName: account?.name ?? "—", value: p.value, payments });
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${p.code} statement of account.pdf"`,
    },
  });
}
