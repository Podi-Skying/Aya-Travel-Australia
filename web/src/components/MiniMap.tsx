/*
 * Small location map for quiz cards (Kai 2026-10-26): a plain SVG of Tasmania, or of Greater Hobart for
 * places around the city, with the place in vermilion and home as a small house dot. No tiles, no API calls.
 */

type Pt = [number, number]; // [lat, lng]

const COS = 0.74; // cos(42°): keeps east–west distances in proportion

// Tasmania main island and Bruny Island, simplified coastline as [lng, lat].
const TAS: Pt[] = [
  [144.65, -40.7], [145.25, -40.78], [145.9, -41.04], [146.35, -41.15], [146.8, -41.06], [147.4, -40.97],
  [147.95, -40.75], [148.32, -40.98], [148.3, -41.4], [148.3, -41.87], [148.32, -42.25], [148.0, -42.32],
  [147.93, -42.6], [147.97, -42.95], [147.99, -43.22], [147.75, -43.17], [147.45, -43.06], [147.28, -43.2],
  [147.08, -43.45], [146.83, -43.64], [146.3, -43.55], [145.9, -43.3], [145.5, -42.8], [145.25, -42.2],
  [144.95, -41.6], [144.67, -41.05],
];
const BRUNY: Pt[] = [[147.3, -43.03], [147.42, -43.18], [147.36, -43.45], [147.24, -43.5], [147.2, -43.3]];
// Derwent estuary through Greater Hobart, as [lng, lat].
const DERWENT: Pt[] = [[147.14, -42.76], [147.22, -42.75], [147.26, -42.8], [147.3, -42.84], [147.34, -42.88], [147.36, -42.92], [147.37, -42.97], [147.4, -43.02]];

type View = { lng0: number; lat0: number; s: number; w: number; h: number };
const TAS_VIEW: View = { lng0: 144.5, lat0: -40.55, s: 100 / 3.2, w: 93, h: 100 };
const HOBART_VIEW: View = { lng0: 147.12, lat0: -42.74, s: 100 / 0.28, w: 100, h: 100 };

/** Greater Hobart box used for the zoomed map. */
export const inHobart = ([lat, lng]: Pt) => lat <= -42.74 && lat >= -43.02 && lng >= 147.12 && lng <= 147.5;

const xy = (v: View, lng: number, lat: number) => [((lng - v.lng0) * COS * v.s).toFixed(1), ((v.lat0 - lat) * v.s).toFixed(1)].join(",");

export function MiniMap({ places, home, zoom }: { places: Pt[]; home: Pt | null; zoom: "tas" | "hobart" }) {
  const v = zoom === "hobart" ? HOBART_VIEW : TAS_VIEW;
  const path = (pts: Pt[]) => "M" + pts.map(([lng, lat]) => xy(v, lng, lat)).join("L") + "Z";
  const dot = ([lat, lng]: Pt) => xy(v, lng, lat).split(",").map(Number) as [number, number];
  const r = 6;
  return (
    <svg className="mini-map" viewBox={`0 0 ${v.w} ${v.h}`} aria-hidden="true" focusable="false">
      {zoom === "tas" ? (
        <>
          <path d={path(TAS)} className="mm-land" />
          <path d={path(BRUNY)} className="mm-land" />
        </>
      ) : (
        <polyline points={DERWENT.map(([lng, lat]) => xy(v, lng, lat)).join(" ")} className="mm-water" />
      )}
      {home && (() => {
        const [x, y] = dot(home);
        return <path d={`M${x - 6} ${y}l6-6 6 6v6h-12z`} className="mm-home" />;
      })()}
      {places.map((p, k) => {
        const [x, y] = dot(p);
        return <circle key={k} cx={x} cy={y} r={r} className="mm-dot" />;
      })}
    </svg>
  );
}
