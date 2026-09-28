/**
 * Rule engine for SAPL product codes. Port of "Product Code Generator/product_code_generator.py":
 * recognise the item from the BOQ text, then read Free Field 1 (size), Free Field 2 (spec) and the
 * last two characters using the item's rules from master.ts. Lines it cannot code confidently are
 * flagged for the AI agent / a human. Keep in step with the Python tool - eval_against_team.py scores both.
 */
import { CATEGORIES, DISCIPLINES, ITEMS, MISC_CODE, SPECS, type ItemDef } from "./master";

/** One BOQ line plus the text around it (heading, description block, lines just below it). */
export type CodeLine = {
  sl: string;
  line: string;
  heading: string;
  context: string;
  /** description rows under the heading, in order; matched nearest-first */
  contextLines?: string[];
  trailing: string;
  group: string;
  section: string;
  unit: string;
};

export type CodeResult = {
  code: string;
  name: string;
  categoryText: string;
  hsn: string;
  abbreviation: string;
  basis: string;
  /** Why a human should look at this line; empty when the rules are confident. */
  flag: string;
};

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const normNum = (v: string) => String(Number(v));
const pad = (s: string, n = 4) => (s + "X".repeat(n)).slice(0, n);

/** Segment value from a kind + value - same conventions as the team's issued codes and the Python tool. */
export function sizeCode(kind: string | null, value: string | null): string {
  if (!kind || kind === "NONE" || value == null || value === "") return "XXXX";
  const v = String(value).trim().toUpperCase();
  if (kind === "CUSTOM") return pad(v.replace(/[^A-Z0-9]/g, ""));
  if (kind === "CABLE") {
    const [c, a] = v.split(/\s*[XC×*]\s*/);
    return pad(`${parseInt(c, 10)}C${normNum(a).replace(".", "")}`);
  }
  const n = normNum(v);
  const s = n.replace(".", "");
  const dec = n.replace(".", "P"); // the team writes decimals with P: 5.5 -> 5P5
  const isDec = n.includes(".");
  if (kind === "MM" || kind === "THK") return s.length <= 2 ? pad(s + "MM") : pad(s + "M"); // 25MM, 9MMX, 150M
  if (kind === "GAUGE") return pad(s + "G");
  if (kind === "TR") return isDec ? pad(dec + "T") : pad(n + "TR"); // 3TRX, 12TR, 2P5T
  if (kind === "HP") return isDec ? pad(dec + "H") : pad(n + "HP");
  if (kind === "KW") return isDec ? pad(dec + "W") : pad(n + "KW"); // 15KW, 5P5W, 0P15
  if (kind === "FLOW") {
    const f = Math.trunc(Number(v));
    if (f >= 10000) {
      const k = Math.floor(f / 1000), rest = f % 1000;
      return rest === 0 ? pad(`${k}KC`) : pad(`${k}K${Math.floor(rest / 100)}`); // 12KC, 10K5
    }
    return pad(String(f)); // 450X, 4000
  }
  return "XXXX";
}

