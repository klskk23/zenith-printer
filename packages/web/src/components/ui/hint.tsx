/**
 * The small `?` beside a control.
 *
 * Standing explanations used to live in the page, under the thing they were
 * about: sixty-odd of them, most explaining how the product works internally
 * to somebody who only wanted to fill in a field. The rule now is that an
 * explanation of *how to fill this in* folds into a `?`, an explanation of
 * *why the system is built this way* is deleted, and an error or a warning
 * about something irreversible stays where it is, in full.
 *
 * Two shapes, because one of them has a job the other cannot do:
 *
 *   - `Hint` is a tooltip: hover, keyboard focus, or a tap on a touch screen.
 *     Its text cannot be selected, which is fine for prose.
 *   - `ValueHint` is a popover: it opens on a click and holds something to be
 *     carried away — a service account address, say — so the text is
 *     selectable and there is a button that copies it.
 */
import { useRef, useState } from 'react'
import { Check, Copy, HelpCircle } from 'lucide-react'
import { copy } from '../../i18n/index.ts'
import { cn } from '../../lib/utils.ts'
import { Popover, PopoverContent, PopoverTrigger } from './popover.tsx'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip.tsx'

const MARK =
  'inline-grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

export interface HintProps {
  /** The sentence itself. */
  children: React.ReactNode
  /** Names the control this belongs to, for anyone who cannot see where it sits. */
  label: string
  className?: string
}

export function Hint({ children, label, className }: HintProps): React.JSX.Element {
  // Also opened by a click: a touch screen has no hover, and a hint nobody on
  // a tablet can read is a hint that is not there.
  const [open, setOpen] = useState(false)
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-hint
            aria-label={copy.common.hintFor(label)}
            onClick={() => setOpen((current) => !current)}
            className={cn(MARK, className)}
          >
            <HelpCircle className="size-3.5" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent>{children}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export interface ValueHintProps {
  /** Said above the value: what it is and what to do with it. */
  children: React.ReactNode
  /** The thing to be carried away. Selectable, and copied by the button. */
  value: string
  label: string
  className?: string
}

export function ValueHint({ children, value, label, className }: ValueHintProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const valueRef = useRef<HTMLElement>(null)

  /**
   * Select the text and ask the document to copy it.
   *
   * Not `navigator.clipboard`: that one is gated behind a secure context, and
   * this service is plain HTTP on a LAN address — reading it there is a
   * `TypeError`, not a degraded feature (tests/secure-context.test.ts). The
   * copy *event* is not gated. And if even that is refused, the selection is
   * left in place, so the address can be taken with a keystroke.
   */
  const take = (): void => {
    const node = valueRef.current
    const selection = node === null ? null : window.getSelection()
    if (node === null || selection === null) {
      return
    }
    const range = document.createRange()
    range.selectNodeContents(node)
    selection.removeAllRanges()
    selection.addRange(range)
    try {
      setCopied(document.execCommand('copy'))
    } catch {
      setCopied(false)
    }
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-value-hint
          aria-label={copy.common.hintFor(label)}
          className={cn(MARK, 'border border-input', className)}
        >
          <HelpCircle className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-2xs" data-value-hint-panel>
        <p className="leading-relaxed text-muted-foreground">{children}</p>
        <div className="mt-n3 flex items-center gap-n2">
          {/* Selectable on purpose: clipboard access needs a secure context,
              and this service is plain HTTP on a LAN address. Whatever the
              button manages, the text itself can always be taken by hand. */}
          <code
            ref={valueRef}
            className="min-w-0 flex-1 truncate select-all font-mono text-foreground"
            data-hint-value
          >
            {value}
          </code>
          <button
            type="button"
            data-hint-copy
            className="flex shrink-0 items-center gap-1 rounded-sm border border-input px-n2 py-n1 text-2xs text-foreground hover:border-foreground/45 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={take}
          >
            {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
            {copied ? copy.common.copied : copy.common.copy}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
