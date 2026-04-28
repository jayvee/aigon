import nextra from "nextra";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const withNextra = nextra({
  contentDirBasePath: "/docs",
});

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  outputFileTracingRoot: resolve(__dirname),
  async redirects() {
    return [
      {
        source: "/docs/guides/amplification",
        destination: "/docs/guides/insights",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/",
        destination: "/home.html",
      },
    ];
  },
};

export default withNextra(config);
