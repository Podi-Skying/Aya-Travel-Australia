import type { TripDoc } from "./schema";
import { effectiveDay } from "./effective-day";

/*
 * toPublicDoc builds the only document visitors ever receive (FR-28, PLAN.md 4.4).
 * It walks the whole document so that driver names and confirmations are removed
 * wherever they appear, then checks the serialized result and fails closed.
 */

export const PUBLIC_DRIVER_LABEL = "朋友";

export class PrivacyGuardError extends Error {
  constructor(reason: string) {
    super(`privacy guard: ${reason}`);
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
const norm = (s: string) => s.normalize("NFKC").toLowerCase();

/** Matches a name case-insensitively, including full-width letters, without rewriting other text. */
function nameRegex(name: string): RegExp {
  const cls = [...name]
    .map((ch) => {
      const forms = new Set([ch, ch.toLowerCase(), ch.toUpperCase()]);
      for (const f of [...forms]) {
        const c = f.charCodeAt(0);
        if (c >= 0x21 && c <= 0x7e) forms.add(String.fromCharCode(c + 0xfee0));
      }
      return `[${[...forms].map(escapeRe).join("")}]`;
    })
    .join("");
  return new RegExp(cls, "g");
}

function scrub(value: unknown, names: string[], photos: boolean): unknown {
  if (typeof value === "string") return names.reduce((acc, n) => acc.replace(nameRegex(n), PUBLIC_DRIVER_LABEL), value);
  if (Array.isArray(value)) return value.map((v) => scrub(v, names, photos));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "driverConfirmation" || k === "address" || k === "ownerNote") continue;
      if ((k === "photo" || k === "photoUrl" || k === "gallery") && !photos) continue;
      if (k === "needsDriver") {
        if (typeof v === "string" && v) out[k] = PUBLIC_DRIVER_LABEL;
        continue;
      }
      out[k] = scrub(v, names, photos);
    }
    return out;
  }
  return value;
}

/**
 * Photos are hotlinked from other sites for this private trip, so only share-link viewers
 * (and the owner) get them; the anonymous public pages never do.
 */
export function toPublicDoc(doc: TripDoc, opts: { photos?: boolean } = {}) {
  // Keep only the confirmation outcome, computed before the confirmation is removed.
  const okByDate = new Map(doc.days.map((d) => [d.date, effectiveDay(d).driverOk]));
  // Free text written by the owner may mention a driver; mask names everywhere.
  const names = [...Object.keys(doc.drivers), ...Object.values(doc.peopleNames ?? {})].filter(Boolean).sort((a, b) => b.length - a.length);
  const scrubbed = scrub({ ...doc, drivers: {}, peopleNames: {} }, names, !!opts.photos) as TripDoc & { drivers: Record<string, never> };
  scrubbed.days = scrubbed.days.map((d) => (okByDate.get(d.date) ? { ...d, publicDriverOk: true } : d));
  // Where they sleep is effectively Kai's residence: share links get the position rounded to ~300 m;
  // public visitors get no position, and the home base is shown only as 「住處」.
  const fuzz = (n: number) => Math.round(n / 0.003) * 0.003;
  for (const st of Object.values(scrubbed.stays) as { name: string; area: string; home?: boolean; lat?: number; lng?: number }[]) {
    if (opts.photos && st.lat != null && st.lng != null) {
      st.lat = Math.round(fuzz(st.lat) * 1e4) / 1e4;
      st.lng = Math.round(fuzz(st.lng) * 1e4) / 1e4;
    } else {
      delete st.lat;
      delete st.lng;
      if (st.home) {
        st.name = "住處";
        st.area = "荷巴特";
      }
    }
  }
  // Public visitors also do not see the home base's name in activity text (e.g. 「前往 UTAS 公寓入住」).
  const homeName = (Object.values(doc.stays) as { name: string; home?: boolean }[]).find((x) => x.home)?.name;
  // An activity about the home base (going there, checking in) would give its position away: same rule as the stay.
  if (homeName) {
    const words = [homeName, "UTAS"];
    const aboutHome = (i: { name: string; en?: string }) => words.some((w) => i.name.includes(w) || (i.en ?? "").includes(w));
    const homeIds = new Set([...doc.days.flatMap((d) => d.items), ...doc.attractionPool.flatMap((p) => p.items)].filter(aboutHome).map((i) => i.id));
    const byOriginal = <T extends { id: string; lat?: number; lng?: number }>(i: T): T => {
      if (!homeIds.has(i.id) || i.lat == null || i.lng == null) return i;
      const out = { ...i };
      if (opts.photos) {
        out.lat = Math.round(fuzz(i.lat) * 1e4) / 1e4;
        out.lng = Math.round(fuzz(i.lng) * 1e4) / 1e4;
      } else {
        delete out.lat;
        delete out.lng;
      }
      return out;
    };
    scrubbed.days = scrubbed.days.map((d) => ({ ...d, items: d.items.map(byOriginal) }));
    scrubbed.attractionPool = scrubbed.attractionPool.map((p) => ({ ...p, items: p.items.map(byOriginal) }));
  }
  let out = localiseFriend(!opts.photos && homeName ? renameHome(scrubbed, homeName) : scrubbed) as typeof scrubbed;
  // …nor its internal key (e.g. "utas"), which would name it too.
  const homeKey = Object.entries(doc.stays).find(([, x]) => (x as { home?: boolean }).home)?.[0];
  if (!opts.photos && homeKey && homeKey !== "home") {
    const { [homeKey]: homeStay, ...rest } = out.stays;
    const re = (k: string) => (k === homeKey ? "home" : k);
    out = {
      ...out,
      stays: { ...rest, home: homeStay },
      days: out.days.map((d) => ({ ...d, stay: re(d.stay) })),
      tripOptions: (out.tripOptions ?? []).map((o) => ({ ...o, days: o.days.map((od) => ({ ...od, stay: re(od.stay) })) })),
    };
  }
  // Translations of other text only for text that is still shown here: a pair whose source was removed
  // (an address, a driver's hours, an owner note) is dropped with it.
  if (out.textTr?.length) {
    const shown = new Set<string>();
    const collect = (v: unknown): void => {
      if (typeof v === "string") shown.add(v.trim());
      else if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "textTr" && k !== "tr") collect(x);
    };
    collect(out);
    out = { ...out, textTr: out.textTr.filter((p) => shown.has(p.zh.trim())) };
  }
  assertPublicSafe(out, doc);
  return out;
}

