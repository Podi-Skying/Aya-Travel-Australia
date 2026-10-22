/*
 * Required server settings. A deployment missing one of these shows a clear
 * "setup incomplete" page (names only, never values) instead of a 500.
 */

const OWNER_KEYS = ["NEXTAUTH_SECRET", "NEXTAUTH_URL", "GITHUB_ID", "GITHUB_SECRET", "OWNER_GITHUB_IDS"] as const;
const PUBLIC_KEYS = ["VOTER_HASH_SALT"] as const;

function needsDatabaseUrl(): boolean {
  return !!process.env.VERCEL;
}

export function missingConfig(scope: "owner" | "public"): string[] {
  if (process.env.NODE_ENV !== "production") return [];
  const keys: string[] = [...(scope === "owner" ? OWNER_KEYS : []), ...PUBLIC_KEYS];
  if (needsDatabaseUrl()) keys.push("DATABASE_URL");
  return keys.filter((k) => !process.env[k]?.trim());
}
