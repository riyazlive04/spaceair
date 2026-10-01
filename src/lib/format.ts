import { clsx, type ClassValue } from "clsx";

export const cn = (...c: ClassValue[]) => clsx(c);

/** Rupees → ₹ Cr / ₹ L / ₹ amount, the way Indian MEP teams talk about value. */
export function money(rupees: number | null | undefined): string {
  const v = rupees ?? 0;
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(1)} L`;
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
}
export const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

export const fmtDate = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
export const fmtShort = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—";
export const fmtDateTime = (d: Date | null | undefined) =>
  d
    ? d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true })
    : "—";

export const HOUR = 36e5;
export const DAY = 864e5;

/** yyyy-mm-dd / hh:mm in the server's local time, for pre-filling <input type="date"/"time">. toISOString() would give UTC, which drifts a stored time by the local UTC offset every time the form is re-saved. */
export function localDateInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function localTimeInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ago(d: Date | null | undefined, now = new Date()): string {
  if (!d) return "—";
  const ms = now.getTime() - d.getTime();
  const future = ms < 0;
  const a = Math.abs(ms);
  let s: string;
  if (a < HOUR) s = `${Math.max(1, Math.round(a / 6e4))} min`;
  else if (a < DAY) s = `${Math.round(a / HOUR)} h`;
  else s = `${Math.round(a / DAY)} d`;
  return future ? `in ${s}` : `${s} ago`;
}

export const daysUntil = (d: Date, now = new Date()) => Math.ceil((d.getTime() - now.getTime()) / DAY);

export function slaState(t: { createdAt: Date; slaHours: number; status: string }, now = new Date()) {
  if (t.status === "resolved") return { tone: "good" as const, label: "Resolved", hoursLeft: 0 };
  const due = t.createdAt.getTime() + t.slaHours * HOUR;
  const left = (due - now.getTime()) / HOUR;
  if (left < 0) return { tone: "crit" as const, label: `Breached ${Math.round(-left)} h`, hoursLeft: left };
  if (left < t.slaHours * 0.25) return { tone: "warn" as const, label: `${Math.max(1, Math.round(left))} h left`, hoursLeft: left };
  return { tone: "neutral" as const, label: `${Math.round(left)} h left`, hoursLeft: left };
}

/** Totals for a quotation. "QRO" lines (rate only, quantity to be decided) are excluded. */
export function quoteTotals(items: { qty: number; rate: number; qro?: boolean | null; supplyRate?: number | null; installRate?: number | null }[], discountPct: number, gstPct: number) {
  const live = items.filter((i) => !i.qro);
  const supply = live.reduce((s, i) => s + i.qty * (i.supplyRate ?? i.rate), 0);
  const install = live.reduce((s, i) => s + i.qty * (i.installRate ?? 0), 0);
  const basic = live.reduce((s, i) => s + i.qty * i.rate, 0);
  const discount = (basic * discountPct) / 100;
  const net = basic - discount;
  const gst = (net * gstPct) / 100;
  return { basic, discount, net, gst, total: net + gst, supply, install };
}
