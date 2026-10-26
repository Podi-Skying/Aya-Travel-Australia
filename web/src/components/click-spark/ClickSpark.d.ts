// Types for the vendored React Bits ClickSpark (JS-CSS variant).
import type { CSSProperties, ForwardRefExoticComponent, ReactNode, RefAttributes } from "react";

export type ClickSparkProps = {
  sparkColor?: string | string[];
  sparkSize?: number;
  sparkRadius?: number;
  sparkCount?: number;
  sparkWidth?: number;
  duration?: number;
  easing?: string;
  extraScale?: number;
  shape?: string;
  randomness?: number;
  gravity?: number;
  spread?: number;
  direction?: number;
  glow?: number;
  ring?: boolean;
  layer?: "front" | "back";
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

declare const ClickSpark: ForwardRefExoticComponent<ClickSparkProps & RefAttributes<{ spark: (x?: number, y?: number) => void }>>;
export default ClickSpark;
