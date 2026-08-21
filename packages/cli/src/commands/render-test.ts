/**
 * Render a test label to PNG without touching a printer.
 *
 * Supports hardware verification #7 (research.md): print the output and check
 * that a one-dot rule is actually visible, then tune the binarisation threshold
 * from what the paper shows.
 */
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Command } from 'commander'
import { renderLabel } from '@zenith/server/src/render/pipeline.ts'
import { loadFontConfig } from '@zenith/server/src/render/fonts.ts'
import {
  defaultProbeContent,
  probeLabel,
  sampleLabel,
  type ProbeElement,
} from '../fixtures/sample-label.ts'
import { countSetDots, isDotSet } from '@zenith/server/src/render/binarize.ts'
import { ExitCode, emit, run, type CliError, type ExitCodeValue } from '../output.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')

function classify(err: unknown): { error: CliError; exitCode: ExitCodeValue } {
  const message = err instanceof Error ? err.message : String(err)

  // A bad flag value is the user's to fix; telling them to install fonts sends
  // them somewhere unrelated, which is worse than saying nothing.
  const isBadInput = /module width|module narrower|unknown element|scanning floor/i.test(message)
  if (isBadInput) {
    return {
      exitCode: ExitCode.Usage,
      error: {
        code: 'VALIDATION_FAILED',
        what: 'The options given are not valid',
        why: message,
        next: 'Correct the flagged option and run the command again.',
      },
    }
  }

  return {
    exitCode: ExitCode.Internal,
    error: {
      code: 'RENDER_FAILED',
      what: 'Could not render the test label',
      why: message,
      next: 'Check the bundled fonts are present: npm run fetch-fonts',
    },
  }
}

/** Minimal 1-bit PNG writer, so the CLI needs no image dependency. */
function encodePng(width: number, height: number, get: (x: number, y: number) => boolean): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  let p = 0
  for (let y = 0; y < height; y += 1) {
    raw[p] = 0
    p += 1
    for (let x = 0; x < width; x += 1) {
      const v = get(x, y) ? 0 : 255
      raw[p] = v
      raw[p + 1] = v
      raw[p + 2] = v
      p += 3
    }
  }

  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crcTable: number[] = []
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
    let crc = 0xffffffff
    for (const byte of body) crc = (crcTable[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8)
    const crcBuf = Buffer.alloc(4)
    crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([len, body, crcBuf])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const PROBE_ELEMENTS: ProbeElement[] = ['qrcode', 'barcode', 'ellipse', 'multiline']

function assertProbeElement(value: string): ProbeElement {
  if ((PROBE_ELEMENTS as string[]).includes(value)) {
    return value as ProbeElement
  }
  throw new Error(`unknown element "${value}"; expected one of ${PROBE_ELEMENTS.join(', ')}`)
}

export function registerRenderTest(program: Command): void {
  program
    .command('render-test')
    .description('render a test label to PNG without a printer (hardware verification #7)')
    .option('-o, --out <path>', 'output PNG path', 'render-test.png')
    .option('--dpi <n>', 'target resolution', '203')
    .option('--stroke-dots <n>', 'rule width in dots', '1')
    .option('--threshold <n>', 'binarisation cut-off, 1-255', '128')
    .option(
      '--element <kind>',
      'render a single element instead of the full sample: qrcode | barcode | ellipse | multiline',
    )
    .option('--module-width <n>', 'barcode/QR module width in dots, minimum 2', '2')
    .option('--content <text>', 'content for the probed element')
    .action(
      async (
        opts: {
          out: string
          dpi: string
          strokeDots: string
          threshold: string
          element?: string
          moduleWidth: string
          content?: string
        },
        cmd: Command,
      ) => {
        const json = Boolean(cmd.parent?.opts().json)

        await run(
          { json },
          async () => {
            const dpi = Number(opts.dpi)
            const strokeWidthDots = Number(opts.strokeDots)
            const fonts = loadFontConfig(join(repoRoot, 'fonts'))

            const ir =
              opts.element === undefined
                ? sampleLabel(dpi, strokeWidthDots)
                : probeLabel(
                    assertProbeElement(opts.element),
                    dpi,
                    Number(opts.moduleWidth),
                    opts.content ?? defaultProbeContent(assertProbeElement(opts.element)),
                  )

            const result = renderLabel({ ir, fonts, threshold: Number(opts.threshold) })
            writeFileSync(
              opts.out,
              encodePng(result.bitmap.widthDots, result.bitmap.heightDots, (x, y) =>
                isDotSet(result.bitmap, x, y),
              ),
            )

            const summary = {
              out: opts.out,
              element: opts.element ?? 'sample',
              widthDots: result.bitmap.widthDots,
              heightDots: result.bitmap.heightDots,
              dotsSet: countSetDots(result.bitmap),
              strokeWidthDots,
              threshold: Number(opts.threshold),
              hasClipping: result.hasClipping,
            }
            emit(
              summary,
              { json },
              () =>
                [
                  `wrote:      ${summary.out}`,
                  `element:    ${summary.element}`,
                  `size:       ${summary.widthDots} x ${summary.heightDots} dots`,
                  `dots set:   ${summary.dotsSet}`,
                  `rule width: ${summary.strokeWidthDots} dot(s)`,
                  `threshold:  ${summary.threshold}`,
                ].join('\n'),
            )
          },
          classify,
        )
      },
    )
}
