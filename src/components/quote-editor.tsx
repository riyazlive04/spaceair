"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { Trash2, Plus } from "lucide-react";
import { saveQuotation, submitQuotation, sendQuotation, reviseQuotation } from "@/lib/actions";
import { inr, money, quoteTotals, cn } from "@/lib/format";

export type EditorItem = {
  description: string;
  unit: string;
  qty: number;
  rate: number;
  supplyRate?: number | null;
  installRate?: number | null;
  qro?: boolean;
  itemNo?: string | null;
  section?: string | null;
  sheet?: string | null;
  sourceRow?: number | null;
  floorQty?: Record<string, number> | null;
  rateSource?: "manual" | "library" | "estimated" | null;
};
type Props = {
  id: string;
  status: string;
  items: EditorItem[];
  discountPct: number;
  validityDays: number;
  terms: string;
  gstPct: number;
  split: boolean;
  matrix: { salesMaxDiscount: number; branchHeadMaxDiscount: number; ownerValueLakhs: number };
};
type Filter = "All" | "Needs rate" | "Estimated" | "QRO";

const SRC: Record<string, { label: string; cls: string }> = {
  library: { label: "library", cls: "pill-good" },
  estimated: { label: "estimated", cls: "pill-warn" },
  manual: { label: "manual", cls: "" },
};

