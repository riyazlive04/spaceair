import { NextResponse } from "next/server";
import { db } from "@/db";
import { isGoogleOAuthConfigured } from "@/lib/google-oauth";

export async function GET() {
  const accounts = await db.query.googleMailAccount.findMany();
  return NextResponse.json({
    configured: isGoogleOAuthConfigured(),
    connected: accounts.length > 0,
    accounts: accounts.map((a) => ({ id: a.id, email: a.email, connectedAt: a.connectedAt })),
  });
}
