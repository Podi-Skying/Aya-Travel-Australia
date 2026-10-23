/*
 * Line icons drawn with the same stroke rules as the walk illustrations
 * (docs/DESIGN.md: 1.5px, round caps, 20×20 by default). Decorative unless labelled.
 */

const PATHS: Record<string, string> = {
  calendar: "M4 6.5h16v13H4z M4 10h16 M8 4v4 M16 4v4",
  pin: "M12 21s-6-6.2-6-11a6 6 0 0 1 12 0c0 4.8-6 11-6 11z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2",
  walk: "M13 5.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M10 21l2-6 3 3v3 M12 15l1-6-3 2-1 3 M13 9l3 3h3",
  bus: "M5 4h14v12H5z M5 11h14 M8 19v-3 M16 19v-3 M8 14h.01 M16 14h.01",
  car: "M4 16v-4l2-5h12l2 5v4z M4 16v2h3v-2 M17 16v2h3v-2 M7.5 13h.01 M16.5 13h.01",
  ferry: "M4 15h16l-2 4H6z M7 15v-4h10v4 M12 11V6l4 2 M2 21c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1 2-1 4-1",
  train: "M7 3h10a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2z M5 10h14 M9 21l1.5-4 M15 21l-1.5-4 M9 13.5h.01 M15 13.5h.01",
  plane: "M3 13l18-6-3 6 3 6-18-6z M3 13h12",
  wait: "M7 3h10 M7 21h10 M8 3c0 5 8 5 8 9s-8 4-8 9 M16 3c0 5-8 5-8 9",
  map: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14",
  hand: "M8 12V5.5a1.5 1.5 0 0 1 3 0V11 M11 10V4.5a1.5 1.5 0 0 1 3 0V11 M14 10.5V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7h-.5A6.5 6.5 0 0 1 4 14.5V11a1.5 1.5 0 0 1 3 0v2",
  note: "M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z",
  compass: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M15.5 8.5l-2 5-5 2 2-5z",
  home: "M4 11l8-7 8 7 M6 9.5V20h12V9.5 M10 20v-5h4v5",
  warn: "M12 4l9 16H3z M12 10v4 M12 17h.01",
  ok: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M8 12.5l2.5 2.5L16 9.5",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5 M12 8h.01",
  stop: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M6 6l12 12",
  download: "M12 4v11 M7 10l5 5 5-5 M5 20h14",
  upload: "M12 20V9 M7 14l5-5 5 5 M5 4h14",
  print: "M7 9V4h10v5 M5 9h14v7h-3 M8 16H5V9 M8 13h8v7H8z",
  route: "M5 18c3-6 6 2 9-4s3-7 5-9 M5 18h.01 M19 5h.01",
  cube: "M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 12l8-4.5 M12 12v9 M12 12L4 7.5",
  image: "M4 5h16v14H4z M4 16l5-5 4 4 2-2 5 5 M15.5 9.5h.01",
  close: "M6 6l12 12 M18 6L6 18",
  "chevron-left": "M15 5l-7 7 7 7",
  "chevron-right": "M9 5l7 7-7 7",
};

export const MODE_ICON: Record<string, string> = { walk: "walk", bus: "bus", drive: "car", ferry: "ferry", train: "train", flight: "plane", transit: "bus", wait: "wait" };

export function Icon({ name, size = 20, label }: { name: string; size?: number; label?: string }) {
  const d = PATHS[name] ?? PATHS.info;
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      <path d={d} />
    </svg>
  );
}
