/**
 * The identifier the print dialog uses instead of crypto.randomUUID().
 *
 * Driven by a stubbed byte source rather than the real one, so the assertions
 * are about the transformation and not about luck (constitution: tests MUST be
 * deterministic).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomId } from '../src/lib/random-id.ts'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Fill every byte with one value, so the output is fully predictable. */
function fillWith(byte: number): void {
  vi.stubGlobal('crypto', {
    getRandomValues: (array: Uint8Array) => {
      array.fill(byte)
      return array
    },
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('randomId', () => {
  it('uses getRandomValues, which a plain-HTTP page still has', () => {
    // The whole point: randomUUID is absent outside a secure context, so it
    // must not be reachable from here even as a fallback.
    const calls: string[] = []
    vi.stubGlobal('crypto', {
      getRandomValues: (array: Uint8Array) => { calls.push('getRandomValues'); return array },
      get randomUUID(): never { throw new Error('randomUUID must not be touched') },
    })
    expect(() => randomId()).not.toThrow()
    expect(calls).toEqual(['getRandomValues'])
  })

  it('lays the bytes out as a v4 UUID', () => {
    fillWith(0x00)
    expect(randomId()).toBe('00000000-0000-4000-8000-000000000000')
  })

  it('sets the version and variant bits without disturbing the rest', () => {
    // 0xff everywhere: byte 6 keeps its low nibble and becomes 0x4f, byte 8
    // keeps its low six bits and becomes 0xbf. Everything else stays 0xff.
    fillWith(0xff)
    expect(randomId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
  })

  it('matches the shape anything parsing a UUID expects', () => {
    fillWith(0x5a)
    expect(randomId()).toMatch(UUID_V4)
  })

  it('does not return the same value twice', () => {
    // The one assertion that has to use the real source — an identifier
    // generator that always returned 00000000-... would satisfy every test
    // above. Collision odds here are 2^-122.
    const ids = new Set(Array.from({ length: 100 }, () => randomId()))
    expect(ids.size).toBe(100)
    for (const id of ids) expect(id).toMatch(UUID_V4)
  })
})
