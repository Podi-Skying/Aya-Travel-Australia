import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";

/*
 * Owner login (FR-26, D5): GitHub OAuth through next-auth v4, JWT sessions, no
 * database adapter. Only GitHub numeric ids listed in OWNER_GITHUB_IDS may sign in.
 * Account recovery is GitHub's own recovery flow.
 *
 * Photo viewers (docs/PHOTOS-PLAN.md), only when PHOTO_VIEWERS=1: an allowlisted GitHub id, or an
 * allowlisted verified email (GitHub or Google), may also sign in. They are never owners. Google sign-in
 * exists only when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are both set.
 */

export function ownerIds(): string[] {
  return (process.env.OWNER_GITHUB_IDS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, "").trim())
    .filter(Boolean);
}

/** Env values pasted into a dashboard often carry spaces or quotes; GitHub rejects them silently. */
function clean(v: string | undefined): string {
  return (v ?? "").trim().replace(/^["']|["']$/g, "").trim();
}

export function isOwnerId(id: string | null | undefined): boolean {
  return !!id && ownerIds().includes(String(id));
}

export function photoViewersEnabled(): boolean {
  return clean(process.env.PHOTO_VIEWERS) === "1";
}

export function googleSignInEnabled(): boolean {
  return photoViewersEnabled() && !!clean(process.env.GOOGLE_CLIENT_ID) && !!clean(process.env.GOOGLE_CLIENT_SECRET);
}

type Profile = { id?: number | string; email?: string | null; email_verified?: boolean };

/** A verified email for the allowlist: Google says so in the profile; GitHub's public profile email is verified by GitHub. */
export function verifiedEmail(provider: string | undefined, profile: Profile | undefined): string | null {
  const e = profile?.email?.trim().toLowerCase();
  if (!e) return null;
  if (provider === "google") return profile?.email_verified === true ? e : null;
  return provider === "github" ? e : null;
}

/** Who may finish signing in: owners always; allowlisted photo viewers only when PHOTO_VIEWERS=1. */
export async function allowSignIn(provider: string | undefined, profile: Profile | undefined): Promise<boolean> {
  const githubId = provider === "github" ? String(profile?.id ?? "") : "";
  if (isOwnerId(githubId)) return true;
  if (!photoViewersEnabled()) return false;
  const { isAllowlisted } = await import("./photo-access");
  return isAllowlisted({ githubId: githubId || null, email: verifiedEmail(provider, profile) });
}

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: clean(process.env.GITHUB_ID),
      clientSecret: clean(process.env.GITHUB_SECRET),
    }),
    ...(googleSignInEnabled() ? [GoogleProvider({ clientId: clean(process.env.GOOGLE_CLIENT_ID), clientSecret: clean(process.env.GOOGLE_CLIENT_SECRET) })] : []),
  ],
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { error: "/auth-error" },
  callbacks: {
    async signIn({ account, profile }) {
      return allowSignIn(account?.provider, profile as Profile | undefined);
    },
    async jwt({ token, account, profile }) {
      if (account?.provider === "github" && profile) token.githubId = String((profile as { id: number | string }).id);
      if (account && profile) token.verifiedEmail = verifiedEmail(account.provider, profile as Profile) ?? undefined;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { githubId?: string }).githubId = token.githubId as string | undefined;
        (session.user as { verifiedEmail?: string }).verifiedEmail = token.verifiedEmail as string | undefined;
      }
      return session;
    },
  },
};
