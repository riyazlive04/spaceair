import { cookies } from "next/headers";
import { db, schema as S } from "@/db";
import { getUser } from "@/lib/auth";
import { importPayments } from "@/lib/payments-import";
import { uid } from "@/lib/automation/ctx";

/** Multipart upload of a payments workbook (.xlsx): Project code / Amount / Date / Note. */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user || user.role !== "owner") return Response.redirect(new URL("/login", req.url), 303);
  const f = await req.formData();
  const file = f.get("file");
  const back = "/email-automation";
  if (!(file instanceof File) || !/\.xlsx$/i.test(file.name)) return Response.redirect(new URL(`${back}?error=Please+choose+an+.xlsx+file`, req.url), 303);
  try {
    const r = await importPayments(file);
    const url = new URL(back, req.url);
    if (r.skipped.length) {
      const key = uid();
      await db.insert(S.settings).values({ key: `import-errors:${key}`, value: r.skipped }).onConflictDoUpdate({ target: S.settings.key, set: { value: r.skipped } });
      url.searchParams.set("importErrors", key);
    }
    (await cookies()).set(
      "sa_flash",
      encodeURIComponent(r.skipped.length ? `Imported ${r.imported} payment${r.imported === 1 ? "" : "s"}, skipped ${r.skipped.length} row${r.skipped.length === 1 ? "" : "s"}` : `Imported ${r.imported} payment${r.imported === 1 ? "" : "s"}`),
      { path: "/", maxAge: 20 },
    );
    return Response.redirect(url, 303);
  } catch (e) {
    return Response.redirect(new URL(`${back}?error=${encodeURIComponent((e as Error).message)}`, req.url), 303);
  }
}
