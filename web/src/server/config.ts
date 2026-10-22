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
  const missing = keys.filter((k) => !process.env[k]?.trim());
  // A common mistake is pasting Neon's Data API (https://…/rest/v1) URL instead of the Postgres connection string.
  const db = process.env.DATABASE_URL?.trim().replace(/^["']|["']$/g, "");
  if (db && !/^postgres(ql)?:\/\//.test(db)) missing.push("DATABASE_URL（格式錯誤：需要 postgresql:// 開頭的連線字串）");
  return missing;
}
