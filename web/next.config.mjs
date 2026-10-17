/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  reactStrictMode: true,
  poweredByHeader: false,
  // Transpiled rather than pre-built so token changes are picked up in dev.
  transpilePackages: ["@danpahq/design-tokens"],
  typedRoutes: true,
};



export default nextConfig;
