/**
 * Where you are in a label's four steps.
 *
 * It is a position indicator, not a wizard. Nothing here holds anybody back:
 * the gallery offers a way straight to printing, and the bar's job is only to
 * answer "which of the four is this, and what is behind me". The one step it
 * ever refuses is the last — confirming a batch that has no machine or no rows
 * is not a decision anybody can make yet.
 *
 * There is no separate way out. The first step *is* the way out — 「标签」 is
 * the gallery, and from anywhere inside a label it is one click to the left of
 * where you are standing. A back arrow beside it said the same thing twice.
 */
import { Fragment } from 'react'
import { copy } from '../i18n/index.ts'
import { cn } from '../lib/utils.ts'
import type { Step, StepId } from '../features/print/flow.ts'

export interface StepBarProps {
  steps: readonly Step[]
  /** Called with a step that is behind the current one. */
  onGo: (step: StepId) => void
  /** What this step is about — the label, or the machine. Never the step's own name. */
  context?: React.ReactNode
}

const DOT = 'flex size-[18px] shrink-0 items-center justify-center rounded-full border text-2xs font-mono'

function Marks({ step }: { step: Step }): React.JSX.Element {
  return (
    <>
      <span
        className={cn(
          DOT,
          step.state === 'current'
            ? 'border-primary text-primary shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-primary)_12%,transparent)]'
            : 'border-neutral-700 text-muted-foreground',
          step.state === 'past' && 'text-foreground/72',
        )}
        aria-hidden
      >
        {step.ordinal}
      </span>
      <span
        data-step-name
        className={cn(
          // On a narrow viewport the three names that are not yours are what
          // overflows first; the numbers still say "four steps, you are third".
          step.state === 'current' ? '' : 'max-[1100px]:hidden',
        )}
      >
        {copy.flow.steps[step.id]}
      </span>
    </>
  )
}

const ROW = 'flex shrink-0 items-center gap-n2 whitespace-nowrap'

export function StepBar({ steps, onGo, context }: StepBarProps): React.JSX.Element {
  return (
    <div
      role="toolbar"
      aria-label={copy.flow.heading}
      aria-orientation="horizontal"
      className="flex h-13 shrink-0 items-center gap-n4 border-b border-border px-n2"
    >
      <ol className="flex shrink-0 items-center gap-n4">
        {steps.map((step, index) => (
          <Fragment key={step.id}>
            {index > 0 && (
              // Nocturne's divider: a line that fades at both ends, never a
              // solid rule between two things that belong together.
              <li
                aria-hidden
                className="h-px w-[30px] shrink-0 bg-[linear-gradient(90deg,transparent,var(--color-border),transparent)]"
              />
            )}
            <li
              data-step={step.id}
              data-state={step.state}
              aria-current={step.state === 'current' ? 'step' : undefined}
              className={cn(
                'shrink-0 text-xs',
                step.state === 'current'
                  ? 'text-accent-300'
                  : step.state === 'past'
                    ? 'text-foreground/72'
                    : 'text-muted-foreground',
                step.state === 'blocked' && 'opacity-55',
              )}
            >
              {step.state === 'past' ? (
                <button
                  type="button"
                  onClick={() => onGo(step.id)}
                  className={cn(ROW, 'rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring')}
                >
                  <Marks step={step} />
                </button>
              ) : (
                <span className={ROW}>
                  <Marks step={step} />
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>

      {context !== undefined && (
        <span data-step-context className="ml-auto shrink-0 truncate text-xs text-muted-foreground">
          {context}
        </span>
      )}
    </div>
  )
}
