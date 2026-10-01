import type { gmail_v1 } from "googleapis";

export function header(headers: gmail_v1.Schema$MessagePartHeader[], name: string): string | null {
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

export function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";
  if (payload.body?.data) return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  const parts = payload.parts ?? [];
  const chosen = parts.find((p) => p.mimeType === "text/plain") ?? parts.find((p) => p.mimeType === "text/html");
  if (chosen?.body?.data) return Buffer.from(chosen.body.data, "base64url").toString("utf-8");
  for (const part of parts) {
    const nested = extractBody(part);
    if (nested) return nested;
  }
  return "";
}
