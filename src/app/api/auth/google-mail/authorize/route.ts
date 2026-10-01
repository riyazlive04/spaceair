import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getOAuthClient, OAUTH_SCOPES, isGoogleOAuthConfigured } from "@/lib/google-oauth";

// Redirects the signed-in Founder to Google's consent screen. `access_type:
// offline` + `prompt: consent` guarantee a refresh_token comes back even on
// a re-authorization (Google only issues one on the FIRST consent otherwise).
export async function GET() {
  const user = await requireUser();
  if (user.role !== "owner") {
    return NextResponse.json({ error: "Only the Founder can connect the sending mailbox." }, { status: 403 });
  }
  if (!isGoogleOAuthConfigured()) {
    return NextResponse.json(
      { error: "Google OAuth is not configured — set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET." },
      { status: 400 },
    );
  }
  const client = getOAuthClient();
  const url = client.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: OAUTH_SCOPES });
  return NextResponse.redirect(url);
}
