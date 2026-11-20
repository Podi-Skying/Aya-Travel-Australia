/* Shared gesture physics (DESIGN.md「動態數值」): momentum projection, rubber-banding, critically damped springs. */

/** Apple's scroll-deceleration projection (Designing Fluid Interfaces). */
export const project = (v: number, rate = 0.998) => ((v / 1000) * rate) / (1 - rate);

/**
 * Which page a horizontal swipe ends on: the release offset plus the projected travel of its velocity,
 * one page at most, never past the first or last.
 */
export function swipeStep(offset: number, velocity: number, width: number, index: number, count: number): -1 | 0 | 1 {
  const projected = offset + project(velocity);
  const step = projected < -width / 2 ? 1 : projected > width / 2 ? -1 : 0;
  return index + step < 0 || index + step >= count ? 0 : step;
}
export function rubber(over: number, dim: number, c = 0.55) {
  return (over * dim * c) / (dim + c * Math.abs(over));
}

/** Critically damped spring from `from` (with velocity, units/s) to `to`; returns a cancel function. */
export function spring(from: number, v0: number, to: number, response: number, onFrame: (x: number) => void, onDone?: () => void) {
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
