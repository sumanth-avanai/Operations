import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // PGlite ships WASM and a node filesystem layer. Keeping it external guarantees
  // exactly one copy of the driver in the server process, which matters because
  // PGlite does not lock its data directory (see specs research.md D3).
  serverExternalPackages: ['@electric-sql/pglite', 'pg', 'exceljs'],
  typedRoutes: false,
  experimental: {
    // Server actions carry whole timesheet weeks and booking ranges.
    serverActions: { bodySizeLimit: '2mb' },
  },
}

export default nextConfig
