import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable experimental features for server components
  experimental: {
    // Allow importing from workspace packages
    externalDir: true,
  },
  // Transpile workspace packages
  transpilePackages: ["@memory-loop/shared", "@memory-loop/backend"],
  // Configure webpack to resolve .js extensions to .ts in backend
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  // Disable ESLint during build (we run it separately)
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Proxy WebSocket to backend (required until WebSocket handler is migrated)
  // All REST API routes have been migrated to Next.js API routes
  async rewrites() {
    return [
      // WebSocket proxy for streaming AI responses
      {
        source: "/ws",
        destination: "http://localhost:3000/ws",
      },
    ];
  },
};

export default nextConfig;
