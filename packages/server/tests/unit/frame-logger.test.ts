import { describe, expect, it } from 'vitest'
import { FakeTransport } from '../../src/drivers/fake/fake-transport.ts'
import { redactIdentifiers, withFrameLogging, type LogLevel, type Logger } from '../../src/drivers/frame-logger.ts'

interface Entry {
  payload: Record<string, unknown>
  message: string
}

function recorder(level: LogLevel): { logger: Logger; entries: Entry[] } {
  const entries: Entry[] = []
  return {
    entries,
    logger: {
      level,
      debug: (payload, message) => {
        if (level === 'debug') entries.push({ payload, message })
      },
      info: (payload, message) => entries.push({ payload, message }),
    },
  }
}

const frames = (entries: Entry[]): Entry[] => entries.filter((e) => e.message === 'printer frame')

describe('debug level', () => {
  it('records every outbound frame as hex', async () => {
    const { logger, entries } = recorder('debug')
    const transport = withFrameLogging(new FakeTransport(), logger, { printerId: 'p1' })

    await transport.open()
    await transport.write(new Uint8Array([0x55, 0x55, 0x01]))
    await transport.write(new Uint8Array([0xaa]))

    const sent = frames(entries).filter((e) => e.payload.direction === '>>')
    expect(sent).toHaveLength(2)
    expect(sent[0]?.payload.frame).toBe('555501')
    expect(sent[1]?.payload.frame).toBe('aa')
  })

  it('records inbound frames too', async () => {
    const { logger, entries } = recorder('debug')
    const fake = new FakeTransport()
    const transport = withFrameLogging(fake, logger, { printerId: 'p1' })

    await transport.open()
    transport.onData(() => {})
    fake.emit(new Uint8Array([0x02, 0xff]))

    const received = frames(entries).filter((e) => e.payload.direction === '<<')
    expect(received).toHaveLength(1)
    expect(received[0]?.payload.frame).toBe('02ff')
  })

  it('tags each frame with the printer and job so errors stay traceable', async () => {
    const { logger, entries } = recorder('debug')
    const transport = withFrameLogging(new FakeTransport(), logger, { printerId: 'p1', jobId: 'j9' })

    await transport.open()
    await transport.write(new Uint8Array([0x01]))

    expect(frames(entries)[0]?.payload).toMatchObject({ printerId: 'p1', jobId: 'j9' })
  })

  it('logs a text protocol verbatim rather than as hex', async () => {
    const { logger, entries } = recorder('debug')
    const transport = withFrameLogging(new FakeTransport(), logger, { printerId: 'p2' }, { encoding: 'text' })

    await transport.open()
    await transport.write(new TextEncoder().encode('^XA^FO50,50^XZ'))

    expect(frames(entries)[0]?.payload.frame).toBe('^XA^FO50,50^XZ')
  })

  it('truncates an oversized frame instead of flooding the log', async () => {
    const { logger, entries } = recorder('debug')
    const transport = withFrameLogging(new FakeTransport(), logger, { printerId: 'p1' }, { maxBytes: 4 })

    await transport.open()
    await transport.write(new Uint8Array(100).fill(0xab))

    expect(String(frames(entries)[0]?.payload.frame)).toMatch(/100 bytes total/)
  })
})

describe('levels above debug', () => {
  it.each<LogLevel>(['info', 'warn', 'error'])('records no frame content at %s level', async (level) => {
    const { logger, entries } = recorder(level)
    const transport = withFrameLogging(new FakeTransport(), logger, { printerId: 'p1' })

    await transport.open()
    await transport.write(new Uint8Array([0x55, 0x55]))

    expect(frames(entries)).toHaveLength(0)
  })
})

describe('identifier redaction', () => {
  it('masks a device serial number', () => {
    expect(redactIdentifiers('serial=H508010165')).toBe('serial=***REDACTED***')
  })

  it('masks a MAC address', () => {
    expect(redactIdentifiers('mac=65:01:01:08:15:01')).toBe('mac=**:**:**:**:**:**')
  })

  it('leaves ordinary text alone', () => {
    expect(redactIdentifiers('printer B3S_P ready')).toBe('printer B3S_P ready')
  })
})

describe('pass-through behaviour', () => {
  it('forwards writes to the wrapped transport unchanged', async () => {
    const fake = new FakeTransport()
    const { logger } = recorder('debug')
    const transport = withFrameLogging(fake, logger, { printerId: 'p1' })

    await transport.open()
    await transport.write(new Uint8Array([1, 2, 3]))

    expect(fake.writtenHex()).toBe('010203')
  })

  it('forwards close and reflects open state', async () => {
    const fake = new FakeTransport()
    const { logger } = recorder('info')
    const transport = withFrameLogging(fake, logger, { printerId: 'p1' })

    expect(transport.isOpen).toBe(false)
    await transport.open()
    expect(transport.isOpen).toBe(true)
    await transport.close()
    expect(fake.closeCount).toBe(1)
  })
})
