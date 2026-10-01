import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getOAuthClient } from "@/lib/google-oauth";
import { uid } from "@/lib/automation/ctx";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  const settingsUrl = new URL("/email-automation", req.nextUrl.origin);

  if (error) {
    settingsUrl.searchParams.set("googleMailError", error);
    return NextResponse.redirect(settingsUrl);
  }
  if (!code) {
    settingsUrl.searchParams.set("googleMailError", "missing_code");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const client = getOAuthClient();
    const { tokens } = await client.getToken(code);

    if (!tokens.refresh_token) {
      // Happens if this mailbox already granted consent before and Google
      // didn't re-issue a refresh token — revoke access at
      // myaccount.google.com/permissions and try again.
      settingsUrl.searchParams.set("googleMailError", "no_refresh_token");
      return NextResponse.redirect(settingsUrl);
    }

    client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const { data: profile } = await oauth2.userinfo.get();

    if (!profile.email) {
      settingsUrl.searchParams.set("googleMailError", "no_email_returned");
      return NextResponse.redirect(settingsUrl);
    }

    // Several sending mailboxes can be connected at once; re-authorizing one just refreshes its token.
    const existing = await db.query.googleMailAccount.findFirst({ where: eq(schema.googleMailAccount.email, profile.email) });
    if (existing) {
      await db.update(schema.googleMailAccount).set({ refreshToken: tokens.refresh_token }).where(eq(schema.googleMailAccount.id, existing.id));
    } else {
      await db.insert(schema.googleMailAccount).values({
        id: uid(),
        email: profile.email,
        refreshToken: tokens.refresh_token,
      });
    }

    settingsUrl.searchParams.set("googleMailConnected", profile.email);
    return NextResponse.redirect(settingsUrl);
  } catch (err) {
    settingsUrl.searchParams.set("googleMailError", err instanceof Error ? err.message : "unknown_error");
    return NextResponse.redirect(settingsUrl);
  }
}
