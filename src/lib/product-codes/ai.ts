/**
 * AI product-code agent: fills Details + Free Fields for lines the rules could not code confidently.
 * Claude sees the SAPL legend, the item master and the team's closest existing codes (the register is
 * its memory), then answers in a fixed JSON shape. Every answer is validated here before it is stored,
 * and nothing enters the register until a person approves it.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { CATEGORIES, DISCIPLINES, FREE_FIELD_EXAMPLES, ITEMS } from "./master";
import { abbreviation, categoryText } from "./engine";

const MODEL = "claude-opus-5";

export const aiAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY);

const Segment = z.object({ code: z.string(), meaning: z.string() });
const Answer = z.object({
  discipline: Segment,
  category: Segment,
  details: Segment,
  free1: Segment,
  free2: Segment,
  free3: Segment,
  product_name: z.string(),
  unit: z.string(),
  reuse_existing_code: z.string(),
  parent_material_code: z.string(),
  new_details_code: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]),
  reasoning: z.string(),
  questions_for_sales: z.array(z.string()),
});
type Answer = z.infer<typeof Answer>;

const SEGMENTS: [keyof Answer & ("discipline" | "category" | "details" | "free1" | "free2" | "free3"), number][] = [
  ["discipline", 1], ["category", 1], ["details", 4], ["free1", 4], ["free2", 4], ["free3", 2],
];

/** Stable across calls, so it is prompt-cached. */
const SYSTEM = `You assign product codes for SPACEAIR, an HVAC / MEP contractor in India. Every internal team
(procurement, stores, execution, billing) works from these codes, so the same product must always get
the same code, and different products must never share one.

CODE FORMAT - exactly 16 characters, uppercase A-Z and 0-9 only:
  Discipline (1) + Category (1) + Details (4) + Free Field 1 (4) + Free Field 2 (4) + Free Field 3 (2)
  Example: AECWPX900X15KWXX = A Air Conditioning, E Equipment, CWPX Condenser Water Pump,
           900X 900 USGPM flow, 15KW 15 kW motor, XX generic.
  Pad unused positions with X (AHU -> AHUX; no size -> XXXX; free field 3 is XX unless a variant or suffix is needed).

DISCIPLINE (1st character):
${DISCIPLINES.map((d) => `  ${d.code} = ${d.name}`).join("\n")}

CATEGORY (2nd character):
${CATEGORIES.map((c) => `  ${c.code} = ${c.name}`).join("\n")}

DETAILS (4 characters) - reuse one of these whenever the item is the same kind of product:
${ITEMS.map((i) => `  ${i.code} = ${i.name} (category ${i.cat})`).join("\n")}
Only create a new 4-character Details code when none of the above fits; then set new_details_code=true
and make it a readable abbreviation (e.g. FCUX, MCCP, SPIS).

FREE FIELD conventions used by the team:
${FREE_FIELD_EXAMPLES.map(([c, m]) => `  ${c} = ${m}`).join("\n")}
Free Field 1 normally carries the primary size/capacity (dia, gauge, CFM, TR, flow, cores x sq.mm).
Free Field 2 carries the key spec that changes the purchased item (material, rating, motor kW, class, FRLS).
Free Field 3 (2 chars) is XX unless you are told to use a variant.

HOW TO DECIDE:
- You will be shown the team's closest existing codes. If one of them is the same product (same
  item, size and spec - wording differences don't matter), return it in reuse_existing_code and
  copy its segments. Consistency with existing codes beats your own preference.
- Follow the patterns in the existing codes for the same Details code (e.g. how they write sizes).
- Items cut or fabricated from a bulk raw material (GI sheet to duct, cable drum to cut lengths, copper
  coil to pipe, insulation roll to thickness) are coded as the item as installed/sold; if an existing code
  is the parent raw material (the bulk stock it is cut or fabricated from - not a similar finished item),
  put it in parent_material_code, otherwise leave it empty.
- Labour-only, testing, balancing, dismantling -> category S (Service) or L (Labour) as appropriate.
- If the description is genuinely ambiguous in a way that changes the code (missing size, material or
  rating), still give your best code, set confidence to low, and ask the question in questions_for_sales.
- product_name: short uppercase name like the team uses, e.g. "POWER CABLE - 3C X 16 SQMM FRLS".
- Each segment's meaning is a short phrase, e.g. "900 USGPM flow rate".`;

export type Known = { code: string; name: string; categoryText: string; unit: string | null };

const STOP = new Set(["supply", "installation", "testing", "commissioning", "of", "and", "the", "with", "for", "to", "in", "sitc", "fixing", "laying", "necessary", "shall", "be", "as", "per", "all", "a"]);
const tokens = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !STOP.has(w)));

