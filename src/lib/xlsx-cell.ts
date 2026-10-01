import type { Cell } from "exceljs";

/** The cell's display text, whatever its underlying value type (plain string, hyperlink, rich text, formula result). String(cell.value) alone breaks on hyperlink/rich-text cells (yields "[object Object]"). */
export function cellText(cell: Cell): string {
  if (cell.text) return cell.text;
  const v = cell.value;
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && "hyperlink" in v) return String((v as { text?: unknown }).text ?? v.hyperlink ?? "");
  if (typeof v === "object" && "richText" in v) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
  if (typeof v === "object" && "result" in v) return String((v as { result?: unknown }).result ?? "");
  return String(v);
}
