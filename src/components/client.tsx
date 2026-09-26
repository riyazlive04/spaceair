"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/format";

/** Shows the one-shot message a server action left in the sa_flash cookie. */
export function Flash() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      const m = document.cookie.split("; ").find((c) => c.startsWith("sa_flash="));
      if (m) {
        setMsg(decodeURIComponent(decodeURIComponent(m.split("=")[1])));
        document.cookie = "sa_flash=; Max-Age=0; path=/";
      }
    };
    read();
    const t = setInterval(read, 400);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(t);
  }, [msg]);
  if (!msg) return null;
  return (
    <div role="status" className="fixed bottom-5 left-1/2 z-50 max-w-[calc(100%-32px)] -translate-x-1/2 rounded-md bg-ink px-4 py-2.5 text-[13px] font-medium text-surface shadow-xl">
      {msg}
    </div>
  );
}

export function Submit({ children, className, pendingText }: { children: ReactNode; className?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cn("btn", className)}>
      {pending ? pendingText ?? "Saving…" : children}
    </button>
  );
}

/** Small disclosure used for inline forms (log response, disqualify, new task…). */
export function Reveal({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      {!open ? (
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          {label}
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          {children}
          <button type="button" className="self-start text-xs text-muted hover:underline" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export function AutoSubmitSelect({ name, defaultValue, options, className, label }: { name: string; defaultValue: string; options: { value: string; label: string }[]; className?: string; label: string }) {
  return (
    <select
      name={name}
      aria-label={label}
      defaultValue={defaultValue}
      className={cn("input w-auto", className)}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
