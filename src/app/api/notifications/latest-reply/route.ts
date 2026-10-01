import { and, desc, eq, like } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { getUser } from "@/lib/auth";

/** Polled by the client popup: the newest unread "reply on balance reminder / broadcast" notification for this user, if any. */
export async function GET() {
  const user = await getUser();
  if (!user) return Response.json({ notification: null });
  const n = await db.query.notifications.findFirst({
    where: and(eq(S.notifications.userId, user.id), eq(S.notifications.read, false), like(S.notifications.link, "/email-automation%")),
    orderBy: desc(S.notifications.createdAt),
  });
  return Response.json({ notification: n ?? null });
}
