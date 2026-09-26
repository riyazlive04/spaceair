import { money } from "@/lib/format";

/** Horizontal single-series bar list: label · bar · value (count). One scale for all rows. */
export function BarList({ rows, format = money, color = "var(--accent)" }: { rows: { label: string; value: number; count?: number; color?: string }[]; format?: (n: number) => string; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[112px_minmax(0,1fr)_104px] items-center gap-2.5 text-[13px]" title={`${r.label}: ${format(r.value)}${r.count != null ? ` · ${r.count}` : ""}`}>
          <span className="truncate text-ink-2">{r.label}</span>
          <div className="h-3.5 rounded-[3px] bg-surface-2">
            <div className="h-full rounded-r-[4px]" style={{ width: `${r.value ? Math.max(1, (r.value / max) * 100) : 0}%`, background: r.color ?? color }} />
          </div>
          <span className="text-right font-mono text-[12px] tabular-nums">
            {format(r.value)}
            {r.count != null && <span className="text-muted"> · {r.count}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
