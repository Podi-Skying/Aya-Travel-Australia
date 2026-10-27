"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
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

/**
 * Language menu (Kai 2026-10-27): one compact button (globe + current language) that opens a small menu
 * anchored to it, each language written in its own script with a check on the current one. Menu-button
 * pattern: arrow keys move, Enter/Space picks, Esc or a click outside closes and focus returns to the button.
 * Language names stay in their own language whatever the page is shown in (data-no-translate).
 */
export function LangSwitch() {
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const wrap = useRef<HTMLSpanElement>(null);
  const cur = LANGS.find((l) => l.key === lang)!;
  const close = (focus = true) => {
    setOpen(false);
    if (focus) btn.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    items.current[LANGS.findIndex((l) => l.key === lang)]?.focus();
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open, lang]);
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = items.current.findIndex((x) => x === document.activeElement);
    const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: LANGS.length - 1 }[e.key];
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") setOpen(false);
    else if (to !== undefined) {
      e.preventDefault();
      items.current[(to + LANGS.length) % LANGS.length]?.focus();
    }
  };
  return (
    <span className="lang-menu" ref={wrap} data-no-translate="">
      <button
        ref={btn}
        type="button"
        className="lang-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Language / 語言 / 言語: ${cur.name}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
          <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M2.5 10h15M10 2.5c2.2 2.1 3.2 4.6 3.2 7.5s-1 5.4-3.2 7.5M10 2.5C7.8 4.6 6.8 7.1 6.8 10s1 5.4 3.2 7.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
        <span lang={cur.html}>{cur.short}</span>
      </button>
      <div className="lang-pop" role="menu" aria-label="Language / 語言 / 言語" data-open={open || undefined} onKeyDown={onMenuKey}>
        {LANGS.map((l, k) => (
          <button
            key={l.key}
            ref={(el) => {
              items.current[k] = el;
            }}
            type="button"
            role="menuitemradio"
            aria-checked={lang === l.key}
            lang={l.html}
            tabIndex={-1}
            onClick={() => {
              setLang(l.key);
              close();
            }}
          >
            <span>{l.name}</span>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="chk">
              <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ))}
      </div>
    </span>
  );
}
