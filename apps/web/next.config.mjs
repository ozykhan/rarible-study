/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Type checking runs as its own step (`pnpm typecheck`), with the repo's TypeScript.
  typescript: { ignoreBuildErrors: true },
  poweredByHeader: false
}

export default nextConfig
