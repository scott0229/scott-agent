import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

initOpenNextCloudflareForDev();

/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  experimental: {
    // Optimize prefetching behavior
    optimizePackageImports: ['@/components/ui'],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
