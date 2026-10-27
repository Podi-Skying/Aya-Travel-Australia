"use client";

import { useEffect } from "react";
import { useLang } from "./index";
import type { Lang } from "./current";
import { CJK, makeTranslate } from "./translate";

/*
 * Renders the page in English or Japanese (Kai 2026-10-27) by translating what is on screen: text nodes and
 * the aria-label, title, placeholder and alt attributes. The UI text is looked up in en.ts / ja.ts (keyed by
 * the Chinese source); trip content in the translations stored with the trip (`content`). Strings built from
 * templates ("距離出發還有 {n} 天") match as patterns. Only node values change, never the DOM structure, so React
 * keeps working; when React writes a new value, it is translated again. Back to 繁中 restores the originals.
 */

const ATTRS = ["aria-label", "title", "placeholder", "alt"] as const;

export function DomTranslator({ content }: { content: Partial<Record<Exclude<Lang, "zh">, Record<string, string>>> }) {
  const lang = useLang();
  useEffect(() => {
    if (lang === "zh") return;
    const translate = makeTranslate(lang, content[lang]);

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
    const title = document.title;
    document.title = translate(title);
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
      if (document.title === translate(title)) document.title = title;
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
