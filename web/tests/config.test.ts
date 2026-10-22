import { afterEach, describe, expect, it, vi } from "vitest";
import { missingConfig } from "@/server/config";

/* A deployment without required settings must say so instead of failing with a 500. */

afterEach(() => vi.unstubAllEnvs());

describe("missingConfig", () => {
  it("lists missing owner and public settings in production on Vercel", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    for (const k of ["NEXTAUTH_SECRET", "NEXTAUTH_URL", "GITHUB_ID", "GITHUB_SECRET", "OWNER_GITHUB_IDS", "VOTER_HASH_SALT", "DATABASE_URL"]) vi.stubEnv(k, "");
    expect(missingConfig("owner")).toEqual(["NEXTAUTH_SECRET", "NEXTAUTH_URL", "GITHUB_ID", "GITHUB_SECRET", "OWNER_GITHUB_IDS", "VOTER_HASH_SALT", "DATABASE_URL"]);
    expect(missingConfig("public")).toEqual(["VOTER_HASH_SALT", "DATABASE_URL"]);
    vi.stubEnv("VOTER_HASH_SALT", "s");
    vi.stubEnv("DATABASE_URL", "postgres://x");
    expect(missingConfig("public")).toEqual([]);
  });

  it("flags a DATABASE_URL that is not a Postgres connection string", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VOTER_HASH_SALT", "s");
    vi.stubEnv("DATABASE_URL", " https://ep-x.apirest.ap-southeast-2.aws.neon.tech/neondb/rest/v1");
    expect(missingConfig("public")[0]).toMatch(/^DATABASE_URL（格式錯誤/);
  });

  it("does not require settings outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(missingConfig("owner")).toEqual([]);
  });
});
