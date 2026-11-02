import type { NextConfig } from 'next';

const config: NextConfig = {
  // Note identifiers live in URLs. Keep framework development access logging off;
  // application attempt/outcome/error logs remain visible and sanitized.
  logging: { incomingRequests: false },
};

export default config;
