import { cookies } from "next/headers";
import { getUser } from "@/lib/auth";
import { importBoq } from "@/lib/boq-import";

/** Multipart upload of a client/consultant BOQ (.xlsx). Redirects to the new quotation. */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return Response.redirect(new URL("/login", req.url), 303);
  const f = await req.formData();
  const file = f.get("file");
  const next = String(f.get("next") ?? "");
  const toOmc = next === "boq" || next === "omc"; // uploaded from the BOQ → OMC section; "omc" = download it straight away
  const back = toOmc ? "/boq" : "/quotations/import";
  if (!(file instanceof File) || !/\.xlsx$/i.test(file.name)) return Response.redirect(new URL(`${back}?error=Please+choose+an+.xlsx+BOQ+file`, req.url), 303);
  try {
    const due = String(f.get("dueAt") ?? "");
    const r = await importBoq(file, {
      user,
      opportunityId: String(f.get("opportunityId") ?? "") || undefined,
      branch: String(f.get("branch") ?? user.branch),
      division: String(f.get("division") ?? "") || undefined,
      dueAt: due ? new Date(`${due}T18:00:00`) : null,
    });
    (await cookies()).set("sa_flash", encodeURIComponent(`BOQ imported: ${r.lines} lines, auto-priced from the rate library, ${r.coded} product-coded`), { path: "/", maxAge: 20 });
    const dest = next === "omc" ? `/boq/${r.quotationId}?download=omc` : toOmc ? `/boq/${r.quotationId}` : `/quotations/${r.quotationId}`;
    return Response.redirect(new URL(dest, req.url), 303);
  } catch (e) {
    return Response.redirect(new URL(`${back}?error=${encodeURIComponent((e as Error).message)}`, req.url), 303);
  }
}
