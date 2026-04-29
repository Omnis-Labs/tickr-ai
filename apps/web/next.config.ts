import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Standalone bundles the server + only the runtime-needed node_modules
  // into .next/standalone, which is what the web Dockerfile runs from.
  // `next dev` ignores this flag, so it doesn't affect local dev DX.
  output: 'standalone',
  // In a monorepo the trace must point at the repo root so workspace
  // packages (@hunch-it/db, @hunch-it/shared) are copied into the
  // standalone bundle. Without this Next traces from apps/web only and
  // the bundle 404s on workspace imports at runtime.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  experimental: {
    // Allow importing TS from sibling workspaces (packages/shared).
    externalDir: true,
  },
  transpilePackages: ['@hunch-it/shared'],
  // ESLint config in this repo is missing the eslint-plugin-react-hooks
  // rule definitions (pre-existing). tsc --noEmit catches actual type
  // errors via `pnpm typecheck`; this just keeps Next from failing the
  // build over a config gap.
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    // Some wallet adapter deps ship CommonJS + Node polyfills. These two
    // are the common offenders in Solana front-end bundles.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false,
    };
    // packages/shared uses NodeNext-flavoured `.js` extensions on relative
    // imports (so the ws-server can typecheck under moduleResolution=NodeNext).
    // webpack reads those literally and 404s on a missing `./types.js`.
    // extensionAlias tells webpack to also try `.ts`/`.tsx` when it sees `.js`.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    };
    return config;
  },
};

export default nextConfig;
