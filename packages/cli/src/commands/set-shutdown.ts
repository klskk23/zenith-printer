/**
 * Hardware verification #1 (research.md) — the highest-priority open assumption.
 *
 * `AutoShutdownTime.ShutdownTime4` is documented upstream as "May be 60 minutes
 * or never (depending on model)" — the library itself does not know. If B3S_P
 * does NOT map it to "never", then the first print job after an hour of idling
 * always fails and somebody has to walk over and press the power button
 * (the printer cannot be woken over USB). That outcome changes the wording of
 * FR-036 and the realistic ceiling on SC-001, so it must be settled before any
 * UI copy is written.
 *
 * niimblue's own CLI does not expose this command, which is why it lives here.
 */
import type { Command } from 'commander'
import { AutoShutdownTime, NiimbotNodeSerialClient } from '@mmote/niimbluelib'
import { ExitCode, emit, run, type CliError, type ExitCodeValue } from '../output.ts'

const SHUTDOWN_LABELS: Record<number, string> = {
  [AutoShutdownTime.ShutdownTime1]: 'usually 15 minutes',
  [AutoShutdownTime.ShutdownTime2]: 'usually 30 minutes',
  [AutoShutdownTime.ShutdownTime3]: '45 or 60 minutes (model dependent)',
  [AutoShutdownTime.ShutdownTime4]: '60 minutes or never (model dependent)',
}

function classify(err: unknown): { error: CliError; exitCode: ExitCodeValue } {
  const message = err instanceof Error ? err.message : String(err)
  const unreachable = /ENOENT|EACCES|not open|timeout|cannot open/i.test(message)
  return {
    exitCode: unreachable ? ExitCode.Unreachable : ExitCode.DeviceError,
    error: {
      code: unreachable ? 'PRINTER_UNREACHABLE' : 'DEVICE_ERROR',
      what: unreachable ? 'Could not connect to the printer' : 'The printer rejected the command',
      why: message,
      next: unreachable
        ? 'Check the printer is powered on and the serial address is correct; verify membership of the dialout group.'
        : 'Re-run with --json to capture the raw response, then check the firmware version.',
    },
  }
}

export function registerSetShutdown(program: Command): void {
  program
    .command('set-shutdown')
    .description('read or set the auto shutdown time (hardware verification #1)')
    .requiredOption('-a, --address <path>', 'serial device path, e.g. /dev/ttyACM0')
    .option('-t, --time <1|2|3|4>', 'shutdown preset to write; omit to only read the current value')
    .action(async (opts: { address: string; time?: string }, cmd: Command) => {
      const json = Boolean(cmd.parent?.opts().json)

      await run(
        { json },
        async () => {
          const client = new NiimbotNodeSerialClient()
          client.setPort(opts.address)
          await client.connect()

          try {
            const before = await client.abstraction.getAutoShutDownTime()
            let after = before

            if (opts.time !== undefined) {
              const target = Number(opts.time)
              if (![1, 2, 3, 4].includes(target)) {
                throw new Error(`--time must be one of 1, 2, 3, 4 (received ${opts.time})`)
              }
              await client.abstraction.setAutoShutDownTime(target as AutoShutdownTime)
              // Read back: writing is not proof that the device accepted it.
              after = await client.abstraction.getAutoShutDownTime()
            }

            const info = client.getPrinterInfo()
            const result = {
              model: client.getModelMetadata()?.model ?? null,
              firmwareVersion: info?.softwareVersion ?? null,
              before: { value: before, meaning: SHUTDOWN_LABELS[before] ?? 'unknown' },
              after: { value: after, meaning: SHUTDOWN_LABELS[after] ?? 'unknown' },
              writeConfirmed: opts.time === undefined ? null : after === Number(opts.time),
            }

            emit(
              result,
              { json },
              () =>
                [
                  `model:            ${result.model ?? 'unknown'}`,
                  `firmware:         ${result.firmwareVersion ?? 'unknown'}`,
                  `shutdown before:  ${result.before.value} (${result.before.meaning})`,
                  `shutdown after:   ${result.after.value} (${result.after.meaning})`,
                  `write confirmed:  ${result.writeConfirmed ?? 'n/a (read-only run)'}`,
                  '',
                  'Verification #1 is only complete once the printer has been left idle for',
                  'more than 70 minutes and observed to still be powered on.',
                ].join('\n'),
            )
          } finally {
            // Constitution ("Resource safety"): release on every path.
            await client.disconnect()
          }
        },
        classify,
      )
    })
}
