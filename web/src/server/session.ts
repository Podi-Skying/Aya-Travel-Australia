import { getServerSession } from "next-auth";
import { authOptions } from "./auth";

/* Isolated so tests can mock the session without a request context. */
export async function getSessionGithubId(): Promise<string | null> {
  const s = await getServerSession(authOptions);
  const id = (s?.user as { githubId?: string } | undefined)?.githubId;
  return id ?? null;
}

/** The signed-in account for the photo allowlist: GitHub id and/or a verified, lower-cased email. */
export async function getSessionIdentity(): Promise<{ githubId: string | null; email: string | null }> {
  const s = await getServerSession(authOptions);
  const u = s?.user as { githubId?: string; verifiedEmail?: string } | undefined;
  return { githubId: u?.githubId ?? null, email: u?.verifiedEmail ?? null };
}
