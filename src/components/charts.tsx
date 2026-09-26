"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const fmtL = (v: number) => (v >= 100 ? `₹${(v / 100).toFixed(1)} Cr` : `₹${Math.round(v)} L`);
const tick = { fill: "var(--muted)", fontSize: 11.5 };

function Tip({ active, payload, label, unit }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; unit: "lakhs" | "count" | "pct" }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold text-ink">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-ink-2">
          <span className="size-2 rounded-[2px]" style={{ background: p.color }} />
          {p.name}: <b className="text-ink">{unit === "lakhs" ? fmtL(p.value) : unit === "pct" ? `${p.value}%` : p.value}</b>
        </div>
      ))}
    </div>
  );
}

/** Grouped vertical bars on one shared ₹ axis (e.g. won vs open pipeline by branch). */
export function GroupedBars({ data, series, unit = "lakhs", height = 260 }: { data: Record<string, string | number>[]; series: { key: string; name: string; color: string }[]; unit?: "lakhs" | "count" | "pct"; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }} barGap={2}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" tick={tick} axisLine={{ stroke: "var(--line)" }} tickLine={false} />
          <YAxis tick={tick} axisLine={false} tickLine={false} tickFormatter={(v) => (unit === "lakhs" ? fmtL(v) : unit === "pct" ? `${v}%` : String(v))} width={64} />
          <Tooltip content={<Tip unit={unit} />} cursor={{ fill: "var(--surface-2)" }} />
          {series.length > 1 && <Legend iconType="square" iconSize={9} wrapperStyle={{ fontSize: 12, color: "var(--ink-2)" }} />}
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={36} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal single-series bars for ranked categories (sources, lost reasons…). */
export function HBars({ data, name, color = "var(--accent)", unit = "count", height }: { data: { label: string; value: number }[]; name: string; color?: string; unit?: "lakhs" | "count" | "pct"; height?: number }) {
  return (
    <div style={{ height: height ?? Math.max(120, data.length * 34 + 20) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 4 }}>
          <CartesianGrid horizontal={false} stroke="var(--line)" />
          <XAxis type="number" tick={tick} axisLine={false} tickLine={false} tickFormatter={(v) => (unit === "lakhs" ? fmtL(v) : unit === "pct" ? `${v}%` : String(v))} allowDecimals={false} />
          <YAxis type="category" dataKey="label" tick={tick} axisLine={false} tickLine={false} width={120} />
          <Tooltip content={<Tip unit={unit} />} cursor={{ fill: "var(--surface-2)" }} />
          <Bar dataKey="value" name={name} fill={color} radius={[0, 4, 4, 0]} maxBarSize={20} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
