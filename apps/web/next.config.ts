import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@medcore/shared"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "media.licdn.com" }],
  },
};

export default nextConfig;
