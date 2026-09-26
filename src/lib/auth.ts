import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { User } from "@/db/schema";

const COOKIE = "sa_session";
const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "spaceair-local-dev-secret-change-in-production");

export async function createSession(userId: string) {
  const token = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 7 * 86400 });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function getUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    const u = await db.query.users.findFirst({ where: eq(schema.users.id, String(payload.uid)) });
    return u && u.active ? u : null;
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<User> {
  const u = await getUser();
  if (!u) redirect("/login");
  return u;
}

/** Owner and Accounts see every branch (optionally filtered); everyone else sees their own branch. */
export async function branchScope(user: User): Promise<string | null> {
  if (user.role === "owner" || user.role === "accounts") {
    const b = (await cookies()).get("sa_branch")?.value;
    return b && b !== "All" ? b : null;
  }
  return user.branch;
}

export const canApprove = (u: User, approverRole: string, branch: string | null) =>
  u.role === "owner" || (u.role === approverRole && (!branch || u.branch === branch));
