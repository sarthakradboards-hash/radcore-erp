import type { NextConfig } from 'next';

const config: NextConfig = {
  // ADR-003 §2: files come from S3 by presigned URL, so image optimisation is off and sharp is never loaded.
  images: { unoptimized: true },
  // Next would otherwise write an AGENTS.md into apps/web on every dev start.
  agentRules: false,
};

export default config;
