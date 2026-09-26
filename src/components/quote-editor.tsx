"use client";

import { useState, useTransition } from "react";
import { Trash2, Plus } from "lucide-react";
import { saveQuotation, submitQuotation, sendQuotation, reviseQuotation } from "@/lib/actions";
import { inr, money, quoteTotals, cn } from "@/lib/format";

type Item = { description: string; unit: string; qty: number; rate: number };
type Props = {
  id: string;
  status: string;
  items: Item[];
  discountPct: number;
  validityDays: number;
  terms: string;
  gstPct: number;
  matrix: { salesMaxDiscount: number; branchHeadMaxDiscount: number; ownerValueLakhs: number };
};

export function QuoteEditor(p: Props) {
  const editable = p.status === "draft" || p.status === "approved";
  const [items, setItems] = useState<Item[]>(p.items);
  const [disc, setDisc] = useState(p.discountPct);
  const [validity, setValidity] = useState(p.validityDays);
  const [terms, setTerms] = useState(p.terms);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const t = quoteTotals(items, disc, p.gstPct);
  const big = t.net >= p.matrix.ownerValueLakhs * 1e5;
  const approver = disc <= p.matrix.salesMaxDiscount && !big ? "Auto-approved (within sales limit)" : disc <= p.matrix.branchHeadMaxDiscount && !big ? "Branch head approval" : "Founder approval";

  const upd = (i: number, k: keyof Item, v: string) => {
    setDirty(true);
    setItems((s) => s.map((it, j) => (j === i ? { ...it, [k]: k === "qty" || k === "rate" ? Number(v) || 0 : v } : it)));
  };
  const save = async () => {
    const r = await saveQuotation(p.id, { items: items.filter((i) => i.description.trim()), discountPct: disc, validityDays: validity, terms });
    if (!r.ok) setErr(r.error ?? "Could not save");
    else setDirty(false);
    return r.ok;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="tbl">
          <thead><tr><th className="w-8">#</th><th>BOQ item</th><th>Unit</th><th className="num">Qty</th><th className="num">Rate (₹)</th><th className="num">Amount (₹)</th>{editable && <th />}</tr></thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td className="text-muted">{i + 1}</td>
                <td className="min-w-[260px]">{editable ? <input aria-label={`Item ${i + 1} description`} className="input" value={it.description} onChange={(e) => upd(i, "description", e.target.value)} /> : it.description}</td>
                <td className="w-20">{editable ? <input aria-label={`Item ${i + 1} unit`} className="input" value={it.unit} onChange={(e) => upd(i, "unit", e.target.value)} /> : it.unit}</td>
                <td className="num w-24">{editable ? <input aria-label={`Item ${i + 1} quantity`} className="input text-right" type="number" min="0" value={it.qty} onChange={(e) => upd(i, "qty", e.target.value)} /> : it.qty.toLocaleString("en-IN")}</td>
                <td className="num w-32">{editable ? <input aria-label={`Item ${i + 1} rate`} className="input text-right" type="number" min="0" value={it.rate} onChange={(e) => upd(i, "rate", e.target.value)} /> : inr(it.rate)}</td>
                <td className="num font-mono text-[12.5px]">{inr(it.qty * it.rate)}</td>
                {editable && <td className="w-8"><button type="button" aria-label={`Remove item ${i + 1}`} className="text-muted hover:text-crit" onClick={() => { setDirty(true); setItems((s) => s.filter((_, j) => j !== i)); }}><Trash2 className="size-4" /></button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && (
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
