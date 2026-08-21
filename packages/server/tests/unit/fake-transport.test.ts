import { describe, expect, it } from 'vitest'
import { FakeTransport } from '../../src/drivers/fake/fake-transport.ts'

describe('recording', () => {
  it('captures every write for golden-sample comparison', async () => {
    const t = new FakeTransport()
    await t.open()
    await t.write(new Uint8Array([0x55, 0x55]))
    await t.write(new Uint8Array([0x01]))
    expect(t.writes).toHaveLength(2)
    expect(t.writtenHex()).toBe('555501')
  })

  it('copies the written buffer so later mutation cannot corrupt the record', async () => {
    const t = new FakeTransport()
    await t.open()
    const buffer = new Uint8Array([1, 2, 3])
    await t.write(buffer)
    buffer[0] = 99
    expect(t.writtenHex()).toBe('010203')
  })
})

describe('scripted responses', () => {
  it('serves prepared responses in order', async () => {
    const received: string[] = []
    const t = new FakeTransport({ responses: [new Uint8Array([0xaa]), new Uint8Array([0xbb])] })
    await t.open()
    t.onData((chunk) => received.push(chunk[0]?.toString(16) ?? ''))
    await t.write(new Uint8Array([1]))
    await t.write(new Uint8Array([2]))
    expect(received).toEqual(['aa', 'bb'])
  })

  it('stops emitting once the script is exhausted', async () => {
    const received: number[] = []
    const t = new FakeTransport({ responses: [new Uint8Array([0xaa])] })
    await t.open()
    t.onData(() => received.push(1))
    await t.write(new Uint8Array([1]))
    await t.write(new Uint8Array([2]))
    expect(received).toHaveLength(1)
  })
})

describe('programmable failures', () => {
  it('can fail on open, standing in for an unreachable device', async () => {
    const t = new FakeTransport({ failOnOpen: new Error('ENOENT') })
    await expect(t.open()).rejects.toThrow('ENOENT')
    expect(t.isOpen).toBe(false)
  })

  it('can fail on a chosen write, standing in for a mid-job fault', async () => {
    const t = new FakeTransport({ failOnWrite: { afterWrites: 1, error: new Error('device fault') } })
    await t.open()
    await t.write(new Uint8Array([1]))
    await expect(t.write(new Uint8Array([2]))).rejects.toThrow('device fault')
  })

  it('refuses writes while closed', async () => {
    const t = new FakeTransport()
    await expect(t.write(new Uint8Array([1]))).rejects.toThrow(/not open/)
  })
})

describe('lifecycle', () => {
  it('counts opens and closes so release can be asserted', async () => {
    const t = new FakeTransport()
    await t.open()
    await t.close()
    expect(t.openCount).toBe(1)
    expect(t.closeCount).toBe(1)
  })

  it('drops subscribers on close', async () => {
    const received: number[] = []
    const t = new FakeTransport()
    await t.open()
    t.onData(() => received.push(1))
    await t.close()
    t.emit(new Uint8Array([1]))
    expect(received).toHaveLength(0)
  })

  it('honours unsubscribe', async () => {
    const received: number[] = []
    const t = new FakeTransport()
    await t.open()
    const off = t.onData(() => received.push(1))
    off()
    t.emit(new Uint8Array([1]))
    expect(received).toHaveLength(0)
  })
})
