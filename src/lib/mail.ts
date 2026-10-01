import { google } from "googleapis";
import { eq } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { getOAuthClient } from "@/lib/google-oauth";

/** True once at least one Google mailbox has been connected. */
export async function mailConfigured() {
  const account = await db.query.googleMailAccount.findFirst();
  return !!account;
}

export type MailAttachment = { filename: string; contentType: string; data: Uint8Array };

export async function sendMail(m: { to: string; cc?: string; bcc?: string; subject?: string; body: string; existingThreadId?: string | null; accountId?: string | null; attachments?: MailAttachment[] }) {
  const account = m.accountId
    ? (await db.query.googleMailAccount.findFirst({ where: eq(S.googleMailAccount.id, m.accountId) })) ?? (await db.query.googleMailAccount.findFirst())
    : await db.query.googleMailAccount.findFirst();
  if (!account) return { ok: false as const, error: "No Google mailbox connected" };

  try {
    const client = getOAuthClient();
    client.setCredentials({ refresh_token: account.refreshToken });
    const gmail = google.gmail({ version: "v1", auth: client });

    const raw = buildMimeMessage(account.email, m);
    const res = await gmail.users.messages.send({ userId: "me", requestBody: { raw, threadId: m.existingThreadId ?? undefined } });
    return { ok: true as const, messageId: res.data.id ?? null, threadId: res.data.threadId ?? null, fromEmail: account.email };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

function buildMimeMessage(fromEmail: string, m: { to: string; cc?: string; bcc?: string; subject?: string; body: string; attachments?: MailAttachment[] }): string {
  const headers = [
    `From: "Spaceair CRM" <${fromEmail}>`,
    `To: ${m.to}`,
    m.cc ? `Cc: ${m.cc}` : null,
    m.bcc ? `Bcc: ${m.bcc}` : null,
    `Subject: ${encodeSubject(m.subject || "Spaceair CRM")}`,
    `MIME-Version: 1.0`,
  ].filter((h): h is string => h !== null);

  if (!m.attachments?.length) {
    headers.push(`Content-Type: text/plain; charset="UTF-8"`);
    return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${m.body}`).toString("base64url");
  }

  const boundary = `----spaceair-${Date.now()}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts = [`--${boundary}`, `Content-Type: text/plain; charset="UTF-8"`, ``, m.body];
  for (const att of m.attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${att.contentType}; name="${att.filename}"`,
      `Content-Disposition: attachment; filename="${att.filename}"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      Buffer.from(att.data).toString("base64"),
    );
  }
  parts.push(`--${boundary}--`);
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}`).toString("base64url");
}

function encodeSubject(subject: string): string {
  return `=?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;
}
