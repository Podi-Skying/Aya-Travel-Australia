// Types for the vendored React Bits FlexCarousel (JS-CSS variant); props as documented at reactbits.dev.
import type { CSSProperties, ReactElement } from "react";

export type FlexCarouselItem = { src: string; alt?: string; title?: string; subtitle?: string };

export type FlexCarouselProps = {
  items?: FlexCarouselItem[];
  preset?: string;
  intro?: string;
  cardHeight?: number;
  gap?: number;
  radius?: number;
  fit?: string;
  squeeze?: number;
  focusOnClick?: boolean;
  autoplay?: boolean;
  interval?: number;
  captions?: boolean;
  captureWheel?: boolean;
  onChange?: (index: number) => void;
  onSelect?: (index: number) => void;
  className?: string;
  style?: CSSProperties;
};

declare const FlexCarousel: (props: FlexCarouselProps) => ReactElement;
export default FlexCarousel;
