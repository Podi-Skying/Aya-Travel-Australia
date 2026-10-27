import type { Item, TripDoc } from "./schema";
import { homeStayKey } from "./stay";
import { stayPin, type StayPin } from "./home-pins";

/*
 * Where the 旅遊規劃小測驗 day starts (Kai 2026-10-27: guests can use the quiz too).
 * - Owner: the home base, as stored.
 * - Share link: the home base from the share document (its position already rounded to ~300 m).
 * - Public site (no sign-in, no share link): never the home base. A generic start in Hobart city centre
 *   (Franklin Square), so no name, address or position of where Kai stays is shown or implied.
 */

export const HOBART_CENTRE: StayPin = { key: "hobart-centre", name: "荷巴特市中心", lat: -42.8826, lng: 147.3286, home: false };

export function quizStart(doc: Pick<TripDoc, "stays">, who: "owner" | "share" | "public"): { pin: StayPin | null; name: string } {
  if (who === "public") return { pin: HOBART_CENTRE, name: HOBART_CENTRE.name };
  const key = homeStayKey(doc);
  const pin = key ? stayPin(doc, key) : null;
  const name = who === "owner" && key && doc.stays[key]?.name ? doc.stays[key].name : "住處";
  return { pin, name };
}

/** Photos a guest quiz may show: Wikimedia Commons only (no own, booking-site or operator photos). */
export function guestPhotoUrl(i: Pick<Item, "photo" | "gallery">): string | null {
  if (i.photo?.kind === "commons") return i.photo.url;
  return i.gallery?.find((p) => p.kind === "commons")?.url ?? null;
}
