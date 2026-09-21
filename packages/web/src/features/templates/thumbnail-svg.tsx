/**
 * A label's picture, drawn here rather than fetched.
 *
 * The same function the print path and the canvas use — `irToSvg` from the
 * shared package — with the label's variable fields filled in, so what the
 * gallery shows is what the canvas shows is what prints. No request per tile:
 * the list already carries every label's content, and a picture that changes
 * with the bound table's first row could not be a file saved at save time.
 *
 * Inline as a data URL on an <img> rather than injected SVG: an image is
 * sized by its box and cannot leak styles or ids into the page.
 */
import { useMemo } from 'react'
import { evaluateIr, irToSvg, type LabelIR } from '@zenith/shared'
import { copy } from '../../i18n/index.ts'

export interface ThumbnailSvgProps {
  ir: LabelIR
  values: Readonly<Record<string, string>>
  name: string
}

export function thumbnailSvg(ir: LabelIR, values: Readonly<Record<string, string>>): string {
  // `evaluateIr` never throws — an unresolved reference is reported, not
  // thrown — but the renderer is shared code fed a saved label, and a saved
  // label can predate a rule. The plain IR is the fallback, not a blank tile.
  try {
    return irToSvg(evaluateIr(ir, values).ir)
  } catch {
    return irToSvg(ir)
  }
}

export function ThumbnailSvg({ ir, values, name }: ThumbnailSvgProps): React.JSX.Element {
  const src = useMemo(
    () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(thumbnailSvg(ir, values))}`,
    [ir, values],
  )
  return (
    <img
      src={src}
      alt={copy.templates.thumbnailAlt(name)}
      className="max-h-full max-w-full object-contain"
      data-thumbnail
      draggable={false}
    />
  )
}
