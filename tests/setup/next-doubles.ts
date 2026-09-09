/**
 * Server actions read cookies through next/headers and revalidate through next/cache.
 * Both are replaced here, once, for every test file — so the tests exercise the real
 * validation, permission and transaction code with a fake request context.
 */
import { vi } from 'vitest'

const jar: Map<string, string> = ((globalThis as { __aopsCookieJar?: Map<string, string> }).__aopsCookieJar ??=
  new Map())

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      jar.set(name, value)
    },
    delete: (name: string) => {
      jar.delete(name)
    },
    has: (name: string) => jar.has(name),
  }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))
