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
  // Proxy API requests to the backend during development
  // In production, the Next.js app will be the primary server
  async rewrites() {
    return [
      // Proxy to existing Hono backend for non-chat routes
      {
        source: "/api/vaults/:path*",
        destination: "http://localhost:3000/api/vaults/:path*",
      },
      {
        source: "/api/sessions/:path*",
        destination: "http://localhost:3000/api/sessions/:path*",
      },
      // WebSocket proxy for backward compatibility
      {
        source: "/ws",
        destination: "http://localhost:3000/ws",
      },
    ];
  },
};

export default nextConfig;
