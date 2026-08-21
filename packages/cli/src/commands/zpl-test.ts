/**
 * Send a ZPL test label to a Honeywell printer over raw TCP 9100.
 *
 * Covers hardware verifications #3, #4 and #5 in one pass:
 *
 *   #3 does a whole-label `^GF` land in the right place under ZSim?
 *   #4 does ZSim accept the `:Z64:` compressed form, or only plain hex?
 *   #5 how large a single label will the receive buffer take?
 *
 * ZSim emulates ZPL II rather than implementing it, so none of these can be
 * answered from documentation. Run `--encoding hex` and `--encoding z64` and
 * compare: if only the first produces a label, #4 is settled and the driver
 * must fall back to hex, at roughly ten times the transfer size.
 *
 * Consumes stock, so it refuses without --confirm.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Command } from 'commander'
import { renderLabel } from '@zenith/server/src/render/pipeline.ts'
import { loadFontConfig } from '@zenith/server/src/render/fonts.ts'
import { encodeMonochromePng } from '@zenith/server/src/render/png.ts'
import { countSetDots } from '@zenith/server/src/render/binarize.ts'
import { TcpTransport } from '@zenith/server/src/drivers/tcp-transport.ts'
import { ZplDriver } from '@zenith/server/src/drivers/zpl/zpl-driver.ts'
import { buildLabel } from '@zenith/server/src/drivers/zpl/zpl-builder.ts'
import { splitAddress } from '@zenith/server/src/drivers/factory.ts'
import { sampleLabel } from '../fixtures/sample-label.ts'
import { ExitCode, emit, run, type CliError, type ExitCodeValue } from '../output.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')

function classify(err: unknown): { error: CliError; exitCode: ExitCodeValue } {
  const message = err instanceof Error ? err.message : String(err)
  const unreachable = /ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT|unreachable|timed out/i.test(message)
  return {
    exitCode: unreachable ? ExitCode.Unreachable : ExitCode.DeviceError,
    error: {
      code: unreachable ? 'PRINTER_UNREACHABLE' : 'DEVICE_ERROR',
      what: unreachable ? 'Could not reach the printer' : 'The printer refused the label',
      why: message,
      next: unreachable
        ? 'Check the IP and that port 9100 is open; confirm the printer is on the same network.'
        : 'Confirm the command language is set to ZSim, then retry.',
    },
  }
}

export function registerZplTest(program: Command): void {
  program
    .command('zpl-test')
    .description('send a ZPL test label over TCP 9100 (hardware verifications #3, #4, #5) — CONSUMES STOCK')
    .requiredOption('-a, --address <host:port>', 'printer address, e.g. 192.168.1.50:9100')
    .option('--encoding <hex|z64>', 'graphic encoding under test', 'z64')
    .option('--width-mm <n>', 'label width; PC310T images up to about 104mm', '50')
    .option('--height-mm <n>', 'label height', '30')
    .option('--stroke-dots <n>', 'rule width in dots', '1')
    .option('--dry', 'build the ZPL and report its size without sending', false)
    .option('--save <path>', 'also write the bitmap as PNG for comparison')
    .option('--confirm', 'required unless --dry: this prints a physical label', false)
    .action(
      async (
        opts: {
          address: string
          encoding: string
          widthMm: string
          heightMm: string
          strokeDots: string
          dry: boolean
          save?: string
          confirm: boolean
        },
        cmd: Command,
      ) => {
        const json = Boolean(cmd.parent?.opts().json)
        const encoding = opts.encoding === 'hex' ? 'hex' : 'z64'

        if (!opts.dry && !opts.confirm) {
          await run(
            { json },
            async () => {
              throw new Error('refusing to print without --confirm')
            },
            () => ({
              exitCode: ExitCode.Usage,
              error: {
                code: 'CONFIRMATION_REQUIRED',
                what: 'This command prints a physical label',
                why: 'Printing consumes stock and cannot be undone',
                next: 'Use --dry to inspect the payload size, or --confirm to actually print.',
              },
            }),
          )
          return
        }

        await run(
          { json },
          async () => {
            const fonts = loadFontConfig(join(repoRoot, 'fonts'))
            const ir = sampleLabel(203, Number(opts.strokeDots))
            ir.widthMm = Number(opts.widthMm)
            ir.heightMm = Number(opts.heightMm)

            const rendered = renderLabel({ ir, fonts })
            if (opts.save !== undefined) {
              writeFileSync(opts.save, encodeMonochromePng(rendered.bitmap))
            }

            const zpl = buildLabel(rendered.bitmap, { encoding })
            const hexSize = buildLabel(rendered.bitmap, { encoding: 'hex' }).length

            const summary = {
              address: opts.address,
              encoding,
              sizeDots: `${rendered.bitmap.widthDots}x${rendered.bitmap.heightDots}`,
              dotsSet: countSetDots(rendered.bitmap),
              payloadBytes: zpl.length,
              hexPayloadBytes: hexSize,
              // Verification #5 turns on this number: whatever the buffer will
              // take, this is what one label costs.
              compressionRatio: Number((hexSize / zpl.length).toFixed(1)),
              sent: false as boolean,
              savedTo: opts.save ?? null,
            }

            if (!opts.dry) {
              const [host, port] = splitAddress(opts.address)
              const transport = new TcpTransport({ host, ...(port === undefined ? {} : { port }) })
              const driver = new ZplDriver({ transport, address: opts.address, encoding })

              await driver.connect()
              try {
                await driver.printPages(
                  [rendered.bitmap],
                  { density: 3, labelType: 1, printDirection: 'top' },
                  () => {},
                )
                summary.sent = true
              } finally {
                // Constitution ("Resource safety"): release on every path.
                await driver.disconnect()
              }
            }

            emit(summary, { json }, () =>
              [
                `address:      ${summary.address}`,
                `encoding:     ${summary.encoding}`,
                `size:         ${summary.sizeDots} dots`,
                `payload:      ${summary.payloadBytes} bytes (hex would be ${summary.hexPayloadBytes})`,
                `compression:  ${summary.compressionRatio}x`,
                `sent:         ${summary.sent ? 'yes' : 'no (dry run)'}`,
                '',
                summary.sent
                  ? 'Check the label: did the image print, and is it positioned correctly?'
                  : 'Re-run with --confirm to actually print.',
                'If z64 produces nothing but hex works, ZSim does not accept the compressed form.',
              ].join('\n'),
            )
          },
          classify,
        )
      },
    )
}
