/** @type {import('next').NextConfig} */
// output defaults to "standalone" for production deploys. Validation/build in
// constrained environments (where bulk-deleting .next/standalone triggers a
// safe-delete confirmation) can disable it via NEXT_PRIVATE_STANDALONE=0.
const nextConfig = {
  output: process.env.NEXT_PRIVATE_STANDALONE === "0" ? undefined : "standalone",
  typescript: { ignoreBuildErrors: true },
};
module.exports = nextConfig;
