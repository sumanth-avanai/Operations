/** Postgres error shapes we translate into human refusals. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const code = (error as { code?: string } | null)?.code
  const isUnique = code === '23505' || /duplicate key value|unique constraint/i.test(message)
  if (!isUnique) return false
  return constraint ? message.includes(constraint) : true
}

export function isCheckViolation(error: unknown, constraint?: string): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const code = (error as { code?: string } | null)?.code
  const isCheck = code === '23514' || /violates check constraint/i.test(message)
  if (!isCheck) return false
  return constraint ? message.includes(constraint) : true
}
