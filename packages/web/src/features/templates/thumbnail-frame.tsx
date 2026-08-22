/**
 * A design's picture, shown wherever a template is listed.
 *
 * Shared by the library and the home page's recent list rather than written
 * twice: they are the same thing seen from two places, and two copies of a
 * frame whose whole job is to be the label's shape would drift apart at the
 * first adjustment.
 */
import { copy } from '../../i18n/index.ts'
import { cn } from '../../lib/utils.ts'
import { thumbnailBoxPx } from './thumbnail-box.ts'
import { thumbnailUrl, type Template } from './hooks.ts'

/**
 * The design's picture, sized to the label's own shape.
 *
 * Drawn when the design was saved, not on every visit: the library lists every
 * template at once, and rendering each card on demand is a resvg pass per
 * card, per visit, for a picture that only changes when somebody edits the
 * design.
 *
 * The frame takes the label's own proportions rather than being one fixed box.
 * That is what removes the empty bands: a frame of a different shape from the
 * label letterboxes the picture inside it, so a 100 x 10 strip in a square
 * frame is a hairline with nothing above or below it. Same shape, no bands.
 *
 * Its size is fixed before the image arrives, so a shelf of cards does not
 * jump as they load.
 */
export interface ThumbnailFrameProps {
  template: Template
  /**
   * The budget the label's shape is fitted into.
   *
   * Defaults suit the library's cards: roughly their content width at the
   * grid's floor, and a height cap so a portrait label does not make its card
   * twice as tall as the rest. The home page's list is narrower and passes its
   * own — the numbers belong to the layout, not to the frame.
   */
  maxWidthPx?: number
  maxHeightPx?: number
  className?: string
}

export function ThumbnailFrame({
  template,
  maxWidthPx = 240,
  maxHeightPx = 140,
  className,
}: ThumbnailFrameProps): React.JSX.Element {
  const box = thumbnailBoxPx(template, { maxWidthPx, maxHeightPx })
  return (
    <div
      className={cn(
        'mx-auto flex items-center justify-center overflow-hidden rounded border border-border bg-white',
        className,
      )}
      style={{ width: box.widthPx, height: box.heightPx }}
      data-thumbnail-frame
    >
      {template.hasThumbnail ? (
        <img
          src={thumbnailUrl(template)}
          alt={copy.templates.thumbnailAlt(template.name)}
          loading="lazy"
          className="max-h-full max-w-full object-contain"
          data-thumbnail
        />
      ) : (
        <p className="px-2 text-center text-[11px] text-muted-foreground" data-no-thumbnail>
          {copy.templates.thumbnailMissing}
        </p>
      )}
    </div>
  )
}
