import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./tests/setup/next-doubles.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
  resolve: {
    alias: {
      // Must come before '@' so the more specific key wins.
      'server-only': path.resolve(process.cwd(), 'tests/stubs/server-only.ts'),
      '@': path.resolve(process.cwd()),
    },
  },
})
