/**
 * CLI output helpers.
 *
 * Constitution Principle III.B: every command MUST support a human-readable
 * form and a `--json` machine-readable form; results go to stdout and errors
 * go to stderr; exit codes are stable and documented.
 */

import { describeAppError } from '@zenith/server/src/i18n/error-map.ts'
import { negotiateLocale } from '@zenith/server/src/i18n/negotiate.ts'
import type { Locale } from '@zenith/server/src/i18n/types.ts'

/** Stable exit codes. Same class of failure always uses the same code. */
export const ExitCode = {
  Ok: 0,
  /** Invalid arguments or usage. */
  Usage: 2,
  /** Printer could not be reached (powered off, offline, bad address). */
  Unreachable: 3,
  /** Device reachable but rejected the operation. */
  DeviceError: 4,
  /** Local failure: filesystem, rendering, unexpected exception. */
  Internal: 5,
} as const

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode]

export interface OutputOptions {
  json: boolean
}

/** Error payload shape, mirroring the REST contract's three-part structure. */
export interface CliError {
  code: string
  what: string
  why: string
  next: string
}

/**
 * Language for shared error copy.
 *
 * Read from `ZENITH_LANG` so an operator can switch it without a flag on every
 * command. Chinese is the default, as everywhere else.
 */
export function cliLocale(env: NodeJS.ProcessEnv = process.env): Locale {
  return negotiateLocale(env.ZENITH_LANG)
}

/**
 * Copy for an application error code, from the same tables the server uses.
 *
 * Sharing the tables is the point. If the CLI kept its own wording, the same
 * fault would have two descriptions — and the one an operator saw would depend
 * on which tool they happened to reach for.
 */
export function describeError(code: string, env?: NodeJS.ProcessEnv): CliError {
  return describeAppError(code, cliLocale(env))
}

/** Write a successful result to stdout. */
export function emit(data: unknown, options: OutputOptions, humanReadable?: () => string): void {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
    return
  }
  process.stdout.write(`${humanReadable ? humanReadable() : String(data)}\n`)
}

/** Write an error to stderr. Never writes to stdout. */
export function emitError(error: CliError, options: OutputOptions): void {
  if (options.json) {
    process.stderr.write(`${JSON.stringify(error, null, 2)}\n`)
    return
  }
  process.stderr.write(`${error.what}\n  cause: ${error.why}\n  next:  ${error.next}\n`)
}

/**
 * Run an action, translating thrown errors into a stable exit code.
 * Keeps every command's failure handling identical (Principle III.B).
 */
export async function run(
  options: OutputOptions,
  action: () => Promise<void>,
  onError: (err: unknown) => { error: CliError; exitCode: ExitCodeValue },
): Promise<void> {
  try {
    await action()
    process.exitCode = ExitCode.Ok
  } catch (err) {
    const { error, exitCode } = onError(err)
    emitError(error, options)
    process.exitCode = exitCode
  }
}
