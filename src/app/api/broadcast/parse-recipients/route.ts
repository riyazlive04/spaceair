import { cookies } from "next/headers";
import { db, schema as S } from "@/db";
import { getUser } from "@/lib/auth";
import { extractPersonalizedRows, listSheetNames } from "@/lib/recipients-import";
import { uid } from "@/lib/automation/ctx";

/**
 * Multipart upload of a .xlsx/.csv file for the personalized broadcast import: every row is its own
 * email (own Name/Email/Subject/Body/CC/BCC/Date/Time — no project code, no shared content). Parses
 * the rows and stashes them for the preview table on the email-automation page to review before
 * queuing (see createPersonalizedBroadcast).
 *
 * If the workbook has more than one sheet and no `sheet` field was submitted, nothing is parsed yet —
 * the file's bytes are stashed instead and the page is asked to show a sheet picker (`?pickSheet=` +
 * `?sheets=`), which re-submits this same route with `sheet` and `upload` set once the user chooses.
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user || user.role !== "owner") return Response.redirect(new URL("/login", req.url), 303);
  const f = await req.formData();
  const back = "/email-automation";
  const chosenSheet = f.get("sheet") ? String(f.get("sheet")) : undefined;
  const uploadKey = f.get("upload") ? String(f.get("upload")) : undefined;

  try {
    let file: File;
    if (uploadKey) {
      // Re-submission after picking a sheet: fetch the previously stashed file bytes.
      const row = await db.query.settings.findFirst({ where: (s, { eq }) => eq(s.key, `broadcast-upload:${uploadKey}`) });
      const stashed = row?.value as { name: string; base64: string } | undefined;
      if (!stashed) return Response.redirect(new URL(`${back}?error=That+upload+expired%2C+please+choose+the+file+again`, req.url), 303);
      const buf = Buffer.from(stashed.base64, "base64");
      file = new File([new Uint8Array(buf)], stashed.name);
    } else {
      const uploaded = f.get("file");
      if (!(uploaded instanceof File) || !/\.(xlsx|csv)$/i.test(uploaded.name)) return Response.redirect(new URL(`${back}?error=Please+choose+an+.xlsx+or+.csv+file`, req.url), 303);
      file = uploaded;
    }

    if (!chosenSheet) {
      const sheets = await listSheetNames(file);
      if (sheets.length > 1) {
        const key = uid();
        const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
        await db
          .insert(S.settings)
          .values({ key: `broadcast-upload:${key}`, value: { name: file.name, base64 } })
          .onConflictDoUpdate({ target: S.settings.key, set: { value: { name: file.name, base64 } } });
        const url = new URL(back, req.url);
        url.searchParams.set("pickSheet", key);
        url.searchParams.set("sheets", sheets.join(","));
        return Response.redirect(url, 303);
      }
    }

    const rows = await extractPersonalizedRows(file, chosenSheet);
    if (!rows.length) return Response.redirect(new URL(`${back}?error=No+valid+rows+found+%E2%80%94+each+row+needs+Email%2C+Subject+and+Body`, req.url), 303);
    const key = uid();
    await db.insert(S.settings).values({ key: `broadcast-rows:${key}`, value: rows }).onConflictDoUpdate({ target: S.settings.key, set: { value: rows } });
    const url = new URL(back, req.url);
    url.searchParams.set("rows", key);
    (await cookies()).set("sa_flash", encodeURIComponent(`Found ${rows.length} email${rows.length === 1 ? "" : "s"} — review before queuing`), { path: "/", maxAge: 20 });
    return Response.redirect(url, 303);
  } catch (e) {
    return Response.redirect(new URL(`${back}?error=${encodeURIComponent((e as Error).message)}`, req.url), 303);
  }
}
