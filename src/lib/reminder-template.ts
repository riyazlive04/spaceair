import { money } from "@/lib/format";

/** Default balance-reminder subject/body, using {value}/{balance} tokens that are always substituted live so a saved custom message never goes stale after a payment. */
export function defaultReminderSubject(code: string) {
  return `Payment reminder – ${code} ({balance} outstanding)`;
}
export function defaultReminderBody(clientName: string, projectName: string, code: string) {
  return `Dear ${clientName},\n\nThis is a reminder that {balance} of the total order value {value} for ${projectName} (${code}) remains outstanding.\n\nKindly arrange payment at your earliest convenience.\n\nRegards,\nSPACEAIR Accounts`;
}

/** Replaces {value}/{balance} tokens in a saved (or default) subject/body with the project's current numbers. */
export function fillReminderTemplate(text: string, o: { value: number; balance: number }) {
  return text.replace(/\{value\}/g, money(o.value)).replace(/\{balance\}/g, money(o.balance));
}

/**
 * The inverse of fillReminderTemplate: turns the current computed amounts back into {value}/{balance}
 * tokens before saving, so editing the filled-in text (which is what the user sees and edits) doesn't
 * freeze today's number into the stored template — it stays correct after future payments.
 */
export function tokenizeReminderTemplate(text: string, o: { value: number; balance: number }) {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escape(money(o.value)), "g"), "{value}").replace(new RegExp(escape(money(o.balance)), "g"), "{balance}");
}
