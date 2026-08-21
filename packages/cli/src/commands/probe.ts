/**
 * Probe printer capabilities and measure connection handshake latency.
 * Doubles as hardware verification #2 (research.md): the handshake duration
 * decides whether the UI needs a "waking the printer" affordance, since the
 * on-demand connection model pays that cost on every job.
 */
import type { Command } from 'commander'
import { NiimbotNodeSerialClient } from '@mmote/niimbluelib'
import { ExitCode, emit, run, type CliError, type ExitCodeValue } from '../output.ts'

function classify(err: unknown): { error: CliError; exitCode: ExitCodeValue } {
  const message = err instanceof Error ? err.message : String(err)
  return {
    exitCode: ExitCode.Unreachable,
    error: {
      code: 'PRINTER_UNREACHABLE',
      what: 'Could not connect to the printer',
      why: message,
      next: 'Confirm the printer is powered on, the address is correct, and the user is in the dialout group.',
    },
  }
}

export function registerProbe(program: Command): void {
  program
    .command('probe')
    .description('probe capabilities and measure handshake latency (hardware verification #2)')
    .requiredOption('-a, --address <path>', 'serial device path, e.g. /dev/ttyACM0')
    .action(async (opts: { address: string }, cmd: Command) => {
      const json = Boolean(cmd.parent?.opts().json)

      await run(
        { json },
        async () => {
          const client = new NiimbotNodeSerialClient()
          client.setPort(opts.address)

          const started = process.hrtime.bigint()
          await client.connect()
          const handshakeMs = Number(process.hrtime.bigint() - started) / 1e6

          try {
            const result = {
              handshakeMs: Math.round(handshakeMs),
              printerInfo: client.getPrinterInfo(),
              modelMetadata: client.getModelMetadata(),
              detectedPrintTask: client.getPrintTaskType() ?? null,
            }
            emit(
              result,
              { json },
              () =>
                [
                  `handshake:        ${result.handshakeMs} ms`,
                  `model:            ${result.modelMetadata?.model ?? 'unknown'}`,
                  `dpi:              ${result.modelMetadata?.dpi ?? 'unknown'}`,
                  `printhead pixels: ${result.modelMetadata?.printheadPixels ?? 'unknown'}`,
                  `detected task:    ${result.detectedPrintTask ?? 'none (set it manually)'}`,
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
