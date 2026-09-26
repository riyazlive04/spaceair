import Link from "next/link";
import type { ReactNode } from "react";
import { DIVISIONS, stageLabel } from "@/lib/constants";
import { cn } from "@/lib/format";

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="h-display text-[24px] leading-tight">{title}</h1>
        {sub && <p className="mt-0.5 max-w-3xl text-[13px] text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, sub, actions, children, className }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("card flex min-w-0 flex-col gap-3", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            {title && <h2 className="h-display text-[15px]">{title}</h2>}
            {sub && <p className="text-xs text-muted">{sub}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, note, tone, href }: { label: string; value: ReactNode; note?: ReactNode; tone?: "crit" | "warn" | "good"; href?: string }) {
  const body = (
    <>
      <span className="text-xs text-muted">{label}</span>
      <span className="h-display text-[26px] leading-tight tabular-nums" style={{ fontStretch: "85%" }}>
        {value}
      </span>
      {note && <span className={cn("text-xs", tone === "crit" ? "text-crit" : tone === "warn" ? "text-warn" : tone === "good" ? "text-good" : "text-ink-2")}>{note}</span>}
    </>
  );
  const cls = "card flex flex-col gap-0.5 py-3.5";
  return href ? (
    <Link href={href} className={cn(cls, "hover:border-accent")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export type Tone = "good" | "warn" | "crit" | "info" | "neutral";
export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn("pill", tone !== "neutral" && `pill-${tone}`)}>{children}</span>;
}

export function Div({ d }: { d: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px]">
      <span className="size-2 rounded-[2px]" style={{ background: DIVISIONS[d as keyof typeof DIVISIONS] ?? "var(--muted)" }} />
      {d}
    </span>
  );
}

export function StagePill({ stage }: { stage: string }) {
  const tone: Tone = stage === "won" ? "good" : stage === "lost" ? "crit" : stage === "negotiation" ? "warn" : "info";
  return <Pill tone={tone}>{stageLabel(stage)}</Pill>;
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-lg border border-line bg-surface">{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-[13px] text-muted">{children}</p>;
}

export function Tabs({ items, current }: { items: { href: string; label: string; count?: number }[]; current: string }) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-line bg-surface" role="tablist">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          role="tab"
          aria-selected={t.label === current}
          className={cn(
            "border-r border-line px-3 py-1.5 text-[13px] last:border-r-0",
            t.label === current ? "bg-accent-soft font-semibold text-ink" : "text-ink-2 hover:bg-surface-2",
          )}
        >
          {t.label}
          {t.count != null && <span className="ml-1.5 font-mono text-[11px] text-muted">{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}

export function Timeline({ items }: { items: { at: Date; body: string; kind: string; who?: string }[] }) {
  if (!items.length) return <Empty>No activity yet.</Empty>;
  return (
    <ol className="flex flex-col gap-3">
      {items.map((a, i) => (
        <li key={i} className="grid grid-cols-[92px_1fr] gap-3 text-[13px]">
          <time className="pt-0.5 font-mono text-[11px] text-muted">
            {a.at.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}
          </time>
          <div>
            <span className={cn("mr-1.5 text-[10.5px] font-semibold uppercase tracking-wider", a.kind === "automation" ? "text-accent" : "text-muted")}>
              {a.kind === "automation" ? "⚙ auto" : a.kind}
            </span>
            {a.body}
            {a.who && <span className="text-muted"> · {a.who}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}
