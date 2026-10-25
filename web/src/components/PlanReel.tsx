"use client";

import { useRef, useState, type KeyboardEvent } from "react";

/*
 * Photo reel for 推薦行程方案 (docs/PLAN-2026-10-26-plan-reel.md): a row of photo slices; the selected
 * slice swells open into the full image and a hovered one swells a little. On phones it becomes a
 * vertical stack. Kept self-contained behind this props API so a different reel component can
 * replace it without touching the page.
 */

export type ReelSlice = {
  key: string;
  title: string;
  /** Short line under the title on the open slice, e.g. 「3天2夜・東海岸・11/9–11/11」. */
  caption: string;
  /** Status shown on the slice whether open or not, e.g. 「目前採用」. */
  badge?: string;
  image?: string;
  /** Fill colour behind white text when there is no photo (AA with white). */
  deep: string;
};

export function PlanReel({
  slices,
  active,
  onSelect,
  label,
  panelId,
  orientation = "horizontal",
}: {
  slices: ReelSlice[];
  active: string;
  onSelect: (key: string) => void;
  label: string;
  panelId: string;
  /** Phones show a vertical stack; screen readers are told which (arrow keys work both ways). */
  orientation?: "horizontal" | "vertical";
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  // Hotlinked photos can be blocked or removed; those slices fall back to colour and line art.
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const keys = slices.map((s) => s.key);
  const onKey = (e: KeyboardEvent, key: string) => {
    const i = keys.indexOf(key);
    const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: keys.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const k = keys[(to + keys.length) % keys.length];
    onSelect(k);
    refs.current.get(k)?.focus();
  };
  return (
    <div className="plan-reel" role="tablist" aria-label={label} aria-orientation={orientation}>
      {slices.map((s) => {
        const on = s.key === active;
        return (
          <button
            key={s.key}
            ref={(el) => {
              if (el) refs.current.set(s.key, el);
              else refs.current.delete(s.key);
            }}
            type="button"
            role="tab"
            id={`reel-${s.key}`}
            aria-selected={on}
            aria-controls={panelId}
            tabIndex={on ? 0 : -1}
            className={`reel-slice${on ? " on" : ""}`}
            style={{ ["--deep" as string]: s.deep }}
            onClick={() => onSelect(s.key)}
            onKeyDown={(e) => onKey(e, s.key)}
          >
            {s.image && !failed.has(s.image) ? (
              // eslint-disable-next-line @next/next/no-img-element -- hotlinked place photo with credit below
              <img src={s.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed((f) => new Set(f).add(s.image!))} />
            ) : (
              <svg viewBox="0 0 320 160" aria-hidden="true" className="reel-art" preserveAspectRatio="xMidYMid slice">
                <path d="M0 118 C40 96 62 70 96 84 S150 40 188 62 S250 98 320 72" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                <path d="M0 136 C30 130 60 140 90 134 S150 128 180 136 S260 142 320 132" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".6" />
              </svg>
            )}
            {s.badge && !on && <span className="reel-flag" aria-hidden="true" />}
            <span className="reel-spine" aria-hidden={on}>
              {s.title}
              {s.badge && !on ? `（${s.badge}）` : ""}
            </span>
            <span className="reel-caption" aria-hidden={!on}>
              {s.badge && <span className="reel-badge">{s.badge}</span>}
              <strong>{s.title}</strong>
              <span>{s.caption}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
