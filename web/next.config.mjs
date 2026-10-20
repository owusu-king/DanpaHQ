import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  reactStrictMode: true,
  poweredByHeader: false,
  // This app consumes the sibling packages/design-tokens workspace. There are
  // lockfiles at both the repository and web-app levels, so inference warns and
  // can choose differently across environments. Name the shared filesystem
  // root explicitly for stable dev and production module resolution.
  turbopack: {
    root: path.join(webRoot, ".."),
  },
  experimental: {
    // The shared root has its own package boundary; the web app owns the
    // Tailwind/PostCSS pipeline, so its nearby config must win for its CSS.
    turbopackLocalPostcssConfig: true,
  },
  // Transpiled rather than pre-built so token changes are picked up in dev.
  transpilePackages: ["@danpahq/design-tokens"],
  typedRoutes: true,
};



export default nextConfig;
