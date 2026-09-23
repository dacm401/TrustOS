/** @type {import('next').NextConfig} */
// output defaults to "standalone" for production deploys. Validation/build in
// constrained environments (where bulk-deleting .next/standalone triggers a
// safe-delete confirmation) can disable it via NEXT_PRIVATE_STANDALONE=0.
const nextConfig = {
  output: process.env.NEXT_PRIVATE_STANDALONE === "0" ? undefined : "standalone",
  typescript: { ignoreBuildErrors: true },
  // Same-origin API proxy: the browser only ever talks to :3000 (this frontend
  // container). Requests under /api /v1 /auth /health /metrics /readiness are
  // rewritten server-side to the backend service. This removes cross-port CORS
  // entirely so the app works behind the IDE preview proxy and in any browser.
  async rewrites() {
    const target = process.env.BACKEND_INTERNAL_URL || "http://backend:3001";
    return [
      { source: "/api/:path*", destination: `${target}/api/:path*` },
      { source: "/v1/:path*", destination: `${target}/v1/:path*` },
      { source: "/auth/:path*", destination: `${target}/auth/:path*` },
      { source: "/health", destination: `${target}/health` },
      { source: "/metrics", destination: `${target}/metrics` },
      { source: "/readiness", destination: `${target}/readiness` },
    ];
  },
};
module.exports = nextConfig;
