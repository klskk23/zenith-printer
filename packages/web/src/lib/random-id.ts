/**
 * A random identifier that works where this application actually runs.
 *
 * `crypto.randomUUID()` is defined only in a **secure context** — HTTPS, or
 * localhost. This service is deliberately plain HTTP on a LAN address, so on
 * every machine except the server's own that function does not exist. Reading
 * it threw, and the print dialog died before rendering: two of three browsers
 * showed nothing, and the one that worked was the one on localhost.
 *
 * `crypto.getRandomValues()` carries no such restriction, so it is used
 * unconditionally. There is no `randomUUID()` fast path on purpose: a branch
 * that runs only on the developer's own machine is how the original bug
 * survived every test and every manual check.
 */

/** A random v4 UUID. Layout per RFC 4122 §4.4, so it reads like any other. */
export function randomId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)

  // Version 4, variant 10xx. Nothing depends on these bits, but an identifier
  // shaped like a UUID that is not one is a small trap for whoever parses it.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}
