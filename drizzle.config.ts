import type { Config } from 'drizzle-kit'

// Generation only. `drizzle-kit generate` never opens a database, which is what keeps
// the single-writer rule intact while the dev server is running.
export default {
  dialect: 'postgresql',
  schema: './lib/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
} satisfies Config
