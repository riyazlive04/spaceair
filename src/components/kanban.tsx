"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { STAGES, DIVISIONS, LOST_REASONS, type StageKey } from "@/lib/constants";
import { moveStage } from "@/lib/actions";
import { money, cn } from "@/lib/format";

export type KCard = { id: string; code: string; stage: StageKey; account: string; title: string; division: string; value: number; owner: string; branch: string; next: string; dueLabel: string; late: boolean };

export function Kanban({ cards }: { cards: KCard[] }) {
  const [items, setOptimistic] = useOptimistic(cards, (state, m: { id: string; stage: StageKey }) => state.map((c) => (c.id === m.id ? { ...c, stage: m.stage } : c)));
  const [, start] = useTransition();
  const [over, setOver] = useState<string | null>(null);
  const [pendingLost, setPendingLost] = useState<string | null>(null);
  const [reason, setReason] = useState(LOST_REASONS[0]);

  const move = (id: string, stage: StageKey, lostReason?: string) =>
    start(async () => {
      setOptimistic({ id, stage });
      await moveStage(id, stage, lostReason);
    });

  return (
    <>
      <div className="grid auto-cols-[minmax(236px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
        {STAGES.map((s) => {
          const list = items.filter((c) => c.stage === s.key);
          return (
            <div
              key={s.key}
              data-stage={s.key}
              onDragOver={(e) => { e.preventDefault(); setOver(s.key); }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData("text/plain");
                const card = items.find((c) => c.id === id);
                if (!card || card.stage === s.key) return;
                if (s.key === "lost") setPendingLost(id);
                else move(id, s.key);
              }}
              className={cn("flex min-h-[320px] flex-col gap-2 rounded-lg bg-surface-2 p-2.5", over === s.key && "outline-2 outline-dashed -outline-offset-2 outline-accent")}
            >
              <div className="flex items-baseline justify-between px-1 pb-1">
                <b className="h-display text-[12.5px] uppercase tracking-[0.04em]">{s.label}</b>
                <span className="font-mono text-[11px] text-muted">{list.length} · {money(list.reduce((a, c) => a + c.value, 0))}</span>
              </div>
              {list.map((c) => (
                <div
                  key={c.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", c.id)}
                  className="flex cursor-grab flex-col gap-1.5 rounded-md border border-line bg-surface p-2.5 hover:border-accent active:cursor-grabbing"
                >
                  <Link href={`/opportunities/${c.id}`} className="text-[13px] font-semibold hover:underline">{c.account}</Link>
                  <span className="text-[12.5px] leading-snug text-ink-2">{c.title}</span>
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[12px]"><span className="size-2 rounded-[2px]" style={{ background: DIVISIONS[c.division as keyof typeof DIVISIONS] }} />{c.division}</span>
                    <span className="font-mono text-[12.5px]">{money(c.value)}</span>
                  </div>
                  <div className={cn("border-t border-dashed border-line pt-1.5 text-[11.5px]", c.late ? "text-crit" : "text-muted")}>
                    {c.next} · {c.dueLabel}
                    <div className="text-muted">{c.owner} · {c.branch}</div>
                  </div>
                  <label className="sr-only" htmlFor={`mv-${c.id}`}>Move {c.code}</label>
                  <select id={`mv-${c.id}`} value={c.stage} onChange={(e) => (e.target.value === "lost" ? setPendingLost(c.id) : move(c.id, e.target.value as StageKey))} className="rounded border border-line bg-surface px-1 py-0.5 text-[11px] text-muted md:hidden">
                    {STAGES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {pendingLost && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="lost-h">
          <div className="card flex w-full max-w-sm flex-col gap-3 shadow-xl">
            <h2 id="lost-h" className="h-display text-[17px]">Why was this deal lost?</h2>
            <p className="text-xs text-muted">The branch head gets a review task, and a 90-day check-in with the client is scheduled.</p>
            <select className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Lost reason">
              {LOST_REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <button className="btn" type="button" onClick={() => setPendingLost(null)}>Cancel</button>
              <button className="btn btn-danger" type="button" onClick={() => { move(pendingLost, "lost", reason); setPendingLost(null); }}>Mark lost</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
