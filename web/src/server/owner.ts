import { isOwnerId } from "./auth";
import { getSessionGithubId } from "./session";

/*
 * An Owner value can only be created here, after the session check. Every
 * function that reads or writes the owner document requires one (PLAN.md 4.2).
 */

declare const ownerBrand: unique symbol;
export type Owner = { readonly githubId: string; readonly [ownerBrand]: true };

export type OwnerCheck = { ok: true; owner: Owner } | { ok: false; reason: "unauthenticated" | "forbidden" };

export async function checkOwner(): Promise<OwnerCheck> {
  const id = await getSessionGithubId();
  if (!id) return { ok: false, reason: "unauthenticated" };
  if (!isOwnerId(id)) return { ok: false, reason: "forbidden" };
  return { ok: true, owner: { githubId: id } as Owner };
}
