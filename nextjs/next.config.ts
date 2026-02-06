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
  // Keep cron as a runtime dependency (uses child_process, can't be bundled)
  serverExternalPackages: ["cron"],
  // Disable ESLint during build (we run it separately)
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
