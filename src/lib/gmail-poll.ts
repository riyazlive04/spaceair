import { google } from "googleapis";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { uid } from "@/lib/automation/ctx";
import { getOAuthClient } from "@/lib/google-oauth";
import { header, extractBody } from "@/lib/gmail-message";

/**
 * Checks every payment reminder that has a Gmail thread for new messages we
 * haven't recorded yet. Any message in the thread that isn't the reminder
 * we sent (matched by Gmail message id) is an inbound reply. Idempotent —
 * `emailReplies.gmailMessageId` is unique, so re-running never duplicates.
 */
export async function pollGmailForReplies(): Promise<{ checked: number; newReplies: { reminderId: string; projectId: string; replyId: string }[] }> {
  const accounts = await db.select().from(S.googleMailAccount);
  if (!accounts.length) return { checked: 0, newReplies: [] };
  const defaultAccount = accounts[0];
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const reminders = await db.select().from(S.paymentReminders).where(and(isNotNull(S.paymentReminders.gmailThreadId), isNotNull(S.paymentReminders.sentAt)));
  if (!reminders.length) return { checked: 0, newReplies: [] };

  const projects = await db.select().from(S.projects).where(inArray(S.projects.id, [...new Set(reminders.map((r) => r.projectId))]));
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const newReplies: { reminderId: string; projectId: string; replyId: string }[] = [];

  for (const r of reminders) {
    const account = (accountById.get(projectById.get(r.projectId)?.reminderAccountId ?? "") ?? defaultAccount);
    const client = getOAuthClient();
    client.setCredentials({ refresh_token: account.refreshToken });
    const gmail = google.gmail({ version: "v1", auth: client });

    const existing = await db.select().from(S.emailReplies).where(eq(S.emailReplies.reminderId, r.id));
    const known = new Set([r.gmailMessageId, ...existing.map((e) => e.gmailMessageId)].filter(Boolean));

    let thread;
    try {
      thread = await gmail.users.threads.get({ userId: "me", id: r.gmailThreadId!, format: "full" });
    } catch (err) {
      console.warn(`[gmail-poll] couldn't fetch thread ${r.gmailThreadId}:`, err instanceof Error ? err.message : err);
      continue;
    }

    for (const msg of thread.data.messages ?? []) {
      if (!msg.id || known.has(msg.id)) continue;
      const headers = msg.payload?.headers ?? [];
      const replyId = uid();
      await db.insert(S.emailReplies).values({
        id: replyId,
        reminderId: r.id,
        gmailMessageId: msg.id,
        fromAddress: header(headers, "From") ?? "",
        subject: header(headers, "Subject"),
        body: extractBody(msg.payload),
      });
      newReplies.push({ reminderId: r.id, projectId: r.projectId, replyId });
    }
  }

  return { checked: reminders.length, newReplies };
}

/**
 * Checks every sent broadcast recipient's Gmail thread for new messages we haven't recorded yet —
 * same idempotent pattern as pollGmailForReplies, but for broadcast sends instead of balance
 * reminders. The sending account is the broadcast's own accountId (not per-recipient).
 */
export async function pollGmailForBroadcastReplies(): Promise<{ checked: number; newReplies: { recipientId: string; broadcastId: string; replyId: string }[] }> {
  const accounts = await db.select().from(S.googleMailAccount);
  if (!accounts.length) return { checked: 0, newReplies: [] };
  const defaultAccount = accounts[0];
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const recipients = await db.select().from(S.broadcastRecipients).where(and(isNotNull(S.broadcastRecipients.gmailThreadId), eq(S.broadcastRecipients.status, "sent")));
  if (!recipients.length) return { checked: 0, newReplies: [] };

  const broadcasts = await db.select().from(S.broadcasts).where(inArray(S.broadcasts.id, [...new Set(recipients.map((r) => r.broadcastId))]));
  const broadcastById = new Map(broadcasts.map((b) => [b.id, b]));

  const newReplies: { recipientId: string; broadcastId: string; replyId: string }[] = [];

  for (const r of recipients) {
    const account = accountById.get(broadcastById.get(r.broadcastId)?.accountId ?? "") ?? defaultAccount;
    const client = getOAuthClient();
    client.setCredentials({ refresh_token: account.refreshToken });
    const gmail = google.gmail({ version: "v1", auth: client });

    const existing = await db.select().from(S.broadcastReplies).where(eq(S.broadcastReplies.recipientId, r.id));
    const known = new Set([r.gmailMessageId, ...existing.map((e) => e.gmailMessageId)].filter(Boolean));

    let thread;
    try {
      thread = await gmail.users.threads.get({ userId: "me", id: r.gmailThreadId!, format: "full" });
    } catch (err) {
      console.warn(`[gmail-poll] couldn't fetch broadcast thread ${r.gmailThreadId}:`, err instanceof Error ? err.message : err);
      continue;
    }

    for (const msg of thread.data.messages ?? []) {
      if (!msg.id || known.has(msg.id)) continue;
      const headers = msg.payload?.headers ?? [];
      const replyId = uid();
      await db.insert(S.broadcastReplies).values({
        id: replyId,
        recipientId: r.id,
        gmailMessageId: msg.id,
        fromAddress: header(headers, "From") ?? "",
        subject: header(headers, "Subject"),
        body: extractBody(msg.payload),
      });
      newReplies.push({ recipientId: r.id, broadcastId: r.broadcastId, replyId });
    }
  }

  return { checked: recipients.length, newReplies };
}
