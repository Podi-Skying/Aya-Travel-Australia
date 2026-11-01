import type { BookingFlag } from "@/domain/booking";

const TRIANGLE = '<path d="M12 2.6 23 21.4H1z" fill="#f2b100" stroke="#3a2c00" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 9v6.200" stroke="#3a2c00" stroke-width="2.400" stroke-linecap="round"/><circle cx="12" cy="18.200" r="1.400" fill="#3a2c00"/>';

/** The one warning icon: amber, so it never reads as a plan colour or the red route line. */
export function BookWarn({ flag, size = 18, text }: { flag: BookingFlag | string; size?: number; text?: boolean }) {
  const label = typeof flag === "string" ? flag : `${flag.label}：一定要訂`;
  return (
    <span className="book-warn" title={label}>
      <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: TRIANGLE }} />
      {text && typeof flag !== "string" && <span className="book-warn-t">{flag.label}</span>}
    </span>
  );
}

/** The same icon for HTML that Leaflet renders outside React. */
export const bookWarnSvg = (size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${TRIANGLE}</svg>`;