/** Closest existing codes by word overlap, plus every code sharing the rule engine's Details guess. */
function nearest(query: string, known: Known[], ruleDetails: string | null, k = 20) {
  const q = tokens(query);
  return known
    .map((r) => {
      const t = tokens(r.name);
      const inter = [...q].filter((w) => t.has(w)).length;
      const score = inter / (new Set([...q, ...t]).size || 1) + (ruleDetails && r.code.slice(2, 6) === ruleDetails ? 1 : 0);
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.r);
}

export type AiResult = {
  code: string;
  name: string;
  unit: string;
  categoryText: string;
  abbreviation: string;
  reused: boolean;
  confidence: string;
  reasoning: string;
  questions: string[];
  checks: string[];
  parentMaterial: string;
};

/** Normalise the model's segments, then check them against the lists and the register. */
export function validate(a: Answer, known: Known[]): AiResult {
  const checks: string[] = [];
  const parts = {} as Record<string, string>;
  for (const [key, size] of SEGMENTS) {
    const raw = a[key].code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (raw.length !== size) checks.push(`${key} "${a[key].code}" is not ${size} characters - adjusted`);
    parts[key] = (raw + "X".repeat(size)).slice(0, size);
  }
  if (!DISCIPLINES.some((d) => d.code === parts.discipline)) checks.push(`Unknown discipline "${parts.discipline}"`);
  if (!CATEGORIES.some((c) => c.code === parts.category)) checks.push(`Unknown category "${parts.category}"`);
  let code = SEGMENTS.map(([k]) => parts[k]).join("");
  let reused = false;

  const byCode = new Map(known.map((k) => [k.code, k]));
  const reuse = a.reuse_existing_code.trim().toUpperCase();
  if (reuse) {
    if (byCode.has(reuse)) {
      code = reuse;
      reused = true;
    } else checks.push(`Suggested reuse code ${reuse} is not in the register - ignored`);
  }
  const same = (x: string, y: string) => [...tokens(x)].sort().join(" ") === [...tokens(y)].sort().join(" ");
  if (!reused && byCode.has(code)) {
    const existing = byCode.get(code)!;
    if (same(existing.name, a.product_name)) reused = true;
    else {
      const base = code.slice(0, 14);
      const taken = new Set([...byCode.keys()].filter((c) => c.startsWith(base)).map((c) => c.slice(14)));
      const variant = Array.from({ length: 99 }, (_, i) => String(i + 1).padStart(2, "0")).find((v) => !taken.has(v))!;
      checks.push(`${code} is already "${existing.name}" - proposed variant ${variant}`);
      code = base + variant;
    }
  }
  const src = reused ? byCode.get(code)! : null;
  return {
    code,
    name: src?.name ?? a.product_name,
    unit: a.unit,
    categoryText: src?.categoryText ?? categoryText(parts.category),
    abbreviation: abbreviation(SEGMENTS.map(([k]) => ({ code: parts[k], meaning: a[k].meaning }))),
    reused,
    confidence: a.confidence,
    reasoning: a.reasoning,
    questions: a.questions_for_sales,
    checks: [...checks, ...(a.new_details_code ? [`New Details code ${parts.details} - add it to the item master if approved`] : [])],
    parentMaterial: a.parent_material_code,
  };
}

export class AiStopped extends Error {}

/** Ask Claude for one line. Throws AiStopped when the whole run should stop (bad key, no credits). */
export async function proposeCode(
  client: Anthropic,
  item: { description: string; context: string; ruleCode: string | null },
  known: Known[],
): Promise<AiResult> {
  const ruleDetails = item.ruleCode && !item.ruleCode.includes("MISC") ? item.ruleCode.slice(2, 6) : null;
  const near = nearest(`${item.description} ${item.context}`, known, ruleDetails);
  const user = [
    "Closest existing codes in the Code Register:",
    near.map((r) => `  ${r.code}  ${r.name}  [${r.categoryText}, ${r.unit ?? ""}]`).join("\n") || "  (none yet)",
    item.ruleCode ? `\nRule engine's first guess (may be wrong or incomplete): ${item.ruleCode}` : "",
    item.context ? `\nBOQ context (heading / surrounding lines):\n${item.context}` : "",
    `\nItem to code:\n${item.description}`,
  ].join("\n");

  let res;
  try {
    res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: zodOutputFormat(Answer) },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiStopped("The Anthropic API key was rejected.");
    if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(e.message)) throw new AiStopped("The Anthropic account is out of credits (Plans & Billing).");
    throw e;
  }
  if (res.stop_reason === "refusal") throw new Error("Claude declined this line - code it manually.");
  if (res.stop_reason === "max_tokens" || !res.parsed_output) throw new Error("No complete answer - try again.");
  return validate(res.parsed_output, known);
}
