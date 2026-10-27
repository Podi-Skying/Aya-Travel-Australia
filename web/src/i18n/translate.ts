import { EN } from "./en";
import { JA } from "./ja";
import type { Lang } from "./current";

/*
 * Text lookup for the on-screen translator (DomTranslator): the UI dictionaries (en.ts / ja.ts, keyed by the
 * Chinese source) plus the trip's own translations; templates match as patterns, and longer text is split into
 * sentences, bracket notes and list items that are looked up one by one.
 */

const DICTS: Record<Exclude<Lang, "zh">, Record<string, string>> = { en: EN, ja: JA };
export const CJK = /[㐀-鿿、-】（-？]/;

type Rule = { re: RegExp; out: string };

function rulesFor(source: Record<string, string>): Rule[] {
  let dict = source;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Only patterns with real words around the gaps: "{0}「{1}」{2}" would swallow any text with brackets.
  const words = (k: string) => (k.replace(/\{(\d+|n)\}/g, "").match(/[\u3400-\u9fff]/g) ?? []).length;
  // Two gaps side by side ("{0}{1}，高溫…") cannot be told apart: one gap takes both.
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(dict)) {
    let mk = k;
    let mv = v;
    for (let m = /\{(\d+|n)\}\{(\d+|n)\}/.exec(mk); m; m = /\{(\d+|n)\}\{(\d+|n)\}/.exec(mk)) {
      mk = mk.replace(m[0], `{${m[1]}}`);
      mv = mv.replace(`{${m[1]}}{${m[2]}}`, `{${m[1]}}`).replace(`{${m[2]}}`, "");
    }
    merged[mk] = mv;
  }
  // One word is enough when the gaps sit inside the text (「（約 {0} mm）」), not at its ends.
  const ok = (k: string) => words(k) >= 2 || (words(k) >= 1 && !/^\{/.test(k) && !/\}$/.test(k));
  dict = merged;
  return Object.keys(dict)
    .filter((k) => /\{(\d+|n)\}/.test(k) && ok(k))
    .sort((a, b) => b.length - a.length)
    .map((k) => {
      const names: string[] = [];
      const src = esc(k).replace(/\\\{(\d+|n)\\\}/g, (_, n) => {
        names.push(n);
        return "(.+?)";
      });
      let out = dict[k];
      names.forEach((n, i) => (out = out.split(`{${n}}`).join(`$${i + 1}`)));
      return { re: new RegExp(`^${src}$`), out };
    });
}

/** Text is often shown without the punctuation it was written with (「，有提醒」 inside a list): both forms. */
const EDGE = /^[，。、；：・\s]+|[，。、；：・\s]+$/g;
const EDGE_TR = /^[,.;:·、。，；・\s]+|[,.;:·、。，；・\s]+$/g;
function withBare(dict: Record<string, string>): Record<string, string> {
  const out = { ...dict };
  for (const [k, v] of Object.entries(dict)) {
    const b = k.replace(EDGE, "");
    if (b && b !== k && out[b] === undefined) out[b] = v.replace(EDGE_TR, "");
  }
  return out;
}

/** Split at `sep`, but not inside brackets: 「雪梨 → 荷巴特（11:45 → 13:35）」 keeps its times together. */
function splitOutside(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "（" || c === "(") depth++;
    else if ((c === "）" || c === ")") && depth > 0) depth--;
    else if (depth === 0 && s.startsWith(sep, i)) {
      out.push(s.slice(start, i));
      start = i + sep.length;
      i += sep.length - 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/** A translator for one language: Chinese text in, English or Japanese out (unknown text comes back as is). */
export function makeTranslate(lang: Exclude<Lang, "zh">, content?: Record<string, string>): (s: string) => string {
  const dict = withBare({ ...DICTS[lang], ...(content ?? {}) });
    const rules = rulesFor(withBare(DICTS[lang]));
    const memo = new Map<string, string>();

    const SEP: Record<string, string> = lang === "en" ? { "。": ". ", "；": "; ", "，": ", ", "、": ", ", "・": " · ", "：": ": " } : { "。": "。", "；": "；", "，": "、", "、": "、", "・": "・", "：": "：" };
    const translate = (s: string, depth = 0): string => {
      if (!CJK.test(s) || depth > 6) return s;
      const hit = memo.get(s);
      if (hit !== undefined) return hit;
      const done = (v: string) => (memo.set(s, v), v);
      // 1. The whole text as written in the code or the data.
      if (dict[s] !== undefined) return done(dict[s]);
      // 2. A leading bullet or a trailing full stop around known text.
      const bullet = /^([・·]\s*)(.+)$/.exec(s);
      if (bullet) return done((lang === "en" ? "· " : "・") + translate(bullet[2], depth + 1));
      if (s.endsWith("。") && dict[s.slice(0, -1)] !== undefined) return done(dict[s.slice(0, -1)] + (lang === "en" ? "." : "。"));
      // 3. Templates with numbers or names in them ("距離出發還有 {n} 天").
      for (const r of rules) {
        const m = r.re.exec(s);
        // A gap never spans a sentence: 「…「暫定」。 預估總開車約 4 小時…」 is two sentences, not one template.
        if (m && !m.slice(1).some((g) => /[。；]/.test(g ?? ""))) return done(r.out.replace(/\$(\d)/g, (_, i) => translate(m[Number(i)] ?? "", depth + 1)));
      }
      // 4. Sentences and arrows first, so a note in brackets stays with its own sentence.
      const split = (seps: string[]) => {
        for (const sep of seps) {
          if (!s.includes(sep)) continue;
          const parts = splitOutside(s, sep);
          if (parts.length < 2) continue;
          const t = parts.map((p) => (p.trim() ? translate(p.trim(), depth + 1) : p));
          if (!t.some((x, i) => x !== parts[i].trim() && parts[i].trim())) continue;
          // A trailing separator stays: 「雪梨：」 before the next text reads "Sydney: …", 「…確認。」 ends with a full stop.
          const joined = t.join(SEP[sep] ?? sep);
          return /[：，、]/.test(sep) ? joined : joined.replace(/\s+$/, "");
        }
        return null;
      };
      const big = split([" → ", " = ", "。", "；"]);
      if (big !== null) return done(big);
      // 5. A name with a note in brackets: 「Church Street Villas（未預訂）」.
      const paren = /^(.*?)（([^（）]+)）(.*)$/.exec(s);
      if (paren) {
        const [, a, b, c] = paren;
        const out = `${translate(a, depth + 1)}${lang === "en" ? " (" : "（"}${translate(b, depth + 1)}${lang === "en" ? ")" : "）"}${translate(c, depth + 1)}`;
        if (out !== s) return done(out);
      }
      // 6. Lists and labels: 「A，B」「A、B」「A・B」「雪梨：雷雨」.
      return done(split(["，", "、", "・", "："]) ?? s);
    };

  return (s: string) => translate(s);
}
