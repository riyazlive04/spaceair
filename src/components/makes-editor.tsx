"use client";

import { useState, useTransition } from "react";
import { saveMakes } from "@/lib/actions";
import type { ApprovedMake } from "@/db/schema";

/** Pick one make per item from the consultant's approved list; written back into the client's workbook on export. */
export function MakesEditor({ id, makes, editable }: { id: string; makes: ApprovedMake[]; editable: boolean }) {
  const [sel, setSel] = useState<Record<string, string>>(Object.fromEntries(makes.map((m) => [m.item, m.selected ?? ""])));
  const [pending, start] = useTransition();
  const filled = Object.values(sel).filter(Boolean).length;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted">{filled} of {makes.length} selected. Choices are filled into the "Make selected by vendor" column of the client's file.</p>
      <div className="max-h-80 overflow-auto">
        {makes.map((m) => (
          <label key={m.item} className="grid grid-cols-[minmax(0,1fr)_130px] items-center gap-2 border-t border-line py-1.5 text-[12.5px] first:border-0">
            <span className="truncate" title={m.item}>{m.item}</span>
            <select className="input py-1 text-[12px]" value={sel[m.item] ?? ""} disabled={!editable} onChange={(e) => setSel((s) => ({ ...s, [m.item]: e.target.value }))} aria-label={`Make for ${m.item}`}>
              <option value="">—</option>
              {m.makes.map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
        ))}
      </div>
      {editable && (
        <button type="button" className="btn btn-sm self-start" disabled={pending} onClick={() => start(async () => { await saveMakes(id, sel); })}>
          {pending ? "Saving…" : "Save makes"}
        </button>
      )}
    </div>
  );
}