type Hit = [kind: string, value: string, desc: string] | null;
const re = (src: string) => new RegExp(src, "i");
const ESP = String.raw`(\d+)\s*mm\.?\s*(?:w\.?c|w\.?g)`;
const EXTRACTORS: Record<string, (t: string) => Hit> = {
  DIA: (t) => {
    const m = t.match(re(String.raw`(?:Φ|ø|dia\.?)\s*` + NUM + String.raw`\s*mm`)) ?? t.match(re(NUM + String.raw`\s*(?:mm\.?\s*)?(?:dia|Φ|ø)`));
    return m ? ["MM", m[1], `${normNum(m[1])} MM Dia`] : null;
  },
  THK: (t) => {
    const m = t.match(re(NUM + String.raw`\s*mm\.?\s*thick`));
    return m ? ["THK", m[1], `${normNum(m[1])} MM Thickness`] : null;
  },
  MM: (t) => {
    const m = t.match(re(NUM + String.raw`\s*mm\b`));
    return m ? ["MM", m[1], `${normNum(m[1])}MM`] : null;
  },
  WIDTH: (t) => {
    const m = t.match(/(\d+)\s*mm\s*(?:wide|w\b|x)/i);
    return m ? ["MM", m[1], `${m[1]}MM Width`] : null;
  },
  SQDIM: (t) => {
    const m = t.match(/(\d+)\s*(?:mm)?\s*x\s*(\d+)\s*(?:x\s*\d+\s*)?mm/i);
    return m ? ["MM", m[1], `${m[1]}x${m[2]} MM`] : null;
  },
  WXD: (t) => {
    const m = t.match(/(\d+)\s*mm\s*\(?w\)?\s*x\s*(\d+)\s*mm/i);
    if (!m) return null;
    const w = Number(m[1]), d = Number(m[2]);
    const code = w < 100 ? `${w}${d}` : `${String(Math.floor(w / 10)).padStart(2, "0")}${String(Math.floor(d / 10)).padStart(2, "0")}`;
    return ["CUSTOM", code, `${w}x${d} MM`];
  },
  TTHK: (t) => {
    const m = t.match(re(String.raw`x\s*` + NUM + String.raw`\s*mm\.?\s*\(?\s*t`));
    return m ? ["MM", m[1], `${normNum(m[1])} MM Thickness`] : null;
  },
  GAUGE: (t) => {
    const m = t.match(/\b(\d{2})\s*G\b/);
    return m ? ["GAUGE", m[1], `${m[1]} Gauge`] : null;
  },
  TR: (t) => {
    const m = t.match(re(NUM + String.raw`\s*TR\b`));
    return m ? ["TR", m[1], `${normNum(m[1])} TR Capacity`] : null;
  },
  HP: (t) => {
    const m = t.match(re(NUM + String.raw`\s*HP\b`));
    return m ? ["HP", m[1], `${normNum(m[1])} HP`] : null;
  },
  KW: (t) => {
    const m = t.match(re(NUM + String.raw`\s*kw\b(?!\s*/)`)); // not "0.04 kW/RT"
    return m ? ["KW", m[1], `${normNum(m[1])} KW`] : null;
  },
  CFM: (t) => {
    const m = t.match(/(?:(\d+)\s*-\s*)?(\d[\d,]*)\s*cfm/i);
    if (!m) return null;
    const v = m[2].replace(/,/g, "");
    return ["FLOW", v, `${v} CFM`];
  },
  USGPM: (t) => {
    const m = t.match(/each pump flow rate\s*:?\s*(\d+)/i) ?? t.match(/(\d+)\s*usgpm/i);
    return m ? ["FLOW", m[1], `${m[1]} USGPM Flow Rate`] : null;
  },
  CABLE: (t) => {
    const m = t.match(re(String.raw`(\d+)\s*(?:C|core)\s*[xX×]?\s*` + NUM + String.raw`\s*sq`));
    return m ? ["CABLE", `${m[1]}x${m[2]}`, `${m[1]} Core x ${normNum(m[2])} Sq.mm`] : null;
  },
  SLOT: (t) => {
    const m = t.match(/(\d+)\s*slot/i);
    return m ? ["CUSTOM", `${m[1]}SLT`, `${m[1]} Slot`] : null;
  },
  STRIP: (t) => {
    const m = t.match(/(\d+)\s*x\s*(\d+)\s*mm/i);
    return m ? ["CUSTOM", `${m[1]}${m[2].padStart(2, "0")}`, `${m[1]}x${m[2]} MM`] : null;
  },
  SWG: (t) => {
    const m = t.match(/(\d+)\s*swg/i);
    return m ? ["CUSTOM", m[1].length === 1 ? `${m[1]}SWG` : `${m[1]}SG`, `${m[1]} SWG`] : null;
  },
  LITRE: (t) => {
    const m = t.match(/(\d+)\s*lit/i);
    return m ? ["CUSTOM", m[1], `${m[1]} Litres`] : null;
  },
  ESP: (t) => {
    const m = t.match(re(ESP));
    return m ? ["RAW", m[1], `${m[1]} MM Static Pressure`] : null;
  },
  ESPMM: (t) => {
    const m = t.match(re(ESP));
    return m ? ["MM", m[1], `${m[1]} MM Static Pressure`] : null;
  },
  INSTHK: (t) => {
    const m = t.match(/(\d+)\s*mm\.?\s*(?:thick\w*\s*)?(?:\w+\s*)?insulation/i);
    return m ? ["MM", m[1], `${m[1]} MM Insulation Thickness`] : null;
  },
  COUNT: (t) => {
    const m = t.match(/(\d+)\s*actuators?/i);
    return m ? ["CUSTOM", `${m[1]}ACT`, `${m[1]} Actuators`] : null;
  },
  TORQUE: (t) => {
    const m = t.match(/(\d+)\s*nm\b/i);
    return m ? ["CUSTOM", `${m[1]}NM`, `${m[1]} Nm Torque`] : null;
  },
};

