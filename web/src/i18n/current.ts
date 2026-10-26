import { EN } from "./en";
import { JA } from "./ja";

/*
 * The language being rendered (Kai 2026-10-27). The app root sets it before rendering and remounts the tree
 * when it changes, so components and formatters can read it without hooks. The server always renders 繁中.
 */

export type Lang = "zh" | "en" | "ja";
let current: Lang = "zh";
export const getLang = () => current;
export const setRenderLang = (l: Lang) => {
  current = l;
};

const DICTS: Record<Lang, Record<string, string> | null> = { zh: null, en: EN, ja: JA };

/** `t("距離出發還有 {n} 天", { n: 8 })`: the Chinese text is the key; {name} placeholders are filled in. */
export function t(zh: string, vars?: Record<string, string | number>): string {
  const d = DICTS[current];
  let s = (d && d[zh]) || zh;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

type Translatable = { tr?: Partial<Record<"en" | "ja", Record<string, string | string[] | undefined>>> };

/** Translated trip content: the data's `tr` field for the current language, else the Chinese original. */
export function tx(o: Translatable | undefined | null, field: string, zh: string | undefined): string {
  if (current === "zh" || !o?.tr) return zh ?? "";
  const v = o.tr[current]?.[field];
  return typeof v === "string" && v ? v : (zh ?? "");
}
