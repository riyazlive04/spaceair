import { daysUntil } from "@/lib/format";
import type { Tone } from "@/components/ui";

export function amcBadge(a: { status: string; endDate: Date }, now = new Date()): { tone: Tone; label: string } {
  const d = daysUntil(a.endDate, now);
  if (a.status === "lapsed") return { tone: "crit", label: `Lapsed ${-d} d ago` };
  if (a.status === "renewal_sent") return { tone: "info", label: `Renewal quote sent · ${d} d left` };
  if (d <= 60) return { tone: "warn", label: `Renew in ${d} d` };
  return { tone: "good", label: "Active" };
}
