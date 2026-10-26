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
  assertPublicSafe(scrubbed, doc);
  return scrubbed;
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
