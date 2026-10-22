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

function scrub(value: unknown, names: string[]): unknown {
  if (typeof value === "string") return names.reduce((s, n) => s.split(n).join(PUBLIC_DRIVER_LABEL), value);
  if (Array.isArray(value)) return value.map((v) => scrub(v, names));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "driverConfirmation" || k === "address") continue;
      if (k === "needsDriver") {
        if (typeof v === "string" && v) out[k] = PUBLIC_DRIVER_LABEL;
        continue;
      }
      out[k] = scrub(v, names);
    }
    return out;
  }
  return value;
}

export function toPublicDoc(doc: TripDoc) {
  // Keep only the confirmation outcome, computed before the confirmation is removed.
  const okByDate = new Map(doc.days.map((d) => [d.date, effectiveDay(d).driverOk]));
  // Free text written by the owner may mention a driver; mask names everywhere.
  const names = Object.keys(doc.drivers).filter(Boolean).sort((a, b) => b.length - a.length);
  const scrubbed = scrub({ ...doc, drivers: {} }, names) as TripDoc & { drivers: Record<string, never> };
  scrubbed.days = scrubbed.days.map((d) => (okByDate.get(d.date) ? { ...d, publicDriverOk: true } : d));
  assertPublicSafe(scrubbed, doc);
  return scrubbed;
}

export type PublicDoc = ReturnType<typeof toPublicDoc>;

export function assertPublicSafe(out: unknown, source: TripDoc): void {
  const json = JSON.stringify(out);
  if (/"(address|driverConfirmation)"\s*:/.test(json)) throw new PrivacyGuardError("private key present");
  for (const name of Object.keys(source.drivers)) {
    if (name && json.includes(name)) throw new PrivacyGuardError("driver name present");
  }
  for (const st of Object.values(source.stays)) {
    const a = st.address.trim();
    if (a && json.includes(a)) throw new PrivacyGuardError("address present");
  }
}
