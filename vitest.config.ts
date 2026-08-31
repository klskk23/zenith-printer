import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = dirname(fileURLToPath(import.meta.url))

const HARDWARE_GLOB = '**/*.hardware.test.ts'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'default',
          include: ['packages/*/tests/**/*.test.ts'],
          // Constitution Principle II: the default suite MUST pass with no
          // physical printer attached. Hardware tests are opt-in only.
          exclude: ['**/node_modules/**', HARDWARE_GLOB],
        },
      },
      {
        // Resolve the way the browser build does, not the way Node does.
        //
        // Packages can ship different entry points per condition, and picking
        // the Node one in a DOM test means the suite exercises code the
        // browser will never load. swagger-ui-react is the case in point: its
        // browser entry expects the host application's React, while its Node
        // entry bundles a copy of its own — rendering that one under React 19
        // fails with "a React Element from an older version of React", a fault
        // that exists only in the test.
        resolve: {
          conditions: ['browser', 'import', 'module', 'default'],
          // The same `@` alias vite.config.ts and tsconfig give the app. A
          // component added by `shadcn add` imports that way, and without this
          // it would build and typecheck and then fail only under test.
          alias: { '@': resolve(here, 'packages/web/src') },
        },
        test: {
          name: 'web',
          // Components need a DOM. Kept as its own project so the logic suite
          // stays a plain Node run — and so that "does the page render at all"
          // is actually asked, which nothing did until a blank screen shipped.
          include: ['packages/web/tests/**/*.dom.test.tsx'],
          environment: 'happy-dom',
          server: {
            // Dependencies are externalised by default, which means Node
            // resolves them and Vite's conditions above never apply. Inlining
            // this one puts it back through Vite, so the test loads the same
            // React-less bundle the browser will.
            deps: { inline: ['swagger-ui-react'] },
          },
        },
      },
      {
        test: {
          name: 'hardware',
          include: [HARDWARE_GLOB],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Constitution: core logic line coverage MUST be >= 80%.
      // Core logic only. UI, wiring and the ops CLI are out of scope for the
      // 80% gate; these are the paths where a defect prints wrong labels.
      include: [
        'packages/server/src/render/**/*.ts',
        'packages/server/src/drivers/**/*.ts',
        'packages/server/src/queue/**/*.ts',
        'packages/server/src/domain/**/*.ts',
        'packages/shared/src/**/*.ts',
        // Frontend *logic*, not components. These decide where an element
        // lands, how wide a barcode is allowed to be and what counts as
        // overflowing — a defect here prints a wrong label just as surely as
        // one in the renderer. Components (.tsx) stay out: asserting on markup
        // buys far less than it costs.
        'packages/web/src/app/*.ts',
        'packages/web/src/editor/*.ts',
        'packages/web/src/features/preferences/store.ts',
        'packages/web/src/features/printers/offset-directions.ts',
        'packages/web/src/pages/consumable.ts',
      ],
      exclude: [
        '**/*.d.ts',
        '**/*.test.ts',
        'packages/*/src/index.ts',
        // Raw I/O adapters over serialport and node:net. They cannot run in a
        // suite that must pass with no printer attached, and counting them at
        // zero makes the gate report a lower number without telling anyone
        // anything useful. Everything above them is covered through
        // PrinterTransport, which is the point of that abstraction.
        'packages/server/src/drivers/serial-transport.ts',
        'packages/server/src/drivers/tcp-transport.ts',
      ],
      // Count files that no test imported; otherwise an untested module
      // silently improves the average by being absent from it.
      all: true,
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
})
