import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";

/*
 * Owner login (FR-26, D5): GitHub OAuth through next-auth v4, JWT sessions, no
 * database adapter. Only GitHub numeric ids listed in OWNER_GITHUB_IDS may sign in.
 * Account recovery is GitHub's own recovery flow.
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

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: clean(process.env.GITHUB_ID),
      clientSecret: clean(process.env.GITHUB_SECRET),
    }),
  ],
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { error: "/auth-error" },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "github") return false;
      return isOwnerId(String((profile as { id?: number | string } | undefined)?.id ?? ""));
    },
    async jwt({ token, account, profile }) {
      if (account?.provider === "github" && profile) token.githubId = String((profile as { id: number | string }).id);
      return token;
    },
    async session({ session, token }) {
      if (session.user) (session.user as { githubId?: string }).githubId = token.githubId as string | undefined;
      return session;
    },
  },
};
