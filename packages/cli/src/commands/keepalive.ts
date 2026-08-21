/**
 * Hold a connection open and report whether the printer stays awake.
 *
 * Companion to hardware verification #1. There are two independent ways the
 * one-hour idle shutdown might be defeated, and they are worth testing in the
 * same session:
 *
 *   1. `set-shutdown --time 4` — ask the device never to sleep.
 *   2. this command — keep talking to it so it never goes idle.
 *
 * niimbluelib already starts a heartbeat automatically on connect (every
 * 1000ms by default) and each beat is a real packet exchange, so an open
 * connection plausibly resets the idle timer. Plausibly is not knowing, and
 * the answer decides whether the queue can keep connections open at all.
 *
 * Run it well past the shutdown window:
 *
 *     npm run cli -- keepalive -a /dev/ttyACM0 --minutes 75
 *
 * A clean finish means the heartbeat held the printer awake. Heartbeat
 * failures partway through mean it slept regardless, and the on-demand
 * connection model stays as it is.
 */
import type { Command } from 'commander'
import { NiimbotNodeSerialClient } from '@mmote/niimbluelib'
import { ExitCode, emit, run, type CliError, type ExitCodeValue } from '../output.ts'

interface Beat {
  atMs: number
  ok: boolean
  detail?: string
}

function classify(err: unknown): { error: CliError; exitCode: ExitCodeValue } {
  const message = err instanceof Error ? err.message : String(err)
  return {
    exitCode: ExitCode.Unreachable,
    error: {
      code: 'PRINTER_UNREACHABLE',
      what: 'Could not hold the connection open',
      why: message,
      next: 'Confirm the printer is on and the address is correct, then re-run.',
    },
  }
}

export function registerKeepalive(program: Command): void {
  program
    .command('keepalive')
    .description('hold a connection open to test whether heartbeats prevent idle shutdown')
    .requiredOption('-a, --address <path>', 'serial device path, e.g. /dev/ttyACM0')
    .option('--minutes <n>', 'how long to hold the connection', '75')
    .option('--interval-ms <n>', 'heartbeat interval', '30000')
    .action(async (opts: { address: string; minutes: string; intervalMs: string }, cmd: Command) => {
      const json = Boolean(cmd.parent?.opts().json)
      const durationMs = Number(opts.minutes) * 60_000
      const intervalMs = Number(opts.intervalMs)

      await run(
        { json },
        async () => {
          const client = new NiimbotNodeSerialClient()
          client.setPort(opts.address)
          client.setHeartbeatInterval(intervalMs)
          await client.connect()

          const startedAt = process.hrtime.bigint()
          const elapsedMs = (): number => Number(process.hrtime.bigint() - startedAt) / 1e6
          const beats: Beat[] = []
          let firstFailureAtMs: number | null = null

          const onBeat = (): void => {
            beats.push({ atMs: Math.round(elapsedMs()), ok: true })
            if (!json) {
              process.stdout.write(
                `[${(elapsedMs() / 60_000).toFixed(1)} min] heartbeat ok (${beats.length} total)\n`,
              )
            }
          }

          const onBeatFailed = (event: { failedAttempts: number }): void => {
            const at = Math.round(elapsedMs())
            beats.push({ atMs: at, ok: false, detail: `attempt ${event.failedAttempts}` })
            // The moment of truth: the printer stopped answering, which is what
            // going to sleep looks like from here.
            firstFailureAtMs ??= at
            if (!json) {
              process.stdout.write(
                `[${(at / 60_000).toFixed(1)} min] HEARTBEAT FAILED (attempt ${event.failedAttempts})\n`,
              )
            }
          }

          client.on('heartbeat', onBeat)
          client.on('heartbeatfailed', onBeatFailed)

          try {
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, durationMs)
              // Stop early once the answer is in; waiting out the remaining
              // hour proves nothing further.
              const poll = setInterval(() => {
                if (firstFailureAtMs !== null) {
                  clearTimeout(timer)
                  clearInterval(poll)
                  resolve()
                }
              }, 1000)
              timer.unref?.()
            })

            const survivedMs = Math.round(elapsedMs())
            const result = {
              address: opts.address,
              intervalMs,
              requestedMinutes: Number(opts.minutes),
              survivedMinutes: Number((survivedMs / 60_000).toFixed(1)),
              heartbeats: beats.filter((b) => b.ok).length,
              failures: beats.filter((b) => !b.ok).length,
              firstFailureAtMinutes:
                firstFailureAtMs === null ? null : Number((firstFailureAtMs / 60_000).toFixed(1)),
              keptAwake: firstFailureAtMs === null,
            }

            emit(result, { json }, () =>
              [
                `address:        ${result.address}`,
                `interval:       ${result.intervalMs} ms`,
                `held for:       ${result.survivedMinutes} min`,
                `heartbeats:     ${result.heartbeats} ok, ${result.failures} failed`,
                `kept awake:     ${result.keptAwake ? 'yes' : 'no'}`,
                result.keptAwake
                  ? 'The heartbeat held the printer awake for the whole window.'
                  : `The printer stopped answering after ${result.firstFailureAtMinutes} min.`,
              ].join('\n'),
            )
          } finally {
            client.off('heartbeat', onBeat)
            client.off('heartbeatfailed', onBeatFailed)
            await client.disconnect()
          }
        },
        classify,
      )
    })
}
