"use client";

import { useEffect, useState, type ChangeEvent, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/format";
import { openNotification } from "@/lib/actions";

/** A <tr> that navigates on click anywhere in the row, without hijacking clicks on links/buttons/inputs inside it. */
export function RowLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const router = useRouter();
  const onClick = (e: MouseEvent<HTMLTableRowElement>) => {
    if ((e.target as HTMLElement).closest("a, button, input, select, textarea")) return;
    router.push(href);
  };
  return (
    <tr className={cn("row-link cursor-pointer", className)} onClick={onClick}>
      {children}
    </tr>
  );
}

/** Polls for a new balance-reminder reply and shows a dismissible popup with a button straight to it. */
export function ReplyPopup() {
  const [n, setN] = useState<{ id: string; title: string; body: string | null; link: string | null } | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/notifications/latest-reply");
        const data = await res.json();
        if (!cancelled) setN(data.notification);
      } catch {
        // ignore transient fetch errors, next poll retries
      }
    };
    poll();
    const t = setInterval(poll, 20000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);
  if (!n || n.id === dismissed) return null;
  return (
    <div role="alert" className="fixed bottom-5 right-5 z-50 w-[340px] rounded-lg border border-accent bg-surface p-4 shadow-xl">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[13px] font-semibold">{n.title}</div>
        <button type="button" onClick={() => setDismissed(n.id)} aria-label="Dismiss" className="text-muted hover:text-ink">×</button>
      </div>
      {n.body && <p className="mt-1 text-[12.5px] text-muted">{n.body}</p>}
      <form action={openNotification.bind(null, n.id, n.link ?? "/notifications")} className="mt-3">
        <Submit className="btn-primary w-full">View reply</Submit>
      </form>
    </div>
  );
}

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

export function Submit({ children, className, pendingText, name, value }: { children: ReactNode; className?: string; pendingText?: string; name?: string; value?: string }) {
  const { pending, data } = useFormStatus();
  // with several submit buttons, only the one that was clicked shows the pending text
  const mine = !name || !data || data.get(name) === value;
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={cn("btn", className)}>
      {pending && mine ? pendingText ?? "Saving…" : children}
    </button>
  );
}

/** Starts a file download once, when the page loads (e.g. right after an upload). */
export function AutoDownload({ href }: { href: string }) {
  useEffect(() => {
    const a = document.createElement("a");
    a.href = href;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // drop ?download=… so a refresh doesn't download again
    const url = new URL(window.location.href);
    url.searchParams.delete("download");
    window.history.replaceState(null, "", url);
  }, [href]);
  return null;
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

/** A checkbox that toggles every input[name=itemName] inside the same <form>. */
export function SelectAllCheckbox({ itemName, className, label }: { itemName: string; className?: string; label: string }) {
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const form = e.currentTarget.form;
    form?.querySelectorAll<HTMLInputElement>(`input[name="${itemName}"]`).forEach((el) => (el.checked = e.currentTarget.checked));
  };
  return <input type="checkbox" className={className} onChange={onChange} aria-label={label} />;
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
