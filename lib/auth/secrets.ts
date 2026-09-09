/**
 * Hashing and token generation. `node:crypto` only — no native build, nothing to
 * install, and nothing that changes when this moves to a hosted database.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const KEY_LENGTH = 64
const SCRYPT_COST = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

export type HashedSecret = { hash: string; salt: string }

export function hashSecret(secret: string): HashedSecret {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(secret.normalize('NFKC'), salt, KEY_LENGTH, SCRYPT_COST).toString('hex')
  return { hash, salt }
}

export function verifySecret(secret: string, stored: HashedSecret | null): boolean {
  if (!stored?.hash || !stored.salt) return false
  const candidate = scryptSync(secret.normalize('NFKC'), stored.salt, KEY_LENGTH, SCRYPT_COST)
  const expected = Buffer.from(stored.hash, 'hex')
  if (expected.length !== candidate.length) return false
  return timingSafeEqual(candidate, expected)
}

/** 32 bytes of entropy — a portal link that cannot be guessed or enumerated. */
export function generatePortalToken(): string {
  return randomBytes(24).toString('base64url')
}

export function generatePin(length = 4): string {
  let pin = ''
  while (pin.length < length) {
    // Rejection sampling keeps every digit equally likely.
    for (const byte of randomBytes(length)) {
      if (byte < 250 && pin.length < length) pin += String(byte % 10)
    }
  }
  return pin
}

export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin)
}
