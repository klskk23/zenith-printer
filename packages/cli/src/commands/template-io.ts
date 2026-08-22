/**
 * Move designs between machines, or keep a readable archive of them.
 *
 * Over the REST API rather than over the database file. There is then exactly
 * one implementation of what an import decides — which pool a serial comes
 * from, which table a design binds to — and it cannot drift from the one the
 * browser uses. The cost is that the service has to be running; for whole-
 * database disaster recovery, copying the SQLite file is the better tool
 * anyway, and this one is for portability and archiving.
 *
 * Warnings do not make the command fail. "Imported, but the table is not here"
 * is not a failure, and the exit codes classify failures; a script that wants
 * warnings to stop it says so with `--fail-on-warning`.
 */
import { readFileSync } from 'node:fs'
import type { Command } from 'commander'
import { ExitCode, emit, run, type CliError, type ExitCodeValue } from '../output.ts'

interface ImportWarning {
  code: string
  templateName: string
  message: string
}

/**
 * Requested by `--fail-on-warning`.
 *
 * Thrown rather than assigned to `process.exitCode`, because `run` sets the
 * code itself once the action returns — assigning inside it looks like it
 * works and is overwritten a moment later.
 */
class WarningsFailure extends Error {
  readonly count: number

  constructor(count: number) {
    super(`imported with ${count} warning(s)`)
    this.name = 'WarningsFailure'
    this.count = count
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

function classify(err: unknown): { error: CliError; exitCode: ExitCodeValue } {
  if (err instanceof WarningsFailure) {
    return {
      exitCode: ExitCode.DeviceError,
      error: {
        code: 'IMPORTED_WITH_WARNINGS',
        what: `Imported, with ${err.count} thing(s) that did not resolve`,
        why: 'Requested by --fail-on-warning',
        next: 'Review the warnings above, or drop --fail-on-warning to treat them as advice.',
      },
    }
  }
  if (err instanceof HttpFailure) {
    const body = err.body
    return {
      // The server refused for a reason it has already worded; repeating it
      // here in different words would give one fault two descriptions.
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
        : 'Check the file path and try again.',
    },
  }
}

async function call(server: string, path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${server.replace(/\/$/, '')}${path}`, init)
  const body: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new HttpFailure(response.status, body as Record<string, unknown>)
  }
  return body
}

export function registerTemplateIo(program: Command): void {
  program
    .command('template-export')
    .description('write designs to a JSON file (all of them unless --id is given)')
    .option('-s, --server <url>', 'base URL of the Zenith service', 'http://localhost:3000')
    .option('-i, --id <id...>', 'export only these template ids')
    .action(async (opts: { server: string; id?: string[] }, cmd: Command) => {
      const json = Boolean(cmd.parent?.opts().json)
      await run(
        { json },
        async () => {
          const query = opts.id === undefined || opts.id.length === 0 ? '' : `?ids=${opts.id.join(',')}`
          const file = (await call(opts.server, `/api/templates/export${query}`)) as {
            templates: Array<{ name: string }>
          }
          // The file itself on stdout, so it can be redirected to disk. The
          // human form is a summary, because a design is not something to read
          // in a terminal.
          emit(file, { json: true }, () => '')
          if (!json) {
            process.stderr.write(`exported ${file.templates.length} design(s)\n`)
          }
        },
        classify,
      )
    })

  program
    .command('template-import')
    .description('read designs from a JSON file produced by template-export')
    .requiredOption('-f, --file <path>', 'the file to read')
    .option('-s, --server <url>', 'base URL of the Zenith service', 'http://localhost:3000')
    .option(
      '--on-conflict <mode>',
      'what to do about designs already present: overwrite | copy. Without it, a clash stops the import and lists them.',
    )
    .option('--fail-on-warning', 'exit non-zero when anything did not resolve', false)
    .action(
      async (
        opts: { file: string; server: string; onConflict?: string; failOnWarning: boolean },
        cmd: Command,
      ) => {
        const json = Boolean(cmd.parent?.opts().json)
        await run(
          { json },
          async () => {
            let contents: unknown
            try {
              contents = JSON.parse(readFileSync(opts.file, 'utf8'))
            } catch (err) {
              throw new HttpFailure(0, {
                code: 'TEMPLATE_FILE_INVALID',
                what: 'That file could not be read as JSON',
                why: err instanceof Error ? err.message : String(err),
                next: 'Check the path, and that the file came from template-export.',
              })
            }

            const result = (await call(opts.server, '/api/templates/import', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(
                opts.onConflict === undefined
                  ? { file: contents }
                  : { file: contents, onConflict: opts.onConflict },
              ),
            })) as { imported: Array<{ name: string }>; warnings: ImportWarning[] }

            emit(result, { json }, () =>
              [
                `imported ${result.imported.length} design(s)`,
                ...result.warnings.map((w) => `  ! ${w.templateName}: ${w.message}`),
              ].join('\n'),
            )

            if (opts.failOnWarning && result.warnings.length > 0) {
              // Only when asked. By default a warning is not a failure: the
              // designs are in, and the exit codes classify failures.
              throw new WarningsFailure(result.warnings.length)
            }
          },
          classify,
        )
      },
    )
}
