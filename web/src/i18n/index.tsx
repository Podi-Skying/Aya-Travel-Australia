"use client";

import { useEffect, useSyncExternalStore } from "react";
import { setRenderLang, type Lang } from "./current";

export { t, tx, getLang, type Lang } from "./current";

/*
 * Three languages (Kai 2026-10-27): 繁體中文 (the source and default), English and 日本語. UI strings are
 * written in Chinese in the code and looked up in en.ts / ja.ts; a missing entry falls back to Chinese.
 * Trip content carries its own translations in the data (`tr` fields). The choice is kept per viewer.
 */

/** Each language named in itself; `short` is the phone label, `name` the accessible one. */
export const LANGS: { key: Lang; label: string; short: string; name: string; html: string }[] = [
  { key: "zh", label: "繁中", short: "中", name: "繁體中文", html: "zh-Hant" },
  { key: "en", label: "EN", short: "EN", name: "English", html: "en" },
  { key: "ja", label: "日本語", short: "日", name: "日本語", html: "ja" },
];

const KEY = "aya-lang";
const listeners = new Set<() => void>();
let memory: Lang = "zh";

function read(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "en" || v === "ja" || v === "zh") return v;
  } catch {
    /* storage unavailable (private mode): keep the in-memory choice */
  }
  return memory;
}

export function setLang(l: Lang) {
  memory = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* in-memory only */
  }
  listeners.forEach((f) => f());
}

export function useLang(): Lang {
  const lang = useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    read,
    () => "zh" as Lang,
  );
  useEffect(() => {
    document.documentElement.lang = LANGS.find((x) => x.key === lang)!.html;
  }, [lang]);
  return lang;
}

/**
 * The app root calls this: it reads the viewer's choice, makes it the render language for everything below,
 * and returns it so the root can key its tree by it (a switch remounts the page in the new language).
 */
export function useRootLang(): Lang {
  const lang = useLang();
  setRenderLang(lang);
  return lang;
}

export function LangSwitch() {
  const lang = useLang();
  return (
    // Language names stay in their own language whatever the page is shown in (data-no-translate).
    <span className="lang-switch" role="group" aria-label="Language / 語言 / 言語" data-no-translate="">
      {LANGS.map((l) => (
        <button key={l.key} type="button" lang={l.html} aria-label={l.name} aria-pressed={lang === l.key} onClick={() => setLang(l.key)}>
          <span className="l-long" aria-hidden="true">{l.label}</span>
          <span className="l-short" aria-hidden="true">{l.short}</span>
        </button>
      ))}
    </span>
  );
}
