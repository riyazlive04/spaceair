import { connection } from "next/server";
import { db, schema as S } from "@/db";
import { loginAs } from "@/lib/actions";
import { ROLE_LABELS } from "@/lib/constants";
import { Logo } from "@/components/logo";

export const metadata = { title: "Sign in" };

const ORDER = ["owner", "branch_head", "sales", "estimator", "projects", "procurement", "service_manager", "technician", "accounts"];

export default async function Login() {
  await connection();
  const users = (await db.select().from(S.users)).sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role));
  const featured = ["u-owner", "u-bh-che", "u-karthik", "u-anitha", "u-gokul", "u-prakash", "u-manoj", "u-lakshmi"];
  return (
    <main className="mx-auto flex min-h-full max-w-5xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-2">
        <Logo height={56} />
        <h1 className="h-display max-w-2xl text-[34px] leading-[1.1]" style={{ fontStretch: "82%" }}>
          One system from first enquiry to AMC renewal, run by the team rather than by one person.
        </h1>
        <p className="max-w-2xl text-ink-2">
          Choose a role to sign in. Each role sees its own branch, queue and approvals. In production this becomes Microsoft 365 or Google single sign-on with OTP.
        </p>
      </div>
      <section className="flex flex-col gap-3">
        <h2 className="label">Suggested demo roles</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {featured.map((id) => {
            const u = users.find((x) => x.id === id);
            if (!u) return null;
            return (
              <form key={u.id} action={loginAs}>
                <input type="hidden" name="userId" value={u.id} />
                <button type="submit" className="card flex w-full cursor-pointer flex-col items-start gap-1 text-left hover:border-accent" data-login={u.id}>
                  <span className="text-[15px] font-semibold">{u.name}</span>
                  <span className="text-xs text-accent">{ROLE_LABELS[u.role]}</span>
                  <span className="text-xs text-muted">{u.title} · {u.branch}</span>
                </button>
              </form>
            );
          })}
        </div>
      </section>
      <details className="card">
        <summary className="cursor-pointer text-[13px] font-medium">All {users.length} users</summary>
        <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2">
          {users.map((u) => (
            <form key={u.id} action={loginAs}>
              <input type="hidden" name="userId" value={u.id} />
              <button type="submit" className="w-full rounded-md border border-line px-3 py-2 text-left text-[13px] hover:bg-surface-2">
                <b className="font-medium">{u.name}</b>
                <span className="block text-[11.5px] text-muted">
                  {ROLE_LABELS[u.role]} · {u.branch}
                </span>
              </button>
            </form>
          ))}
        </div>
      </details>
      <p className="text-xs text-muted">Prototype by Sirah Digital · all records are sample data.</p>
    </main>
  );
}
