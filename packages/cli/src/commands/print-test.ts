/**
 * Print a test label on a real printer.
 *
 * `render-test` only writes a PNG — it never touches a device, which is what
 * makes it safe but also means it cannot settle hardware verification #7. That
 * question is whether a one-dot rule survives on paper, and only paper can
 * answer it.
 *
 * This consumes stock and cannot be undone, so it refuses to run without
 * `--confirm`. That is the same rule the web UI follows (FR-017), and it
 * exists because a command that quietly burns labels is a command that will
 * eventually burn them by accident.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Command } from 'commander'
import {
  ImageEncoder,
  LabelType,
  NiimbotNodeSerialClient,
  type PrintTaskName,
} from '@mmote/niimbluelib'
import { renderLabel } from '@zenith/server/src/render/pipeline.ts'
import { loadFontConfig } from '@zenith/server/src/render/fonts.ts'
import { countSetDots, isDotSet } from '@zenith/server/src/render/binarize.ts'
import { BitmapImageSource } from '@zenith/server/src/drivers/niimbot/bitmap-source.ts'
import { encodeMonochromePng } from '@zenith/server/src/render/png.ts'
import {
  defaultProbeContent,
  probeLabel,
  sampleLabel,
  type ProbeElement,
} from '../fixtures/sample-label.ts'
import { ExitCode, describeError, emit, run, type CliError, type ExitCodeValue } from '../output.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')

function classify(err: unknown): { error: CliError; exitCode: ExitCodeValue } {
  const message = err instanceof Error ? err.message : String(err)
  const unreachable = /ENOENT|EACCES|cannot open|handshake/i.test(message)
  return {
    exitCode: unreachable ? ExitCode.Unreachable : ExitCode.DeviceError,
    error: {
      code: unreachable ? 'PRINTER_UNREACHABLE' : 'DEVICE_ERROR',
      what: unreachable ? 'Could not reach the printer' : 'The printer refused the job',
      why: message,
      next: unreachable
        ? 'Check the printer is powered on and the address is correct.'
        : 'Check paper and lid, then retry.',
    },
  }
}

const PROBE_ELEMENTS: ProbeElement[] = ['qrcode', 'barcode', 'ellipse', 'multiline']

function assertProbeElement(value: string): ProbeElement {
  if ((PROBE_ELEMENTS as string[]).includes(value)) {
    return value as ProbeElement
  }
  throw new Error(`unknown element "${value}"; expected one of ${PROBE_ELEMENTS.join(', ')}`)
}

export function registerPrintTest(program: Command): void {
  program
    .command('print-test')
    .description('print a test label on a real printer (hardware verification #7) — CONSUMES STOCK')
    .requiredOption('-a, --address <path>', 'serial device path, e.g. /dev/ttyACM0')
    .requiredOption('-p, --print-task <name>', 'print task; B3S_P uses B1')
    .option('--stroke-dots <n>', 'rule width in dots, the value under test', '1')
    .option(
      '--element <kind>',
      'print a single element instead of the full sample: qrcode | barcode | ellipse | multiline',
    )
    .option('--module-width <n>', 'barcode/QR module width in dots, minimum 2', '2')
    .option('--content <text>', 'content for the probed element')
    .option('--threshold <n>', 'binarisation cut-off, 1-255', '128')
    .option('--density <n>', 'print density', '3')
    .option('--dpi <n>', 'target resolution', '203')
    .option('--save <path>', 'also write the bitmap as PNG for comparison')
    .option('--confirm', 'required: this prints a physical label and cannot be undone', false)
    .action(
      async (
        opts: {
          address: string
          printTask: string
          strokeDots: string
          threshold: string
          density: string
          dpi: string
          save?: string
          confirm: boolean
          element?: string
          moduleWidth: string
          content?: string
        },
        cmd: Command,
      ) => {
        const json = Boolean(cmd.parent?.opts().json)

        if (!opts.confirm) {
          // Refusing by default is the whole point; a label burned by accident
          // is exactly what this guard is for.
          await run(
            { json },
            async () => {
              throw new Error('refusing to print without --confirm')
            },
            // Same table the server uses, so this fault reads identically
            // whichever tool the operator reached for.
            () => ({ exitCode: ExitCode.Usage, error: describeError('CONFIRMATION_REQUIRED') }),
          )
          return
        }

        await run(
          { json },
          async () => {
            const dpi = Number(opts.dpi)
            const strokeWidthDots = Number(opts.strokeDots)
            const fonts = loadFontConfig(join(repoRoot, 'fonts'))

            const element = opts.element === undefined ? undefined : assertProbeElement(opts.element)
            const ir =
              element === undefined
                ? sampleLabel(dpi, strokeWidthDots)
                : probeLabel(element, dpi, Number(opts.moduleWidth), opts.content ?? defaultProbeContent(element))

            const result = renderLabel({ ir, fonts, threshold: Number(opts.threshold) })

            if (opts.save !== undefined) {
              writeFileSync(
                opts.save,
                encodeMonochromePng(result.bitmap),
              )
            }

            const client = new NiimbotNodeSerialClient()
            client.setPort(opts.address)
            await client.connect()

            // A resolved connect() proves nothing on this client; the handshake
            // fields do. See niimbot-driver.ts for the measurements.
            if (client.getModelMetadata() === undefined && client.getPrinterInfo()?.modelId === undefined) {
              await client.disconnect()
              throw new Error('connected but the device never completed its handshake')
            }

            try {
              const encoded = ImageEncoder.encode(new BitmapImageSource(result.bitmap), 'top')
              const task = client.abstraction.newPrintTask(opts.printTask as PrintTaskName, {
                density: Number(opts.density),
                labelType: LabelType.WithGaps,
                totalPages: 1,
              })

              try {
                await task.printInit()
                await task.printPage(encoded, 1)
                await task.waitForPageFinished()
                await task.waitForFinished()
              } finally {
                await task.printEnd().catch(() => undefined)
              }

              const summary = {
                printed: true,
                element: opts.element ?? 'sample',
                moduleWidthDots: element === undefined ? null : Number(opts.moduleWidth),
                strokeWidthDots,
                threshold: Number(opts.threshold),
                density: Number(opts.density),
                sizeDots: `${result.bitmap.widthDots}x${result.bitmap.heightDots}`,
                dotsSet: countSetDots(result.bitmap),
                ruleVisibleInBitmap: ruleRowIsSet(result),
                savedTo: opts.save ?? null,
              }

              emit(summary, { json }, () =>
                [
                  `printed:        yes`,
                  `element:        ${summary.element}`,
                  ...(summary.moduleWidthDots === null
                    ? []
                    : [`module width:  ${summary.moduleWidthDots} dot(s)`]),
                  `size:           ${summary.sizeDots} dots`,
                  `rule width:     ${summary.strokeWidthDots} dot(s)`,
                  `threshold:      ${summary.threshold}`,
                  `dots set:       ${summary.dotsSet}`,
                  '',
                  ...(summary.element === 'qrcode'
                    ? [
                        'Now scan the label with a real scanner or a phone.',
                        'If it does not read, this module width is below the usable floor.',
                      ]
                    : [
                        'Now look at the label: is the horizontal rule clearly visible?',
                        'If it is faint or missing, re-run with a higher --threshold.',
                      ]),
                ].join('\n'),
              )
            } finally {
              // Constitution ("Resource safety"): release on every path.
              await client.disconnect()
            }
          },
          classify,
        )
      },
    )
}

/** Whether the test rule produced a continuous run of dots in the bitmap. */
function ruleRowIsSet(result: { bitmap: Parameters<typeof isDotSet>[0] }): boolean {
  const { bitmap } = result
  for (let y = 0; y < bitmap.heightDots; y += 1) {
    let run = 0
    for (let x = 0; x < bitmap.widthDots; x += 1) {
      run = isDotSet(bitmap, x, y) ? run + 1 : 0
      if (run > bitmap.widthDots * 0.7) {
        return true
      }
    }
  }
  return false
}
