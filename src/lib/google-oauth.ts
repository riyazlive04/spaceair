import { google } from "googleapis";

// Lets this app send mail as the connected account.
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

// Needed to poll sent threads for replies (balance reminders and broadcasts) — read-only, no
// ability to send, delete or modify anything in the mailbox.
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

// Needed only to identify WHICH mailbox authorized sending — grants no
// access beyond the account's email address and basic profile.
export const USERINFO_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";

export const OAUTH_SCOPES = [GMAIL_SEND_SCOPE, GMAIL_READONLY_SCOPE, USERINFO_EMAIL_SCOPE];

export function getOAuthClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || "http://localhost:3002/api/auth/google-mail/callback";

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not set");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function isGoogleOAuthConfigured(): boolean {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}
