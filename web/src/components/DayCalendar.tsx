"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useTrip } from "./TripApp";
import { useHobartToday, useReducedMotion } from "./ui";
import { monthGrid, moveInGrid, weekIndexOf } from "@/domain/calendar";
import { effectiveDay } from "@/domain/effective-day";
import { checks } from "@/domain/rules";
import { fmtDay, parseDate } from "@/domain/format";

/*
 * Month calendar day picker (DESIGN.md「月曆」). Desktop: the whole month. Phone: one week that
 * pulls down into the month and swipes sideways between weeks. Gestures track 1:1, project momentum
 * on release and settle with a critically damped spring that can be grabbed again mid-flight.
 */

const WEEK_HEAD = ["一", "二", "三", "四", "五", "六", "日"];
const THRESHOLD = 10;

/** Apple's scroll-deceleration projection (Designing Fluid Interfaces). */
const project = (v: number, rate = 0.998) => ((v / 1000) * rate) / (1 - rate);
function rubber(over: number, dim: number, c = 0.55) {
  return (over * dim * c) / (dim + c * Math.abs(over));
}

/** Critically damped spring from `from` (with velocity, units/s) to `to`; returns a cancel function. */
function spring(from: number, v0: number, to: number, response: number, onFrame: (x: number) => void, onDone?: () => void) {
  // Closed-form solution x(t) = to + (A + B·t)·e^(−ωt): exact at any frame rate, so dropped frames never destabilise it.
  const w = (2 * Math.PI) / response;
  const A = from - to;
  const B = v0 + w * A;
  const start = performance.now();
  const eps = 0.0005 * Math.max(1, Math.abs(from), Math.abs(to));
  let raf = requestAnimationFrame(function step(now) {
    const t = (now - start) / 1000;
    const e = Math.exp(-w * t);
    const x = to + (A + B * t) * e;
    const v = (B - w * (A + B * t)) * e;
    if (Math.abs(x - to) < eps && Math.abs(v) < eps * w) {
      onFrame(to);
      onDone?.();
      return;
    }
    onFrame(x);
    raf = requestAnimationFrame(step);
  });
  return () => cancelAnimationFrame(raf);
}

