"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { project, rubber, spring } from "./motion";
import { useReducedMotion } from "./ui";

/*
 * The owner's ⋯ menu (Kai 2026-11-01): a popover grown from the button on wider screens, a bottom sheet with a
 * grabber on phones. Motion is one interruptible, critically damped spring from wherever the surface is now.
 */

export type MenuItem = {
  key: string;
  icon: ReactNode;
  label: string;
  /** Small secondary line inside the row. */
  sub?: string;
  error?: boolean;
  badge?: string;
  danger?: boolean;
  /** Reads as a status rather than an action. */
  quiet?: boolean;
  busy?: boolean;
  /** Stay open while the action runs (its state shows in the row). */
  keepOpen?: boolean;
  onSelect: () => unknown;
};

const SHEET_MAX = 767;
const WIDTH = 288;

export function OwnerMenu({ label, groups, onOpen }: { label: string; groups: MenuItem[][]; onOpen?: () => void }) {
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [sheet, setSheet] = useState(false);
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const pos = useRef(0); // 0 closed, 1 open; the sheet can pass 1 while being rubber-banded
  const cancel = useRef<(() => void) | null>(null);
  const openRef = useRef(false);

  const paint = useCallback(
    (p: number) => {
      pos.current = p;
      const el = surface.current;
      if (!el) return;
      const clamped = Math.min(1, Math.max(0, p));
      if (scrim.current) scrim.current.style.opacity = String(clamped);
      if (reduce) {
        el.style.opacity = String(clamped);
        return;
      }
      if (el.dataset.kind === "sheet") el.style.transform = `translate3d(0, ${(1 - p) * el.offsetHeight}px, 0)`;
      else {
        el.style.opacity = String(clamped);
        el.style.transform = `scale(${0.9 + 0.1 * clamped})`;
      }
    },
    [reduce],
  );

  const animate = useCallback(
    (to: 0 | 1, v0 = 0) => {
      cancel.current?.();
      const done = () => {
        cancel.current = null;
        if (to === 0) setMounted(false);
      };
      if (reduce) {
        // A plain fade.
        const start = pos.current;
        const t0 = performance.now();
        const step = (now: number) => {
          const k = Math.min(1, (now - t0) / 150);
          paint(start + (to - start) * k);
          if (k < 1) raf = requestAnimationFrame(step);
          else done();
        };
        let raf = requestAnimationFrame(step);
        cancel.current = () => cancelAnimationFrame(raf);
        return;
      }
      cancel.current = spring(pos.current, v0, to, surface.current?.dataset.kind === "sheet" ? 0.35 : 0.25, paint, done);
    },
    [paint, reduce],
  );

  const close = useCallback(
    (v0 = 0) => {
      if (!openRef.current) return;
      openRef.current = false;
      animate(0, v0);
      trigger.current?.focus({ preventScroll: true });
    },
    [animate],
  );

  const open = () => {
    if (openRef.current) return close();
    openRef.current = true;
    onOpen?.();
    setSheet(window.matchMedia(`(max-width: ${SHEET_MAX}px)`).matches);
    setMounted(true);
    if (mounted) animate(1); // grabbed again while it was still closing
  };

  // Place the popover at the button, inside the window, then let it grow from there.
  useLayoutEffect(() => {
    if (!mounted) return;
    const el = surface.current;
    const btn = trigger.current;
    if (!el || !btn) return;
    if (!sheet) {
      const r = btn.getBoundingClientRect();
      const left = Math.min(window.innerWidth - WIDTH - 8, Math.max(8, r.right - WIDTH));
      const h = el.offsetHeight;
      const below = r.bottom + 8 + h <= window.innerHeight - 8;
      const top = below ? r.bottom + 8 : Math.max(8, r.top - 8 - h);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.transformOrigin = `${r.left + r.width / 2 - left}px ${below ? 0 : h}px`;
    }
    paint(pos.current);
    if (openRef.current && !cancel.current && pos.current < 1) animate(1);
    el.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    // Runs once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, sheet]);

  useEffect(() => {
    if (!mounted) return;
    const onResize = () => close();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mounted, close]);
  useEffect(() => () => cancel.current?.(), []);

  const onKey = (e: KeyboardEvent) => {
    const items = [...(surface.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[e.key];
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      close();
    } else if (to !== undefined && items.length) {
      e.preventDefault();
      items[(to + items.length) % items.length].focus();
    }
  };

  // Swipe down to close: 10px before it counts as a drag, 1:1 after that, velocity carried into the spring.
  const drag = useRef<{ id: number; y0: number; on: boolean; samples: { y: number; t: number }[] } | null>(null);
  const moved = useRef(false);
  const onDown = (e: PointerEvent) => {
    if (!sheet || reduce) return;
    cancel.current?.();
    cancel.current = null;
    moved.current = false;
    drag.current = { id: e.pointerId, y0: e.clientY, on: false, samples: [] };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    const el = surface.current;
    if (!d || d.id !== e.pointerId || !el) return;
    const dy = e.clientY - d.y0;
    if (!d.on) {
      if (Math.abs(dy) < 10) return;
      d.on = moved.current = true;
      el.setPointerCapture(e.pointerId);
    }
    d.samples.push({ y: e.clientY, t: e.timeStamp });
    if (d.samples.length > 6) d.samples.shift();
    const h = el.offsetHeight;
    paint(dy >= 0 ? 1 - dy / h : 1 - rubber(dy, h) / h);
  };
  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    const el = surface.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId || !el) return;
    if (!d.on) return animate(1);
    const a = d.samples[0];
    const b = d.samples.at(-1)!;
    const v = e.timeStamp - b.t > 100 || !a || b.t === a.t ? 0 : ((b.y - a.y) / (b.t - a.t)) * 1000;
    const h = el.offsetHeight;
    const end = e.clientY - d.y0 + project(v);
    if (end > h * 0.35) close(-v / h);
    else animate(1, -v / h);
  };

  return (
    <>
      <button ref={trigger} type="button" className="owner-menu-btn" aria-label={label} aria-haspopup="menu" aria-expanded={mounted} aria-controls={mounted ? menuId : undefined} onClick={open}>
        <Icon name="more" size={20} />
      </button>
      {mounted &&
        createPortal(
          <>
            <div ref={scrim} className={`menu-scrim${sheet ? " dim" : ""}`} onClick={() => close()} />
            <div
              ref={surface}
              id={menuId}
              role="menu"
              aria-label={label}
              data-kind={sheet ? "sheet" : "popover"}
              className={sheet ? "menu-surface menu-sheet" : "menu-surface menu-popover"}
              onKeyDown={onKey}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            >
              {sheet && <span className="menu-grabber" aria-hidden="true" />}
              {groups
                .filter((g) => g.length)
                .map((g, n) => (
                  <div key={n} className="menu-group" role="group">
                    {g.map((i) => (
                      <button
                        key={i.key}
                        type="button"
                        role="menuitem"
                        tabIndex={-1}
                        aria-busy={i.busy || undefined}
                        className={`menu-row${i.danger ? " danger" : ""}${i.quiet ? " quiet" : ""}`}
                        onClick={() => {
                          if (moved.current || i.busy) return;
                          if (!i.keepOpen) close();
                          void i.onSelect();
                        }}
                      >
                        <span className="menu-ic" aria-hidden="true">
                          {i.busy ? <span className="pbtn-spin" /> : i.icon}
                        </span>
                        <span className="menu-t">
                          <span className="menu-l">{i.label}</span>
                          {i.sub && <span className={`menu-sub${i.error ? " err" : ""}`}>{i.sub}</span>}
                        </span>
                        {i.badge && <span className="menu-badge">{i.badge}</span>}
                      </button>
                    ))}
                  </div>
                ))}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