const SPEC_BY_CODE = new Map(SPECS.map((s) => [s.code, s]));

/**
 * Read one segment with a rule from master.ts ("DIA|MM", "@WINS|@PN16", "FIX:R410", "ATTR", "MOTORKW"...).
 * Sizes search the nearest text first; specs (priorityFirst) treat the alternatives as a priority list.
 * An alternative ending in "!" only looks at the line, the lines below it and its heading.
 */
export function extractField(rule: string, texts: string[], width = 4, priorityFirst = false): [string, string] {
  const blank = "X".repeat(width);
  const r = (rule ?? "").trim();
  if (!r || r.toUpperCase() === "NONE") return [blank, ""];
  const alts = r.split("|").map((a) => a.trim()).filter(Boolean);
  const fixed = alts.find((a) => a.toUpperCase().startsWith("FIX:"));
  if (fixed) {
    const code = fixed.slice(4).trim().toUpperCase();
    return [(code + blank).slice(0, width), SPEC_BY_CODE.get(code)?.name ?? ""];
  }
  const near = Math.min(3, texts.length);
  const order: [number, string][] = priorityFirst
    ? alts.flatMap((a) => texts.map((_, i) => [i, a] as [number, string]))
    : texts.flatMap((_, i) => alts.map((a) => [i, a] as [number, string]));
  for (const [i, raw] of order) {
    const text = texts[i];
    let alt = raw;
    if (alt.endsWith("!")) {
      if (i >= near) continue;
      alt = alt.slice(0, -1);
    }
    if (!text) continue;
    const up = alt.toUpperCase();
    if (up === "MOTORKW") {
      const m = text.match(re(String.raw`motor rating\s*:?\s*[<≤]?\s*` + NUM + String.raw`\s*kw`));
      if (m) return [sizeCode("KW", m[1]), `${normNum(m[1])} KW Motor Rating`];
    } else if (up === "ATTR") {
      const s = SPECS.find((x) => x.re.test(text));
      if (s) return [s.code, s.name];
    } else if (up.startsWith("@")) {
      const s = SPEC_BY_CODE.get(up.slice(1));
      if (s?.re.test(text)) return [s.code, s.name];
    } else if (EXTRACTORS[up]) {
      const hit = EXTRACTORS[up](text);
      if (hit) return hit[0] === "RAW" ? [(hit[1] + blank).slice(0, width), hit[2]] : [sizeCode(hit[0], hit[1]).slice(0, width), hit[2]];
    }
  }
  return [blank, ""];
}

/** Where segment values are looked for, most specific first. */
const fieldTexts = (ln: CodeLine) => [ln.line, ln.trailing, ln.heading, ln.context, ln.section];

/** "COLLAR DAMPER : Supply, ..." -> "COLLAR DAMPER"; short texts as-is; long ones -> "". */
export function titleOf(text: string): string {
  if (!text) return "";
  const m = text.match(/^([^:\n]{3,90}?)\s*:/);
  if (m && /[A-Za-z]{3}/.test(m[1])) return m[1];
  return text.length <= 90 ? text : "";
}

/** Earliest keyword hit in the first text that has any hit; ties go to master order. */
function matchItem(texts: string[]): [ItemDef | null, number] {
  for (const [level, text] of texts.entries()) {
    if (!text) continue;
    let best: { pos: number; order: number; it: ItemDef } | null = null;
    ITEMS.forEach((it, order) => {
      const m = it.re.exec(text);
      if (m && (!best || m.index < best.pos || (m.index === best.pos && order < best.order))) best = { pos: m.index, order, it };
    });
    if (best) return [(best as { it: ItemDef }).it, level];
  }
  return [null, -1];
}