function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = matchMedia("(max-width: 720px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

export function DayCalendar() {
  const { doc, currentDay, setCurrentDay } = useTrip();
  const today = useHobartToday();
  const reduce = useReducedMotion();
  const narrow = useNarrow();
  const grid = useMemo(() => monthGrid(doc.days.map((d) => d.date)), [doc.days]);
  const warn = useMemo(() => doc.days.map((x) => checks(doc, effectiveDay(x), { showWindow: false }).some((c) => c.lv === "warn")), [doc]);
  const [focusIdx, setFocusIdx] = useState(currentDay);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const selWeek = weekIndexOf(grid, currentDay);
  const [viewWeek, setViewWeek] = useState(selWeek);
  const [expanded, setExpanded] = useState(false);

  // Follow outside selection changes (URL, 前一天/後一天) without an extra effect pass.
  const [prevDay, setPrevDay] = useState(currentDay);
  if (prevDay !== currentDay) {
    setPrevDay(currentDay);
    setFocusIdx(currentDay);
    setViewWeek(selWeek);
  }

  /* ---- phone: progress p (0 = one week, 1 = month) and horizontal offset x, written straight to the DOM ---- */
  const viewport = useRef<HTMLDivElement>(null);
  const weeks = useRef<HTMLDivElement>(null);
  const p = useRef(0);
  const x = useRef(0);
  const anim = useRef<(() => void) | null>(null);
  const drag = useRef<{ id: number; x0: number; y0: number; p0: number; axis: "x" | "y" | null; hist: { t: number; x: number; y: number }[] } | null>(null);
  const moved = useRef(false);
  const viewWeekRef = useRef(viewWeek);
  useEffect(() => {
    viewWeekRef.current = viewWeek;
  }, [viewWeek]);

  const rowH = () => weeks.current?.querySelector<HTMLElement>('[role="row"]')?.offsetHeight ?? 48;
  const apply = useCallback(() => {
    if (!viewport.current || !weeks.current) return;
    if (!narrow) {
      viewport.current.style.height = "";
      weeks.current.style.transform = "";
      return;
    }
    const R = rowH();
    const span = (grid.length - 1) * R;
    viewport.current.style.height = `${R + Math.max(-0.2, p.current) * span}px`;
    const y = -(1 - Math.min(1, Math.max(0, p.current))) * viewWeekRef.current * R;
    weeks.current.style.transform = `translate3d(${x.current}px, ${y}px, 0)`;
  }, [narrow, grid.length]);

  useEffect(apply, [apply, viewWeek, expanded]);

  const animateP = useCallback(
    (to: number, v0 = 0) => {
      anim.current?.();
      setExpanded(to === 1);
      if (reduce) {
        p.current = to;
        apply();
        return;
      }
      anim.current = spring(p.current, v0, to, 0.35, (v) => {
        p.current = v;
        apply();
      });
    },
    [apply, reduce],
  );

  function onPointerDown(e: ReactPointerEvent) {
    if (!narrow || e.button !== 0) return;
    anim.current?.(); // grab mid-flight: continue from the on-screen value
    anim.current = null;
    drag.current = { id: e.pointerId, x0: e.clientX - x.current, y0: e.clientY, p0: p.current, axis: null, hist: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }] };
    moved.current = false;
  }
  function onPointerMove(e: ReactPointerEvent) {
    const g = drag.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.axis) {
      if (Math.hypot(dx - x.current, dy) < THRESHOLD) return;
      g.axis = Math.abs(dy) > Math.abs(dx - x.current) || p.current > 0.5 ? "y" : "x";
      moved.current = true;
      viewport.current?.setPointerCapture(e.pointerId);
    }
    g.hist.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    if (g.hist.length > 6) g.hist.shift();
    const R = rowH();
    const span = (grid.length - 1) * R;
    if (g.axis === "y") {
      const raw = g.p0 + dy / span;
      p.current = raw < 0 ? rubber(raw * span, span) / span : raw > 1 ? 1 + rubber((raw - 1) * span, span) / span : raw;
    } else {
      const w = viewport.current?.offsetWidth ?? 320;
      const atStart = viewWeekRef.current === 0 && dx > 0;
      const atEnd = viewWeekRef.current === grid.length - 1 && dx < 0;
      x.current = atStart || atEnd ? rubber(dx, w) : dx;
    }
    apply();
  }
  function velocity(g: NonNullable<typeof drag.current>) {
    const a = g.hist[0];
    const b = g.hist[g.hist.length - 1];
    const dt = Math.max(1, b.t - a.t) / 1000;
    return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
  }
  function onPointerUp(e: ReactPointerEvent) {
    const g = drag.current;
    drag.current = null;
    if (!g || g.id !== e.pointerId || !g.axis) return;
    const { vx, vy } = velocity(g);
    const R = rowH();
    const span = (grid.length - 1) * R;
    if (g.axis === "y") {
      const projected = p.current + project(vy) / span;
      animateP(projected >= 0.5 ? 1 : 0, vy / span);
      return;
    }
    const w = viewport.current?.offsetWidth ?? 320;
    const projected = x.current + project(vx);
    const dir = projected < -w * 0.3 && viewWeekRef.current < grid.length - 1 ? 1 : projected > w * 0.3 && viewWeekRef.current > 0 ? -1 : 0;
    const settle = (from: number, v0: number) => {
      if (reduce) {
        x.current = 0;
        apply();
        anim.current = null;
        return;
      }
      anim.current = spring(from, v0, 0, 0.3, (v) => {
        x.current = v;
        apply();
      });
    };
    if (!dir) return settle(x.current, vx);
    // Slide the week out in the swipe direction, swap, then bring the next week in from the other side.
    const swap = () => {
      viewWeekRef.current += dir;
      setViewWeek(viewWeekRef.current);
      x.current = dir * w;
      apply();
      settle(x.current, vx);
    };
    if (reduce) return swap();
    anim.current = spring(x.current, vx, -dir * w, 0.22, (v) => {
      x.current = v;
      apply();
    }, swap);
  }

  /* ---- keyboard: ARIA grid with roving tabindex; arrows move focus, Enter/Space selects ---- */
  const gridRef = useRef<HTMLDivElement>(null);
  function onKeyDown(e: ReactKeyboardEvent) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const n = moveInGrid(grid, focusIdx, e.key);
    setFocusIdx(n);
    const wk = weekIndexOf(grid, n);
    if (narrow && p.current < 0.5 && wk !== viewWeekRef.current) {
      viewWeekRef.current = wk;
      setViewWeek(wk);
    }
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-day="${n}"]`)?.focus());
  }

  const shown = hoverIdx ?? currentDay;
  const sd = doc.days[shown];
  const segs = Object.entries(doc.segments).filter(([k]) => doc.days.some((d) => d.seg === k));
  const first = parseDate(doc.days[0].date);
  const last = parseDate(doc.days[doc.days.length - 1].date);
  const monthLabel =
    first.getMonth() === last.getMonth() ? `${first.getFullYear()} 年 ${first.getMonth() + 1} 月` : `${first.getMonth() + 1} 月 – ${last.getMonth() + 1} 月`;

  return (
    <div className={`day-cal${expanded ? " is-open" : ""}`}>
      <div className="cal-head">
        <span className="cal-month">{monthLabel}</span>
        <span className="cal-legend" aria-hidden="true">
          {segs.map(([k, s]) => (
            <span key={k} className={`lg seg-${k}`}>
              <i />
              {s.name}
            </span>
          ))}
          <span className="lg warn">
            <i />
            提醒
          </span>
        </span>
      </div>
      <div className="cal-week-head" aria-hidden="true">
        {WEEK_HEAD.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div
        className="cal-viewport"
        ref={viewport}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={(e) => {
          if (moved.current) {
            e.preventDefault();
            e.stopPropagation();
            moved.current = false;
          }
        }}
      >
        <div className="cal-weeks" ref={(el) => { weeks.current = el; gridRef.current = el; }} role="grid" aria-label={`${monthLabel}，選擇日期`} onKeyDown={onKeyDown}>
          {grid.map((week, wi) => (
            <div role="row" key={wi} className="cal-row" aria-hidden={narrow && !expanded && wi !== viewWeek ? true : undefined}>
              {week.map((c) => {
                if (!c.inTrip)
                  return (
                    <span key={c.date} role="gridcell" aria-disabled="true" className="cal-cell out">
                      <span className="n">{c.day}</span>
                    </span>
                  );
                const x2 = doc.days[c.dayIdx];
                const sel = c.dayIdx === currentDay;
                const isToday = c.date === today;
                return (
                  <button
                    key={c.date}
                    type="button"
                    role="gridcell"
                    data-day={c.dayIdx}
                    className={`cal-cell seg-${x2.seg}${sel ? " sel" : ""}${isToday ? " today" : ""}`}
                    tabIndex={c.dayIdx === focusIdx ? 0 : -1}
                    aria-selected={sel}
                    aria-current={isToday ? "date" : undefined}
                    aria-label={`${fmtDay(c.date)} ${x2.title}${isToday ? "，今天" : ""}${warn[c.dayIdx] ? "，有提醒" : ""}`}
                    onClick={() => setCurrentDay(c.dayIdx)}
                    onPointerEnter={(e) => e.pointerType === "mouse" && setHoverIdx(c.dayIdx)}
                    onPointerLeave={() => setHoverIdx(null)}
                    onFocus={() => setFocusIdx(c.dayIdx)}
                  >
                    <span className="n">{c.day}</span>
                    {warn[c.dayIdx] && <span className="dot" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {narrow && (
        <button type="button" className="cal-toggle" aria-expanded={expanded} onClick={() => animateP(expanded ? 0 : 1)}>
          <span className="grip" aria-hidden="true" />
          {expanded ? "收合成一週" : "展開整個月"}
        </button>
      )}
      <p className="cal-caption" aria-live="polite">
        <span className="d">{fmtDay(sd.date)}</span> {sd.title}
      </p>
    </div>
  );
}
