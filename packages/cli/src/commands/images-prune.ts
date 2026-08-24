/**
 * Sweep uploaded images nothing points at any more.
 *
 * Pasting a picture into a design uploads it there and then, so every discarded
 * paste, abandoned draft and deleted template leaves a row behind — carrying the
 * picture with it, since the bytes moved into the rows. Nothing in the interface
 * ever mentions them, which is exactly why they accumulate, and why this belongs
 * in cron rather than in a page somebody has to remember to visit.
 *
 * Over REST rather than the database file, like `data-source-refresh`. What
 * counts as "still in use" is then decided in one place and cannot drift from
 * what the running service believes.
 *
 * **Reports by default.** Deleting files is not undoable and there is no
 * recycle bin, so removing them takes `--delete` in so many words.
 */
import type { Command } from 'commander'
import { ExitCode, emit, run, type CliError, type ExitCodeValue } from '../output.ts'

interface PruneResult {
  outcome: 'planned' | 'removed'
  removed: number
  candidates: Array<{ id: string; sizeBytes: number }>
  keptReferenced: number
  keptTooNew: number
  bytesFreed: number
  minAgeHours: number
}

class HttpFailure extends Error {
  readonly body: Record<string, unknown>
  readonly status: number

  constructor(status: number, body: Record<string, unknown>) {
    super(`server returned ${status}`)
    this.name = 'HttpFailure'
    this.status = status
    this.body = body
  }
}

function classify(err: unknown): { error: CliError; exitCode: ExitCodeValue } {
  if (err instanceof HttpFailure) {
    const body = err.body
    return {
      // Worded by the server already; saying it differently here would give one
      // fault two descriptions.
      exitCode: ExitCode.DeviceError,
      error: {
        code: String(body.code ?? 'REQUEST_FAILED'),
        what: String(body.what ?? `The server returned ${err.status}`),
        why: String(body.why ?? ''),
        next: String(body.next ?? ''),
      },
    }
  }
  const message = err instanceof Error ? err.message : String(err)
  const unreachable = /ECONNREFUSED|ENOTFOUND|fetch failed/i.test(message)
  return {
    exitCode: unreachable ? ExitCode.Unreachable : ExitCode.Internal,
    error: {
      code: unreachable ? 'SERVER_UNREACHABLE' : 'INTERNAL_ERROR',
      what: unreachable ? 'Could not reach the Zenith server' : 'The command failed',
      why: message,
      next: unreachable
        ? 'Start the service, or point --server at the machine running it.'
        : 'Check the arguments and try again.',
    },
  }
}

function summarise(result: PruneResult): string {
  const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`
  const verb = result.outcome === 'removed' ? 'removed' : 'would remove'
  return [
    `${verb} ${result.candidates.length} image(s), ${mb(result.bytesFreed)}`,
    `kept ${result.keptReferenced} still in use, ${result.keptTooNew} newer than ${result.minAgeHours}h`,
    result.outcome === 'planned' ? 'nothing was deleted; pass --delete to do it' : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function registerImagesPrune(program: Command): void {
  program
    .command('images-prune')
    .description('remove uploaded images no design points at any more')
    .option('-s, --server <url>', 'base URL of the Zenith service', 'http://localhost:3000')
    .option(
      '--delete',
      'actually remove them. Without it the command only reports what it would take.',
      false,
    )
    .option(
      '--min-age-hours <n>',
      'how old an unreferenced image must be. A pasted picture is uploaded before the design is saved, so a short window deletes work somebody has open.',
      '24',
    )
    .action(async (opts: { server: string; delete: boolean; minAgeHours: string }, cmd: Command) => {
      const json = Boolean(cmd.parent?.opts().json)
      await run(
        { json },
        async () => {
          const minAgeHours = Number(opts.minAgeHours)
          if (!Number.isFinite(minAgeHours) || minAgeHours < 0) {
            throw new HttpFailure(0, {
              code: 'VALIDATION_FAILED',
              what: `--min-age-hours must be a non-negative number, not "${opts.minAgeHours}"`,
              why: 'It decides how long an unreferenced image is protected',
              next: 'Pass a number of hours, for example --min-age-hours 24.',
            })
          }

          const base = opts.server.replace(/\/$/, '')
          const response = await fetch(`${base}/api/images/prune`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ confirm: opts.delete, minAgeHours }),
          })
          const body: unknown = await response.json().catch(() => ({}))
          if (!response.ok) {
            throw new HttpFailure(response.status, body as Record<string, unknown>)
          }

          const result = body as PruneResult
          emit(result, { json }, () => summarise(result))
        },
        classify,
      )
    })
}