const DEEP = new Set(["Item description", "Lines below item", "Section"]);

/** Short, name-like texts are tried before long descriptions (which mention other items).
 *  A row with its own Sl. No is its own item; a row without one describes the heading above it.
 *  Description rows are tried nearest-first ("Flat oval VAV Unit shall be..." right above a size list). */
export function matchLine(ln: CodeLine): { item: ItemDef | null; basis: string; weak: boolean } {
  const own: [string, string][] = [["Line title", titleOf(ln.line)], ["Line text (start)", ln.line.slice(0, 150)]];
  const head: [string, string][] = [["Heading title", titleOf(ln.heading)], ["Group column", ln.group]];
  const desc = [...(ln.contextLines?.length ? ln.contextLines : [ln.context])].reverse().map((t) => ["Item description", t] as [string, string]);
  const order = [...(ln.sl ? [...own, ...head] : [...head, ...own]), ["Line text", ln.line], ["Heading text", ln.heading], ...desc,
    ["Lines below item", ln.trailing], ["Section", ln.section]] as [string, string][];
  const [item, level] = matchItem(order.map(([, t]) => t));
  const basis = item ? order[level][0] : "-";
  return { item, basis, weak: !item || DEEP.has(basis) };
}

export const categoryText = (c: string) => CATEGORIES.find((x) => x.code === c)?.text ?? "";
const categoryName = (c: string) => CATEGORIES.find((x) => x.code === c)?.name ?? "?";
const disciplineName = (c: string) => DISCIPLINES.find((x) => x.code === c)?.name ?? "?";

export function abbreviation(parts: { code: string; meaning: string }[]): string {
  return parts.map((p) => (/^X+$/.test(p.code) || !p.meaning ? p.code : `${p.code} - ${p.meaning}`)).join(",\n");
}

/** Code one line with the rules. */
export function codeLine(ln: CodeLine, discipline = "A"): CodeResult {
  const { item, basis, weak } = matchLine(ln);
  if (!item) {
    return {
      code: `${discipline}A${MISC_CODE}XXXXXXXXXX`, name: "UNMAPPED ITEM", categoryText: categoryText("A"), hsn: "",
      abbreviation: "", basis, flag: "No rule matched - use AI review or code manually",
    };
  }
  const cat = item.cat || "A";
  const texts = fieldTexts(ln);
  const [size, sizeDesc] = extractField(item.size, texts);
  const [spec, specDesc] = extractField(item.spec, texts, 4, true);
  const [free3, free3Desc] = extractField(item.free3, texts, 2, true);
  return {
    code: `${discipline}${cat}${item.code}${size}${spec}${free3}`,
    name: [item.name.toUpperCase(), sizeDesc.toUpperCase(), specDesc.toUpperCase(), free3Desc.toUpperCase()].filter(Boolean).join(" - "),
    categoryText: categoryText(cat),
    hsn: item.hsn,
    abbreviation: abbreviation([
      { code: discipline, meaning: disciplineName(discipline) },
      { code: cat, meaning: categoryName(cat) },
      { code: item.code, meaning: item.name },
      { code: size, meaning: sizeDesc },
      { code: spec, meaning: specDesc },
      { code: free3, meaning: free3Desc },
    ]),
    basis,
    flag: weak ? `Matched only on ${basis.toLowerCase()} - check` : "",
  };
}

/** Codes given to lines under different BOQ headings may be different products - flag them. */
export function clashFlags(lines: { code: string; heading: string; line: string }[]): Set<string> {
  const byCode = new Map<string, Set<string>>();
  for (const l of lines) {
    if (l.code.includes(MISC_CODE)) continue;
    const set = byCode.get(l.code) ?? new Set<string>();
    set.add((l.heading || l.line).slice(0, 60).toLowerCase());
    byCode.set(l.code, set);
  }
  return new Set([...byCode].filter(([, h]) => h.size > 1).map(([c]) => c));
}
