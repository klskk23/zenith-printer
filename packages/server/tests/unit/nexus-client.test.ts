/**
 * The real ledger client: how a failure is classified, and what it says.
 *
 * The port has a fake everywhere else, which is what keeps the suite offline —
 * but the fake cannot be wrong about `fetch`. This file is about the one thing
 * only the real adapter does: turn what went wrong into something a person can
 * act on.
 *
 * `fetch` rejects with the same useless message for every network fault —
 * literally `fetch failed` — and puts the fault in `cause.code`. Dropping that
 * is how "the ledger is unreachable" came to mean both "that name does not
 * resolve" and "nothing is listening there", which need opposite repairs and
 * were reported identically.
 */
import { describe, expect, it, vi } from 'vitest'
import { createNexusClient } from '../../src/integrations/nexus-client.ts'
import { NexusError } from '../../src/domain/nexus.ts'

const client = () => createNexusClient({ baseUrl: 'http://ledger.invalid', apiKey: 'k.k' })

/** `fetch` rejecting the way Node's does: a bare message, the fault in `cause`. */
function networkFailure(code: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      const err = new TypeError('fetch failed')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(err as any).cause = Object.assign(new Error(`${code} something`), { code })
      return Promise.reject(err)
    }),
  )
}

function answering(status: number, body: unknown = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: status < 400,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      } as unknown as Response),
    ),
  )
}

const caught = async (call: () => Promise<unknown>): Promise<NexusError> => {
  try {
    await call()
  } catch (err) {
    if (err instanceof NexusError) {
      return err
    }
    throw err
  }
  throw new Error('expected the call to fail')
}

describe('when the network refuses', () => {
  it('says the name did not resolve, not just that it failed', async () => {
    // ENOTFOUND is a DNS answer: the container name is wrong, the two are on
    // different networks, or something has replaced the embedded resolver.
    networkFailure('ENOTFOUND')
    const err = await caught(() => client().categories('zh-CN'))
    expect(err.kind).toBe('unreachable')
    expect(err.detail).toContain('ENOTFOUND')
  })

  it('says the port refused, which is a different repair', async () => {
    // ECONNREFUSED means the name resolved and nothing is listening — the
    // ledger is down or on another port. Reported identically to a DNS fault,
    // it sends somebody to check the wrong thing.
    networkFailure('ECONNREFUSED')
    const err = await caught(() => client().rows({ categoryId: 'c', offset: 0, limit: 10, locale: 'zh-CN' }))
    expect(err.detail).toContain('ECONNREFUSED')
  })

  it('still says something when there is no code to report', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('boom'))))
    const err = await caught(() => client().categories('zh-CN'))
    expect(err.kind).toBe('unreachable')
    expect(err.detail).toContain('boom')
  })
})

describe('when the ledger answers', () => {
  it('separates a rejected key from an unreachable service', async () => {
    answering(401)
    expect((await caught(() => client().categories('zh-CN'))).kind).toBe('unauthorised')
  })

  it('separates a rejected request, which is this service’s own bug', async () => {
    answering(422)
    expect((await caught(() => client().categories('zh-CN'))).kind).toBe('badRequest')
  })

  it('reports the status for anything else, so it is not a guess', async () => {
    answering(503)
    const err = await caught(() => client().categories('zh-CN'))
    expect(err.kind).toBe('unreachable')
    expect(err.detail).toContain('503')
  })

  it('calls it a bad shape when the answer is not what it claims to be', async () => {
    answering(200, { nonsense: true })
    expect((await caught(() => client().categories('zh-CN'))).kind).toBe('badShape')
  })
})
