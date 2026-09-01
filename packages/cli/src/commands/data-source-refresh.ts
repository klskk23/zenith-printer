/**
 * Fetch a linked table again, from a script.
 *
 * Refreshing on a schedule was refused for years, and the reason was sound: a
 * table that changes while somebody is looking at a list of rows renumbers
 * under them, and the numbers were how a row selection was expressed.
 *
 * That reason no longer holds for a source with a key column — a row's identity
 * survives the refresh, so a selection made against it does too — and such a
 * source may now carry `refreshIntervalSeconds`. It stays off by default, and
 * for a table without a key column it is still refused.
 *
 * This command is unaffected either way: it is the manual answer, and putting
 * it in cron remains the right thing for a table that has no key column and a
 * deployment that knows when the data changes.
 *
 * Over REST rather than the database file, like `template-import`. There is
 * then one implementation of what a refresh decides — which columns are
 * breaking, what happens when the sheet outgrew the limit — and it cannot drift
 * from the one the browser uses.
 *
 * A warning is not a failure. "Refreshed, but a column disappeared" is a
 * conclusion the caller may care about; the exit codes classify failures, so
 * saying otherwise would make a successful refresh stop a `set -e` script.
 */
import type { Command } from 'commander'
import { ExitCode, emit, run, type CliError, type ExitCodeValue } from '../output.ts'

interface RefreshResult {
  outcome: 'applied' | 'needsConfirmation' | 'refusedTooManyRows' | 'failed'
  rowsBefore?: number
  rowsAfter?: number
  columnsAdded?: string[]
  removedColumns?: string[]
  affectedTemplates?: Array<{ id: string; name: string }>
  rowCount?: number
  limit?: number
  reason?: string
}

/** A conclusion the caller has to act on. Not a transport failure. */
class RefreshRefused extends Error {
  readonly result: RefreshResult

  constructor(result: RefreshResult) {
    super(`refresh ${result.outcome}`)
    this.name = 'RefreshRefused'
    this.result = result
  }
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

function describe(result: RefreshResult): CliError {
  if (result.outcome === 'needsConfirmation') {
    return {
      code: 'COLUMN_CHANGE_NEEDS_CONFIRMATION',
      what: `Columns disappeared from the sheet: ${(result.removedColumns ?? []).join(', ')}`,
      why: `Designs referencing them would resolve to nothing${
        (result.affectedTemplates ?? []).length > 0
          ? `: ${(result.affectedTemplates ?? []).map((t) => t.name).join(', ')}`
          : ''
      }`,
      // Not decided here: unattended is exactly where a silent breaking change
      // does the most damage.
      next: 'Re-run with --confirm-column-change to apply it anyway.',
    }
  }
  if (result.outcome === 'refusedTooManyRows') {
    return {
      code: 'TOO_MANY_ROWS',
      what: `The sheet has ${result.rowCount} rows, over the limit of ${result.limit}`,
      why: 'Keeping the first rows would print labels for some of them and leave nobody aware the rest existed',
      next: 'Reduce the sheet, or split it across several data sources.',
    }
  }
  return {
    code: 'REFRESH_FAILED',
    what: 'Nothing new was fetched',
    why: String(result.reason ?? 'unknown'),
    next: 'The existing rows are untouched and can still be printed. Check the sheet and try again.',
  }
}

function classify(err: unknown): { error: CliError; exitCode: ExitCodeValue } {
  if (err instanceof RefreshRefused) {
    return { exitCode: ExitCode.DeviceError, error: describe(err.result) }
  }
  if (err instanceof HttpFailure) {
    const body = err.body
    return {
      // Worded by the server already; repeating it differently here would give
      // one fault two descriptions.
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

export function registerDataSourceRefresh(program: Command): void {
  program
    .command('data-source-refresh')
    .description('fetch a linked Google Sheet again')
    .requiredOption('-i, --id <id>', 'the data source to refresh')
    .option('-s, --server <url>', 'base URL of the Zenith service', 'http://localhost:3000')
    .option(
      '--confirm-column-change',
      'apply the refresh even though columns disappeared. Without it, such a refresh stops and reports which designs it would break.',
      false,
    )
    .action(
      async (
        opts: { id: string; server: string; confirmColumnChange: boolean },
        cmd: Command,
      ) => {
        const json = Boolean(cmd.parent?.opts().json)
        await run(
          { json },
          async () => {
            const base = opts.server.replace(/\/$/, '')
            const response = await fetch(`${base}/api/data-sources/${opts.id}/refresh`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(
                opts.confirmColumnChange ? { confirmColumnChange: true } : {},
              ),
            })
            const body: unknown = await response.json().catch(() => ({}))
            if (!response.ok) {
              throw new HttpFailure(response.status, body as Record<string, unknown>)
            }

            const result = body as RefreshResult
            emit(result, { json }, () =>
              result.outcome === 'applied'
                ? `refreshed: ${result.rowsBefore} rows to ${result.rowsAfter}${
                    (result.columnsAdded ?? []).length > 0
                      ? ` (new columns: ${(result.columnsAdded ?? []).join(', ')})`
                      : ''
                  }`
                : `not applied: ${result.outcome}`,
            )

            if (result.outcome !== 'applied') {
              throw new RefreshRefused(result)
            }
          },
          classify,
        )
      },
    )
}
