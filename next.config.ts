import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // no need to announce what the site is built with
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Every page and reply: never shown inside another site's frame, no
        // guessing at file types, and no full addresses passed on to other sites.
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // The loading-screen clip and its still. The file names carry a version
        // (`-v1`), so they can be cached for good: a visitor downloads them once
        // and every later page change plays them from the browser's own cache.
        source: "/grace/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        // The site artwork (see src/lib/art.ts): versioned names, same rule.
        source: "/art/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
