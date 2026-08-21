#!/usr/bin/env node
/**
 * Zenith Printer operations CLI.
 *
 * Constitution Principle III.B (CLI is the auxiliary delivery form):
 *   - kebab-case flags, mapping predictably onto the REST camelCase fields
 *   - both a human-readable form and `--json`
 *   - results on stdout, errors on stderr
 *   - stable, documented exit codes (see ./output.ts)
 *
 * Its first reason to exist is the hardware verification list in research.md:
 * `setAutoShutDownTime` is not exposed by the upstream niimblue CLI, so the
 * most consequential open assumption can only be settled from here.
 */
import { Command } from 'commander'
import { registerSetShutdown } from './commands/set-shutdown.ts'
import { registerProbe } from './commands/probe.ts'
import { registerRfid } from './commands/rfid.ts'
import { registerRenderTest } from './commands/render-test.ts'
import { registerKeepalive } from './commands/keepalive.ts'
import { registerPrintTest } from './commands/print-test.ts'
import { registerZplTest } from './commands/zpl-test.ts'

const program = new Command()

program
  .name('zenith')
  .description('Zenith Printer operations and hardware verification CLI')
  .version('0.1.0')
  .option('--json', 'emit machine-readable JSON instead of human-readable text', false)

registerProbe(program)
registerSetShutdown(program)
registerRfid(program)
registerRenderTest(program)
registerKeepalive(program)
registerPrintTest(program)
registerZplTest(program)

await program.parseAsync(process.argv)
