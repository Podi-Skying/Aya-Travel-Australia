import { checkOwner } from "./owner";
import { missingConfig } from "./config";
import { getCurrentTrip, type CurrentTrip } from "./trips";
import { getPublicHomeTrip } from "./public-home";
import type { PublicDoc } from "@/domain/privacy";

/*
 * Owner pages call this before rendering. The owner check happens before any
 * database read, and the trip loader can only be reached with a verified Owner.
 */
export type OwnerPage = { kind: "config"; missing: string[] } | { kind: "signin" } | { kind: "forbidden" } | { kind: "none" } | { kind: "ok"; trip: CurrentTrip }
  | { kind: "public"; trip: { doc: PublicDoc; versionNo: number }; signedInAs: "nobody" | "other" };

export async function loadOwnerPage(): Promise<OwnerPage> {
  const missing = missingConfig("owner");
  if (missing.length) return { kind: "config", missing };
  const c = await checkOwner();
  if (!c.ok) {
    // Visitors get the redacted public view when PUBLIC_HOME=1; the owner document is never loaded here.
    const pub = await getPublicHomeTrip();
    if (pub) return { kind: "public", trip: pub, signedInAs: c.reason === "unauthenticated" ? "nobody" : "other" };
    return { kind: c.reason === "unauthenticated" ? "signin" : "forbidden" };
  }
  const trip = await getCurrentTrip(c.owner);
  return trip ? { kind: "ok", trip } : { kind: "none" };
}