/** The redaction words in each language's translations (Kai 2026-10-27): same rule, natural wording. */
const HOME_WORD: Record<string, string> = { zh: "住處", en: "our place", ja: "宿泊先" };
const FRIEND_WORD: Record<string, string> = { en: "a friend", ja: "友人" };

/** Replaces the home base's name (and its short 「UTAS」 forms) with 「住處」 in every string (in translations, its own word). */
function renameHome(value: unknown, name: string): unknown {
  const words = [name, "UTAS 公寓", "UTAS Hobart Apartments", "UTAS Hobart", "UTAS"].sort((a, b) => b.length - a.length);
  const walk = (v: unknown, lang: string): unknown =>
    typeof v === "string"
      ? words.reduce((acc, w) => acc.split(w).join(HOME_WORD[lang]), v)
      : Array.isArray(v)
        ? v.map((x) => walk(x, lang))
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k === "en" || k === "ja" ? k : lang)]))
          : v;
  return walk(value, "zh");
}

/** Driver names were masked as 「朋友」 everywhere; inside translations that becomes the language's own word. */
function localiseFriend(value: unknown, lang = "zh"): unknown {
  if (typeof value === "string") return lang === "zh" ? value : value.split(PUBLIC_DRIVER_LABEL).join(FRIEND_WORD[lang]);
  if (Array.isArray(value)) return value.map((x) => localiseFriend(x, lang));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, x]) => [k, localiseFriend(x, k === "en" || k === "ja" ? k : lang)]));
  return value;
}

export type PublicDoc = ReturnType<typeof toPublicDoc>;

export function assertPublicSafe(out: unknown, source: TripDoc): void {
  const json = JSON.stringify(out);
  if (/"(address|driverConfirmation|ownerNote)"\s*:/.test(json)) throw new PrivacyGuardError("private key present");
  const text = norm(json);
  for (const name of Object.keys(source.drivers)) {
    if (name && text.includes(norm(name))) throw new PrivacyGuardError("driver name present");
  }
  for (const name of Object.values(source.peopleNames ?? {})) {
    if (name && text.includes(norm(name))) throw new PrivacyGuardError("person name present");
  }
  for (const st of Object.values(source.stays)) {
    const a = norm(st.address.trim());
    if (a && text.includes(a)) throw new PrivacyGuardError("address present");
  }
}
