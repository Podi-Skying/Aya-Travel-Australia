import { checkOwner } from "./owner";
import { missingConfig } from "./config";
import { getCurrentTrip, type CurrentTrip } from "./trips";

/*
 * Owner pages call this before rendering. The owner check happens before any
 * database read, and the trip loader can only be reached with a verified Owner.
 */
export type OwnerPage = { kind: "config"; missing: string[] } | { kind: "signin" } | { kind: "forbidden" } | { kind: "none" } | { kind: "ok"; trip: CurrentTrip };

export async function loadOwnerPage(): Promise<OwnerPage> {
  const missing = missingConfig("owner");
  if (missing.length) return { kind: "config", missing };
  const c = await checkOwner();
  if (!c.ok) return { kind: c.reason === "unauthenticated" ? "signin" : "forbidden" };
  const trip = await getCurrentTrip(c.owner);
  return trip ? { kind: "ok", trip } : { kind: "none" };
}
