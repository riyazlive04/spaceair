import { desc, eq } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { requireUser } from "@/lib/auth";
import { ago, cn } from "@/lib/format";
import { markAllRead, openNotification } from "@/lib/actions";
import { Card, PageHeader, Empty } from "@/components/ui";
import { Submit } from "@/components/client";

export const metadata = { title: "Inbox" };

export default async function Inbox() {
  const user = await requireUser();
  const now = new Date();
  const list = await db.select().from(S.notifications).where(eq(S.notifications.userId, user.id)).orderBy(desc(S.notifications.createdAt)).limit(100);
  return (
    <>
      <PageHeader
        title="Inbox"
        sub="Alerts routed to you by role and branch. Escalations go to the next level only when the first level hasn't acted."
        actions={<form action={markAllRead}><Submit>Mark all read</Submit></form>}
      />
      <Card>
        {list.map((n) => (
          <form key={n.id} action={openNotification.bind(null, n.id, n.link ?? "")}>
            <button type="submit" className={cn("grid w-full grid-cols-[auto_minmax(0,1fr)_auto] gap-3 border-t border-line py-2.5 text-left text-[13px] hover:bg-surface-2", !n.read && "font-medium")}>
              <span className={cn("mt-1.5 size-2 rounded-full", n.read ? "bg-line" : n.severity === "crit" ? "bg-crit" : n.severity === "warn" ? "bg-warn" : "bg-accent")} aria-hidden />
              <span>
                {n.title}
                {n.body && <span className="block text-xs font-normal text-muted">{n.body}</span>}
              </span>
              <span className="font-mono text-[11px] font-normal text-muted">{ago(n.createdAt, now)}</span>
            </button>
          </form>
        ))}
        {!list.length && <Empty>No notifications.</Empty>}
      </Card>
    </>
  );
}
