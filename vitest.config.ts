import { defineConfig } from 'vitest/config'

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
