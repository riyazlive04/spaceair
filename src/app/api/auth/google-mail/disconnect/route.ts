import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (user.role !== "owner") {
    return NextResponse.json({ error: "Only the Founder can disconnect a sending mailbox." }, { status: 403 });
  }
  const id = String((await req.formData()).get("id") ?? "");
  if (id) await db.delete(schema.googleMailAccount).where(eq(schema.googleMailAccount.id, id));
  return NextResponse.redirect(new URL("/email-automation", req.url), 303);
}
