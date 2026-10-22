import { getServerSession } from "next-auth";
import { authOptions } from "./auth";

/* Isolated so tests can mock the session without a request context. */
export async function getSessionGithubId(): Promise<string | null> {
  const s = await getServerSession(authOptions);
  const id = (s?.user as { githubId?: string } | undefined)?.githubId;
  return id ?? null;
}
