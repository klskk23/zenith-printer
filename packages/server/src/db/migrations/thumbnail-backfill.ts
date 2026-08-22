/**
 * Draw the library picture for designs saved before thumbnails existed.
 *
 * Without this every pre-existing template reports "could not be drawn", which
 * is a different and wrong statement: those designs are fine, they simply
 * predate the column. Doing it once here rather than lazily on first view
 * keeps `hasThumbnail` meaning exactly what it says — bytes exist, or the
 * design genuinely cannot be rasterised.
 *
 * A design that fails is left null and stays null. That is the honest answer
 * for it, and retrying on every boot would spend the same effort to reach the
 * same place.
 */
import { labelIrSchema } from '@zenith/shared'
import type { Database } from '../index.ts'
import { createImageResolver } from '../../render/image-resolver.ts'
import { loadFontConfig } from '../../render/fonts.ts'
import { renderThumbnail } from '../../render/thumbnail.ts'
import { fontsRoot } from '../../paths.ts'

export function backfillThumbnails(
  db: Database,
  log: (event: Record<string, unknown>) => void,
): void {
  const rows = db
    .prepare('SELECT id, width_mm, height_mm, dpi, elements FROM templates WHERE thumbnail IS NULL')
    .all() as Array<{ id: string; width_mm: number; height_mm: number; dpi: number; elements: string }>

  if (rows.length === 0) {
    return
  }

  const fonts = loadFontConfig(fontsRoot)
  // Reads only, so the structural lookup is enough — a migration has no clock
  // or id generator, and inventing them to satisfy a constructor would be
  // inventing them for nothing.
  // Reads only, so the structural lookup is enough — a migration has no clock
  // or id generator, and inventing them to satisfy a constructor would be
  // inventing them for nothing. The columns are mapped by hand because they
  // are snake_case in the table and camelCase on the type; handing the row
  // straight over would leave `storagePath` undefined, and the resolver would
  // quietly skip every image rather than say anything.
  const findAsset = db.prepare('SELECT mime_type, storage_path FROM images WHERE id = ?')
  const resolveImage = createImageResolver({
    find: (assetId) => {
      const row = findAsset.get(assetId) as
        | { mime_type: string; storage_path: string }
        | undefined
      return row === undefined
        ? undefined
        : { mimeType: row.mime_type, storagePath: row.storage_path }
    },
  })
  const update = db.prepare('UPDATE templates SET thumbnail = ? WHERE id = ?')

  let drawn = 0
  let failed = 0
  for (const row of rows) {
    let png: Uint8Array | null = null
    try {
      png = renderThumbnail({
        ir: labelIrSchema.parse({
          widthMm: row.width_mm,
          heightMm: row.height_mm,
          dpi: row.dpi,
          elements: JSON.parse(row.elements),
        }),
        fonts,
        resolveImage,
      })
    } catch {
      // A design the schema no longer accepts is not a reason to refuse the
      // migration; it is a reason for that one card to show a placeholder.
      png = null
    }
    if (png === null) {
      failed += 1
      continue
    }
    update.run(png, row.id)
    drawn += 1
  }

  log({ event: 'thumbnail_backfill', drawn, failed })
}
