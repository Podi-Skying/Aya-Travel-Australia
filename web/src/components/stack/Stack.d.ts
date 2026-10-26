// Types for the vendored React Bits Stack (JS-CSS variant).
import type { CSSProperties, ReactElement, ReactNode } from "react";

export type StackProps = {
  cards?: ReactNode[];
  layout?: "fan" | "cascade" | "deck" | "pile";
  visible?: number;
  spread?: number;
  depth?: number;
  radius?: number;
  frame?: number;
  frameColor?: string;
  shadow?: boolean;
  tilt?: number;
  threshold?: number;
  speed?: number;
  sendToBackOnClick?: boolean;
  autoplay?: boolean;
  autoplayDelay?: number;
  pauseOnHover?: boolean;
  onChange?: (topIndex: number) => void;
  className?: string;
  style?: CSSProperties;
};

export default function Stack(props: StackProps): ReactElement;
