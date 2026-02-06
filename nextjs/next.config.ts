import type { NextConfig } from "next";
import { execSync } from "child_process";

function getGitCommitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: getGitCommitHash(),
  },
  // Enable experimental features for server components
  experimental: {
    // Allow importing from workspace packages
    externalDir: true,
  },
  // Transpile workspace packages
  transpilePackages: ["@memory-loop/shared", "@memory-loop/backend"],
  // Configure webpack to resolve .js extensions to .ts in backend
  webpack: (config: { resolve: { extensionAlias?: Record<string, string[]> } }) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  // Disable ESLint during build (we run it separately)
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
