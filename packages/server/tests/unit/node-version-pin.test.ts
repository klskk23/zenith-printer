/**
 * The deployment image pins Node, and this keeps it pinned.
 *
 * Node 26.4.0 broke the serial read path this service depends on. The printer
 * answers, but the stream never emits `readable` inside niimbluelib's
 * one-second packet timeout, so every probe fails with "Timeout waiting
 * response" and a healthy label printer looks dead.
 *
 * Measured on a NIIMBOT B3S_P at /dev/ttyACM0 — same host, same device, same
 * node_modules, only the interpreter changed:
 *
 *   26.0.0  handshake 118ms, model B3S_P      26.4.0  timeout, model unknown
 *   26.1.0  ok                                26.7.0  timeout
 *   26.2.0  ok
 *   26.3.1  ok
 *
 * Checked by reading the Dockerfile because no test can reach a serial port:
 * the default suite must pass with no printer attached (constitution Principle
 * II), so a green suite says nothing at all about this. The only thing that
 * can be asserted here is that nobody quietly restored a floating tag.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const DOCKERFILE = new URL('../../../../deploy/Dockerfile', import.meta.url).pathname

/** The first Node minor whose serial reads stall. */
const FIRST_BROKEN = { major: 26, minor: 4 }

function baseImages(): string[] {
  return readFileSync(DOCKERFILE, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('FROM '))
    .map((line) => line.slice('FROM '.length).split(' ')[0]!)
}

function parse(image: string): { major: number; minor: number } | null {
  const match = /^node:(\d+)\.(\d+)/.exec(image)
  return match === null ? null : { major: Number(match[1]), minor: Number(match[2]) }
}

describe('the deployment image pins Node', () => {
  const images = baseImages()

  it('has base images to check, so an empty pass cannot look like a passing one', () => {
    expect(images.length).toBeGreaterThan(0)
  })

  it.each(images)('pins %s to a minor, not a floating major', (image) => {
    expect(
      parse(image),
      `"${image}" tracks whatever the latest 26.x happens to be. That is how a rebuild ` +
        `silently picks up the version whose serial reads stall, and the failure that ` +
        `reaches somebody is "the printer refused the operation".`,
    ).not.toBeNull()
  })

  it.each(images)('pins %s below the version that breaks serial reads', (image) => {
    const version = parse(image)
    if (version === null) {
      // Unparseable is already a failure above; reporting it twice, and as a
      // TypeError, buries the message that explains what to do.
      return
    }
    const broken =
      version.major > FIRST_BROKEN.major ||
      (version.major === FIRST_BROKEN.major && version.minor >= FIRST_BROKEN.minor)

    expect(
      broken,
      `"${image}" is at or past ${FIRST_BROKEN.major}.${FIRST_BROKEN.minor}, where the ` +
        `printer's replies stop reaching the stream in time. If a newer Node has fixed ` +
        `it, do not just raise this number: plug in a printer, run ` +
        `\`zenith probe --address /dev/ttyACM0\` on that version, and record the result ` +
        `here. A green suite proves nothing — nothing in it opens a serial port.`,
    ).toBe(false)
  })

  it('uses the same version in every stage', () => {
    // A builder on one version and a runtime on another is a difference nobody
    // reads the Dockerfile carefully enough to notice.
    expect(new Set(images).size).toBe(1)
  })
})
