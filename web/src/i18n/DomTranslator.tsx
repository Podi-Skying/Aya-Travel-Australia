"use client";

import { useEffect } from "react";
import { EN } from "./en";
import { JA } from "./ja";
import { useLang } from "./index";
import type { Lang } from "./current";

/*
 * Renders the page in English or Japanese (Kai 2026-10-27) by translating what is on screen: text nodes and
 * the aria-label, title, placeholder and alt attributes. The UI text is looked up in en.ts / ja.ts (keyed by
 * the Chinese source); trip content in the translations stored with the trip (`content`). Strings built from
 * templates ("距離出發還有 {n} 天") match as patterns. Only node values change, never the DOM structure, so React
 * keeps working; when React writes a new value, it is translated again. Back to 繁中 restores the originals.
 */

const DICTS: Record<Exclude<Lang, "zh">, Record<string, string>> = { en: EN, ja: JA };
const ATTRS = ["aria-label", "title", "placeholder", "alt"] as const;
const CJK = /[㐀-鿿、-】（-？]/;

type Rule = { re: RegExp; out: string };

function rulesFor(dict: Record<string, string>): Rule[] {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Only patterns with real words around the gaps: "{0}「{1}」{2}" would swallow any text with brackets.
  const words = (k: string) => (k.replace(/\{(\d+|n)\}/g, "").match(/[\u3400-\u9fff]/g) ?? []).length;
  return Object.keys(dict)
    .filter((k) => /\{(\d+|n)\}/.test(k) && words(k) >= 2)
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

export function DomTranslator({ content }: { content: Partial<Record<Exclude<Lang, "zh">, Record<string, string>>> }) {
  const lang = useLang();
  useEffect(() => {
    if (lang === "zh") return;
    const dict = withBare({ ...DICTS[lang], ...(content[lang] ?? {}) });
    const rules = rulesFor(withBare(DICTS[lang]));
    const memo = new Map<string, string>();

    const SEP: Record<string, string> = lang === "en" ? { "。": ". ", "；": "; ", "，": ", ", "、": ", ", "・": " · " } : { "。": "。", "；": "；", "，": "、", "、": "、", "・": "・" };
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
        if (m) return done(r.out.replace(/\$(\d)/g, (_, i) => translate(m[Number(i)] ?? "", depth + 1)));
      }
      // 4. A name with a note in brackets: 「Church Street Villas（未預訂）」.
      const paren = /^(.*?)（([^（）]+)）(.*)$/.exec(s);
      if (paren) {
        const [, a, b, c] = paren;
        const out = `${translate(a, depth + 1)}${lang === "en" ? " (" : "（"}${translate(b, depth + 1)}${lang === "en" ? ")" : "）"}${translate(c, depth + 1)}`;
        if (out !== s) return done(out);
      }
      // 5. Joined pieces: arrows, then sentences and lists.
      for (const sep of [" → ", "。", "；", "，", "、", "・"]) {
        if (!s.includes(sep)) continue;
        const parts = s.split(sep);
        const t = parts.map((p) => (p.trim() ? translate(p.trim(), depth + 1) : p));
        if (t.some((x, i) => x !== parts[i].trim() && parts[i].trim()))
          return done(t.filter((x, i) => x || i < t.length - 1).join(sep === " → " ? " → " : SEP[sep]).replace(/\s+$/, ""));
      }
      return done(s);
    };

    // Original (Chinese) values, and the value we last wrote, per node.
    const orig = new WeakMap<Node, string>();
    const wrote = new WeakMap<Node, string>();
    const origAttr = new WeakMap<Element, Record<string, string>>();
    const touched = new Set<Node>();

    const doText = (n: Text) => {
      const v = n.nodeValue ?? "";
      if (wrote.get(n) === v) return;
      if (!CJK.test(v)) return;
      const lead = v.match(/^\s*/)![0];
      const trail = v.match(/\s*$/)![0];
      const core = v.trim();
      const t = translate(core);
      if (t === core) return;
      orig.set(n, v);
      const nv = lead + t + trail;
      wrote.set(n, nv);
      touched.add(n);
      n.nodeValue = nv;
    };
    const doEl = (el: Element) => {
      if (el.closest("[data-no-translate]")) return;
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (!v || !CJK.test(v)) continue;
        const t = translate(v.trim());
        if (t === v.trim()) continue;
        const rec = origAttr.get(el) ?? {};
        rec[a] = v;
        origAttr.set(el, rec);
        touched.add(el);
        el.setAttribute(a, t);
      }
    };
    const walk = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) {
        const p = root.parentElement;
        if (p && !p.closest("script,style,textarea,[data-no-translate]")) doText(root as Text);
        return;
      }
      if (root.nodeType !== Node.ELEMENT_NODE) return;
      const el = root as Element;
      if (el.matches("script,style,textarea,[data-no-translate]")) return;
      doEl(el);
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && (n as Element).matches("script,style,textarea,[data-no-translate]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        if (n.nodeType === Node.TEXT_NODE) doText(n as Text);
        else doEl(n as Element);
      }
    };

    walk(document.body);
    document.title = translate(document.title);
    const mo = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === "characterData") doText(m.target as Text);
        else if (m.type === "attributes") doEl(m.target as Element);
        else m.addedNodes.forEach(walk);
      }
    });
    mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
    return () => {
      mo.disconnect();
      // Back to the Chinese originals.
      touched.forEach((n) => {
        if (n.nodeType === Node.TEXT_NODE) {
          const o = orig.get(n);
          if (o !== undefined && (n as Text).nodeValue === wrote.get(n)) (n as Text).nodeValue = o;
        } else {
          const rec = origAttr.get(n as Element);
          if (rec) for (const [a, v] of Object.entries(rec)) (n as Element).setAttribute(a, v);
        }
      });
    };
  }, [lang, content]);
  return null;
}
