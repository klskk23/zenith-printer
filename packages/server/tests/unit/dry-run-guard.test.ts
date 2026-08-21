import { describe, expect, it } from 'vitest'
import { isDryRunEnabled, createDriver } from '../../src/drivers/factory.ts'
import { DryRunDriver } from '../../src/drivers/dry-run/dry-run-driver.ts'
import { silentLogger } from '../support/queue-harness.ts'
import type { Printer } from '../../src/domain/printer.ts'

const printer: Printer = {
  id: 'p1',
  name: 'warehouse',
  kind: 'niimbot',
  transport: 'serial',
  // The real device path. If the guard ever fails, this test prints labels.
  address: '/dev/ttyACM0',
  printTaskName: 'B1',
  capabilities: null,
  queueState: 'running',
  queuePausedReason: null,
  lastProbedAt: null,
  offsetXDots: 0,
  offsetYDots: 0,
  createdAt: '2026-08-21T00:00:00Z',
}

describe('hardware guard', () => {
  it('is active whenever a test runner is present', () => {
    // Constitution Principle II: the default suite must pass with no printer
    // attached — which also means it must not use one that happens to be.
    expect(process.env.VITEST).toBeDefined()
    expect(isDryRunEnabled()).toBe(true)
  })

  it('hands back a dry-run driver even for a real device path', () => {
    // The guard lives in the factory precisely so no test setup can forget it.
    const driver = createDriver(printer, { logger: silentLogger })
    expect(driver).toBeInstanceOf(DryRunDriver)
  })

  it('never constructs a serial client under test', async () => {
    // Connecting must be a no-op rather than an actual port open.
    const driver = createDriver(printer, { logger: silentLogger })
    await expect(driver.connect()).resolves.toBeUndefined()
    await expect(driver.disconnect()).resolves.toBeUndefined()
  })

  it('applies to network printers too', () => {
    const zpl = { ...printer, kind: 'zpl' as const, transport: 'tcp' as const, address: '192.168.1.50:9100' }
    expect(createDriver(zpl, { logger: silentLogger })).toBeInstanceOf(DryRunDriver)
  })
})
