/**
 * Rendering one print step on its own.
 *
 * The dialog these replaced could be dropped into a test with four props. The
 * steps take their state from the label session instead, so a test that wants
 * one in isolation has to stand in for that session — this is that stand-in,
 * with defaults that make the interesting prop the only one worth writing.
 */
import { useState } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { LabelIR } from '@zenith/shared'
import { PrintStep } from '../../src/features/print/print-step.tsx'
import { ConfirmStep } from '../../src/features/print/confirm-step.tsx'
import { EMPTY, type Selection } from '../../src/features/print/selection.ts'
import { tally } from '../../src/features/print/flow.ts'

function wrap(ui: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

export interface PrintStepHarness {
  printers?: readonly unknown[]
  profiles?: readonly unknown[]
  printerId?: string | null
  dataSourceId?: string | null
  boundRows?: number
  copies?: number
  onSelection?: (selection: Selection) => void
}

/** The print step with a live selection, the way the session holds one. */
export function renderPrintStep(options: PrintStepHarness = {}): void {
  function Harness(): React.JSX.Element {
    const [selection, setSelection] = useState<Selection>(EMPTY)
    const [keys, setKeys] = useState<ReadonlyMap<number, string>>(new Map())
    const [copies, setCopies] = useState(options.copies ?? 1)
    return (
      <PrintStep
        printers={(options.printers ?? []) as never}
        printerId={options.printerId ?? null}
        onPrinter={() => undefined}
        profiles={(options.profiles ?? []) as never}
        profileId={null}
        onProfile={() => undefined}
        dataSourceId={options.dataSourceId ?? null}
        selection={selection}
        onSelection={(next) => {
          setSelection(next)
          options.onSelection?.(next)
        }}
        keyByOrdinal={keys}
        onRowKeys={(update) => setKeys((current) => update(current))}
        copies={copies}
        onCopies={setCopies}
        tally={tally({
          boundRows: options.dataSourceId === null || options.dataSourceId === undefined ? null : (options.boundRows ?? 0),
          chosenRows: 0,
          copies,
        })}
        blocked={null}
        notices={[]}
        onContinue={() => undefined}
        onBack={() => undefined}
      />
    )
  }
  render(wrap(<Harness />))
}

export interface ConfirmStepHarness {
  ir: LabelIR
  printer: unknown
  templateId?: string | null
  profileId?: string | null
  dataSourceId?: string | null
  copies?: number
}

/** The confirm step, ready to submit. */
export function renderConfirmStep(options: ConfirmStepHarness): void {
  render(
    wrap(
      <ConfirmStep
        ir={options.ir}
        template={null}
        templateId={options.templateId ?? null}
        printer={options.printer as never}
        profile={null}
        profileId={options.profileId ?? null}
        variableValues={{}}
        dataSourceId={options.dataSourceId ?? null}
        selection={EMPTY}
        chosenRows={0}
        rowOrdinals={[]}
        keyByOrdinal={new Map()}
        copies={options.copies ?? 1}
        tally={tally({ boundRows: null, chosenRows: 0, copies: options.copies ?? 1 })}
        blocked={null}
        onBack={() => undefined}
        onAgain={() => undefined}
        onLabels={() => undefined}
        onQueue={() => undefined}
      />,
    ),
  )
}
