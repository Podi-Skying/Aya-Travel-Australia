// Types for the vendored React Bits ChromaGrid (JS-CSS variant) with the local selection extension.
import type { ReactElement } from "react";

export type ChromaItem = { image: string; title?: string; subtitle?: string; accent?: string; url?: string; alt?: string };

export type ChromaGridProps = {
  items?: ChromaItem[];
  columns?: number;
  minCardWidth?: number;
  gap?: number;
  radius?: number;
  softness?: number;
  damping?: number;
  fadeOut?: number;
  grayscale?: number;
  dim?: number;
  glow?: number;
  borderGlow?: number;
  reveal?: "spotlight" | "card";
  aspectRatio?: string;
  cardRadius?: number;
  showInfo?: boolean;
  frame?: boolean;
  theme?: "dark" | "light";
  className?: string;
  selected?: boolean[];
  onToggle?: (index: number) => void;
  selectedLabel?: string;
};

declare const ChromaGrid: (props: ChromaGridProps) => ReactElement;
export default ChromaGrid;
export { ChromaGrid };
