/**
 * Read consumable RFID data.
 * Hardware verification #6 (research.md): establish what `rfidInfo()` actually
 * does with third-party, non-RFID stock — throw, or return empty? That answer
 * decides how FR-016's "skip the check and print anyway" branch is written.
 */
import type { Command } from 'commander'
import { NiimbotNodeSerialClient } from '@mmote/niimbluelib'
import { ExitCode, emit, run, type CliError, type ExitCodeValue } from '../output.ts'

function classify(err: unknown): { error: CliError; exitCode: ExitCodeValue } {
  const message = err instanceof Error ? err.message : String(err)
  return {
    exitCode: ExitCode.DeviceError,
    error: {
      code: 'RFID_READ_FAILED',
      what: 'Could not read consumable RFID data',
      why: message,
      next: 'This is the expected outcome for non-RFID third-party stock. Record the exact failure mode in research.md.',
    },
  }
}

export function registerRfid(program: Command): void {
  program
    .command('rfid')
    .description('read consumable RFID data (hardware verification #6)')
    .requiredOption('-a, --address <path>', 'serial device path, e.g. /dev/ttyACM0')
    .action(async (opts: { address: string }, cmd: Command) => {
      const json = Boolean(cmd.parent?.opts().json)

      await run(
        { json },
        async () => {
          const client = new NiimbotNodeSerialClient()
          client.setPort(opts.address)
          await client.connect()

          try {
            const paperRfidInfo = await client.abstraction.rfidInfo()
            const remaining =
              paperRfidInfo.allPaper > 0 ? paperRfidInfo.allPaper - paperRfidInfo.usedPaper : null

            emit(
              { paperRfidInfo, remaining },
              { json },
              () =>
                [
                  `tag present: ${paperRfidInfo.tagPresent}`,
                  `total:       ${paperRfidInfo.allPaper}`,
                  `used:        ${paperRfidInfo.usedPaper}`,
                  `remaining:   ${remaining ?? 'unknown'}`,
                ].join('\n'),
            )
          } finally {
            await client.disconnect()
          }
        },
        classify,
      )
    })
}
