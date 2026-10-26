"use client";

import type { ReactNode } from "react";
import ClickSpark from "./click-spark/ClickSpark";
import { useReducedMotion } from "./ui";

/*
 * Click sparks everywhere (React Bits ClickSpark, Kai 2026-10-26: line, 8 sparks, size 14, radius 30,
 * 500 ms). Vermilion instead of the requested white, which would vanish on the paper background.
 * The layer never takes pointer events, and it is off under prefers-reduced-motion.
 */
export function Sparks({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <ClickSpark sparkColor="#d2483a" shape="line" sparkCount={8} sparkSize={14} sparkRadius={30} duration={500} disabled={reduce} style={{ height: "auto", minHeight: "100%" }}>
      {children}
    </ClickSpark>
  );
}