export function QuoteEditor(p: Props) {
  const editable = p.status === "draft" || p.status === "approved";
  const [items, setItems] = useState<EditorItem[]>(p.items);
  const [disc, setDisc] = useState(p.discountPct);
  const [validity, setValidity] = useState(p.validityDays);
  const [terms, setTerms] = useState(p.terms);
  const [filter, setFilter] = useState<Filter>("All");
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const norm = (it: EditorItem) => ({ ...it, rate: p.split ? (it.supplyRate ?? 0) + (it.installRate ?? 0) : it.rate });
  const t = quoteTotals(items.map(norm), disc, p.gstPct);
  const big = t.net >= p.matrix.ownerValueLakhs * 1e5;
  const approver = disc <= p.matrix.salesMaxDiscount && !big ? "Auto-approved (within sales limit)" : disc <= p.matrix.branchHeadMaxDiscount && !big ? "Branch head approval" : "Founder approval";
  const priced = (it: EditorItem) => (p.split ? (it.supplyRate ?? 0) + (it.installRate ?? 0) : it.rate) > 0;
  const counts = useMemo(
    () => ({
      need: items.filter((i) => !priced(i)).length,
      est: items.filter((i) => i.rateSource === "estimated").length,
      qro: items.filter((i) => i.qro).length,
      lib: items.filter((i) => i.rateSource === "library").length,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items],
  );
  const visible = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => (filter === "All" ? true : filter === "Needs rate" ? !priced(it) : filter === "Estimated" ? it.rateSource === "estimated" : !!it.qro));

  const upd = (i: number, patch: Partial<EditorItem>) => {
    setDirty(true);
    setItems((s) => s.map((it, j) => (j === i ? { ...it, ...patch, ...("supplyRate" in patch || "installRate" in patch || "rate" in patch ? { rateSource: "manual" as const } : {}) } : it)));
  };
  const numIn = (v: string) => (v === "" ? 0 : Number(v) || 0);
  const save = async () => {
    const r = await saveQuotation(p.id, { items: items.filter((i) => i.description.trim()).map(norm), discountPct: disc, validityDays: validity, terms });
    if (!r.ok) setErr(r.error ?? "Could not save");
    else setDirty(false);
    return r.ok;
  };

  let lastSection: string | null | undefined = undefined;
  const colCount = p.split ? 8 : 6;

  return (
    <div className="flex flex-col gap-4">
      {p.split && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex overflow-hidden rounded-md border border-line bg-surface" role="tablist" aria-label="Filter BOQ lines">
            {(["All", "Needs rate", "Estimated", "QRO"] as Filter[]).map((f) => (
              <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={cn("border-r border-line px-3 py-1.5 text-[13px] last:border-r-0", filter === f ? "bg-accent-soft font-semibold" : "text-ink-2 hover:bg-surface-2")}>
                {f}
                <span className="ml-1.5 font-mono text-[11px] text-muted">{f === "All" ? items.length : f === "Needs rate" ? counts.need : f === "Estimated" ? counts.est : counts.qro}</span>
              </button>
            ))}
          </div>
          <span className="text-xs text-muted">
            <span className="pill pill-good">{counts.lib} from library</span> <span className="pill pill-warn">{counts.est} estimated</span> <span className="pill pill-crit">{counts.need} need a rate</span>
          </span>
        </div>
      )}
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-line bg-surface">
        <table className="tbl">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="w-12">#</th>
              <th>{p.split ? "Description of item" : "BOQ item"}</th>
              <th>Unit</th>
              <th className="num">Qty</th>
              {p.split ? (
                <>
                  <th className="num">Supply rate</th>
                  <th className="num">Install rate</th>
                </>
              ) : (
                <th className="num">Rate (₹)</th>
              )}
              <th className="num">Amount (₹)</th>
              {editable && !p.split && <th />}
              {p.split && <th>Rate</th>}
            </tr>
          </thead>
          <tbody>
            {visible.map(({ it, i }) => {
              const showSection = p.split && filter === "All" && it.section !== lastSection;
              lastSection = it.section;
              const amount = it.qro ? 0 : it.qty * norm(it).rate;
              const floors = it.floorQty && Object.keys(it.floorQty).length ? Object.entries(it.floorQty).map(([k, v]) => `${k}: ${v}`).join(" · ") : "";
              return (
                <Fragment key={i}>
                  {showSection && (
                    <tr>
                      <td colSpan={colCount} className="bg-surface-2 py-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-2">{it.section}</td>
                    </tr>
                  )}
                  <tr className={cn(!priced(it) && p.split && "bg-crit-soft/40")}>
                    <td className="font-mono text-[11.5px] text-muted">{it.itemNo || i + 1}</td>
                    <td className="min-w-[220px] max-w-[420px]">
                      {editable && !p.split ? (
                        <input aria-label={`Item ${i + 1} description`} className="input" value={it.description} onChange={(e) => upd(i, { description: e.target.value })} />
                      ) : (
                        <span className={cn("block", it.description.length > 140 && "line-clamp-2")} title={it.description}>{it.description}</span>
                      )}
                      {floors && <span className="text-[11px] text-muted">{floors}</span>}
                    </td>
                    <td className="w-16">{editable && !p.split ? <input aria-label={`Item ${i + 1} unit`} className="input" value={it.unit} onChange={(e) => upd(i, { unit: e.target.value })} /> : it.unit}</td>
                    <td className="num w-20">
                      {it.qro ? (
                        <span className="pill" title="Quote rate only: quantity to be decided">QRO</span>
                      ) : editable && !p.split ? (
                        <input aria-label={`Item ${i + 1} quantity`} className="input text-right" type="number" min="0" value={it.qty} onChange={(e) => upd(i, { qty: numIn(e.target.value) })} />
                      ) : (
                        it.qty.toLocaleString("en-IN")
                      )}
                    </td>
                    {p.split ? (
                      <>
                        <td className="num">{editable ? <input aria-label={`Item ${it.itemNo} supply rate`} className="input w-[104px] text-right" type="number" min="0" value={it.supplyRate ?? ""} placeholder="—" onChange={(e) => upd(i, { supplyRate: numIn(e.target.value) })} /> : inr(it.supplyRate ?? 0)}</td>
                        <td className="num">{editable ? <input aria-label={`Item ${it.itemNo} installation rate`} className="input w-[96px] text-right" type="number" min="0" value={it.installRate ?? ""} placeholder="—" onChange={(e) => upd(i, { installRate: numIn(e.target.value) })} /> : inr(it.installRate ?? 0)}</td>
                      </>
                    ) : (
                      <td className="num w-32">{editable ? <input aria-label={`Item ${i + 1} rate`} className="input text-right" type="number" min="0" value={it.rate} onChange={(e) => upd(i, { rate: numIn(e.target.value) })} /> : inr(it.rate)}</td>
                    )}
                    <td className="num font-mono text-[12.5px]">{it.qro ? <span className="text-muted">rate only</span> : inr(amount)}</td>
                    {editable && !p.split && (
                      <td className="w-8"><button type="button" aria-label={`Remove item ${i + 1}`} className="text-muted hover:text-crit" onClick={() => { setDirty(true); setItems((s) => s.filter((_, j) => j !== i)); }}><Trash2 className="size-4" /></button></td>
                    )}
                    {p.split && <td className="whitespace-nowrap">{it.rateSource && SRC[it.rateSource] ? <span className={cn("pill", SRC[it.rateSource].cls)}>{SRC[it.rateSource].label}</span> : !priced(it) ? <span className="pill pill-crit">needed</span> : null}</td>}
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {editable && !p.split && (
        <button type="button" className="btn self-start" onClick={() => { setDirty(true); setItems((s) => [...s, { description: "", unit: "Nos", qty: 1, rate: 0 }]); }}>
          <Plus className="size-4" /> Add BOQ line
        </button>
      )}
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <label className="field">Discount %<input className="input w-24" type="number" min="0" max="40" step="0.5" value={disc} disabled={!editable} onChange={(e) => { setDirty(true); setDisc(Number(e.target.value) || 0); }} /></label>
            <label className="field">Validity (days)<input className="input w-24" type="number" min="1" value={validity} disabled={!editable} onChange={(e) => { setDirty(true); setValidity(Number(e.target.value) || 30); }} /></label>
          </div>
          <label className="field w-[min(460px,100%)]">Terms<textarea className="input" rows={2} value={terms} disabled={!editable} onChange={(e) => { setDirty(true); setTerms(e.target.value); }} /></label>
          {editable && (
            <p className={cn("text-xs font-medium", approver.startsWith("Auto") ? "text-good" : approver.startsWith("Branch") ? "text-warn" : "text-crit")}>
              Approval route: {approver}. Limits: sales ≤ {p.matrix.salesMaxDiscount}%, branch head ≤ {p.matrix.branchHeadMaxDiscount}%, Founder above that or for deals ≥ {money(p.matrix.ownerValueLakhs * 1e5)}.
            </p>
          )}
        </div>
        <dl className="grid min-w-[280px] grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[13px]">
          {p.split && (
            <>
              <dt className="text-muted">Supply</dt><dd className="num font-mono">{inr(t.supply)}</dd>
              <dt className="text-muted">Installation</dt><dd className="num font-mono">{inr(t.install)}</dd>
            </>
          )}
          <dt className="text-muted">Basic value</dt><dd className="num font-mono">{inr(t.basic)}</dd>
          <dt className="text-muted">Less discount {disc}%</dt><dd className="num font-mono">− {inr(t.discount)}</dd>
          <dt className="text-muted">Net value</dt><dd className="num font-mono">{inr(t.net)}</dd>
          <dt className="text-muted">GST {p.gstPct}%</dt><dd className="num font-mono">{inr(t.gst)}</dd>
          <dt className="font-semibold">Quotation total</dt><dd className="num h-display text-[20px]">{inr(t.total)}</dd>
        </dl>
      </div>
      {err && <p className="text-[13px] text-crit">{err}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {editable && (
          <button type="button" className="btn" disabled={pending || !dirty} onClick={() => start(async () => { await save(); })}>
            {dirty ? "Save draft" : "Saved"}
          </button>
        )}
        {p.status === "draft" && (
          <button type="button" className="btn btn-primary" disabled={pending} onClick={() => start(async () => { if (await save()) await submitQuotation(p.id); })}>
            {pending ? "Working…" : "Submit for approval"}
          </button>
        )}
        {p.status === "approved" && (
          <button type="button" className="btn btn-primary" disabled={pending || dirty} onClick={() => start(async () => { await sendQuotation(p.id); })}>
            {pending ? "Sending…" : "Send to client"}
          </button>
        )}
        {["sent", "pending_approval", "accepted", "rejected"].includes(p.status) && (
          <button type="button" className="btn" disabled={pending} onClick={() => start(async () => { await reviseQuotation(p.id); })}>
            Create revision R+1
          </button>
        )}
      </div>
    </div>
  );
}
