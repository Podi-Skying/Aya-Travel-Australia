import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA ?? `local-${Date.now()}`,
  },
  serverExternalPackages: ["@electric-sql/pglite"],
  // Private photos (owner and share links only) are served by /api/media, not from public/.
  outputFileTracingIncludes: { "/api/media/[...path]": ["./media/**"] },
  // The 3D /journey page was removed on 2026-10-26 (recoverable from git history before that date).
  async redirects() {
    return [
      { source: "/journey", destination: "/plan", permanent: false },
      { source: "/s/:token/journey", destination: "/s/:token/plan", permanent: false },
    ];
  },
  async headers() {
    return [
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }] },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Tile servers require a Referer; send the origin only, so share-link tokens in the path never leave the site.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
