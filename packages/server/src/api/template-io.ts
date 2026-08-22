/**
 * Exporting designs to a file and reading them back.
 *
 * The format and the decisions it implies live in `domain/template-io.ts`;
 * this is the part that touches the database and the asset files.
 *
 * Import reports rather than refuses. What it refuses is narrow and stated in
 * the domain module: a file this build cannot represent. Everything else — a
 * table that is not here, a pool under a different name, a label wider than
 * any printer on this machine — is imported and reported, because a design
 * missing its table is still the design somebody meant to send.
 */
import { createHash } from 'node:crypto'
import { extname, join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { TemplateRepo } from '../db/repositories/template-repo.ts'
import { SequencePoolRepo } from '../db/repositories/sequence-pool-repo.ts'
import { DataSourceRepo } from '../db/repositories/data-source-repo.ts'
import { ImageRepo } from '../db/repositories/image-repo.ts'
import { PrinterRepo } from '../db/repositories/printer-repo.ts'
import { maxLabelWidthMm } from '../domain/printer.ts'
import { ApiError } from './errors.ts'
import {
  FILE_KIND,
  FORMAT_VERSION,
  exportFileSchema,
  remapAssetIds,
  resolveDataSource,
  resolvePool,
  type ExportFile,
  type ImportWarning,
} from '../domain/template-io.ts'
import type { LabelElement } from '@zenith/shared'
import { negotiateLocale } from '../i18n/negotiate.ts'
import { loadFontConfig } from '../render/fonts.ts'
import { renderThumbnail } from '../render/thumbnail.ts'
import { createImageResolver } from '../render/image-resolver.ts'
import { fontsRoot } from '../paths.ts'
import { renderWarning } from '../i18n/import-warnings.ts'

const importBody = z.object({
  file: z.unknown(),
  /**
   * What to do about a design whose id is already here.
   *
   * Absent means "do not decide for me": the import stops and reports the
   * clashes so the caller can ask. Overwriting is not reversible — there is no
   * version history — and somebody double-clicking a month-old backup may not
   * realise they are discarding today's work.
   */
  onConflict: z.enum(['overwrite', 'copy']).optional(),
})

export interface TemplateIoOptions {
  /** Where uploaded images live; imported ones are written beside them. */
  storageDir: string
}

export async function registerTemplateIoRoutes(
  app: FastifyInstance,
  options: TemplateIoOptions,
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const ctx = () => ({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })
  const fonts = loadFontConfig(fontsRoot)

  const buildExport = (ids: readonly string[] | null): ExportFile => {
    const templates = new TemplateRepo(ctx())
    const pools = new SequencePoolRepo(ctx())
    const sources = new DataSourceRepo(ctx())
    const images = new ImageRepo(ctx())

    const chosen =
      ids === null
        ? templates.list()
        : ids.map((id) => {
            const found = templates.find(id)
            if (found === undefined) {
              throw ApiError.notFound({ templateId: id })
            }
            return found
          })

    const file: ExportFile = {
      kind: FILE_KIND,
      formatVersion: FORMAT_VERSION,
      templates: [],
      pools: {},
      dataSources: {},
      assets: {},
    }

    for (const template of chosen) {
      // Images travel as bytes keyed by content hash, and the elements are
      // rewritten to point at the hash: an asset id means nothing on another
      // machine, and a hash is the same everywhere.
      const map = new Map<string, string>()
      for (const element of template.elements) {
        if (element.type !== 'image' || map.has(element.assetId)) {
          continue
        }
        const asset = images.find(element.assetId)
        if (asset === undefined) {
          // Already gone locally. Nothing to embed; the element keeps its id
          // and the design arrives without that picture — which is exactly
          // what it looks like here, too.
          continue
        }
        let bytes: Buffer
        try {
          bytes = readFileSync(asset.storagePath)
        } catch {
          continue
        }
        const hash = createHash('sha256').update(bytes).digest('hex')
        map.set(element.assetId, hash)
        file.assets[hash] = {
          mimeType: asset.mimeType,
          filename: asset.filename,
          base64: bytes.toString('base64'),
        }
      }

      for (const variable of template.variables) {
        if (variable.kind !== 'sequence' || file.pools[variable.poolId] !== undefined) {
          continue
        }
        const pool = pools.find(variable.poolId)
        if (pool !== undefined) {
          // The definition, never the counter. Two machines both believing
          // they own a range print duplicate serials, and that is only visible
          // with the labels side by side (FR-006).
          file.pools[variable.poolId] = {
            name: pool.name,
            digits: pool.digits,
            step: pool.step,
            floor: pool.floor,
          }
        }
      }

      if (template.dataSourceId !== null && file.dataSources[template.dataSourceId] === undefined) {
        const source = sources.find(template.dataSourceId)
        if (source !== undefined) {
          // Identity and shape, never rows: rows are business data, and a file
          // sent to the wrong person should not also be a customer list.
          file.dataSources[template.dataSourceId] = {
            name: source.name,
            columns: source.columns,
          }
        }
      }

      file.templates.push({
        id: template.id,
        name: template.name,
        printerKind: template.printerKind,
        widthMm: template.widthMm,
        heightMm: template.heightMm,
        dpi: template.dpi,
        elements: remapAssetIds(template.elements, map),
        variables: template.variables,
        dataSourceId: template.dataSourceId,
      })
    }

    return file
  }

  typed.get(
    '/api/templates/export',
    { schema: { querystring: z.object({ ids: z.string().optional() }) } },
    async (request) => {
      const ids =
        request.query.ids === undefined
          ? null
          : request.query.ids.split(',').filter((id) => id.length > 0)
      return buildExport(ids)
    },
  )

  /**
   * Store an embedded image, reusing an identical one already here.
   *
   * Deduplicated by content: re-importing the same design three times should
   * not leave three copies of the same logo in the asset list.
   */
  const importAsset = (
    images: ImageRepo,
    localHashes: Map<string, string>,
    hash: string,
    asset: { mimeType: string; filename: string; base64: string },
  ): string => {
    const existing = localHashes.get(hash)
    if (existing !== undefined) {
      return existing
    }
    const bytes = Buffer.from(asset.base64, 'base64')
    const extension = extname(asset.filename) || (asset.mimeType === 'image/png' ? '.png' : '.jpg')
    const created = images.create({
      filename: asset.filename,
      mimeType: asset.mimeType,
      sizeBytes: bytes.length,
      storagePath: '',
    })
    const storagePath = join(options.storageDir, `${created.id}${extension}`)
    writeFileSync(storagePath, bytes)
    app.ctx.db.prepare('UPDATE images SET storage_path = ? WHERE id = ?').run(storagePath, created.id)
    localHashes.set(hash, created.id)
    return created.id
  }

  typed.post('/api/templates/import', { schema: { body: importBody } }, async (request) => {
    const parsed = exportFileSchema.safeParse(request.body.file)
    if (!parsed.success) {
      throw ApiError.unprocessable('TEMPLATE_FILE_INVALID', {
        reason: parsed.error.issues[0]?.message ?? 'unrecognised file',
        path: parsed.error.issues[0]?.path.join('.') ?? '',
      })
    }
    const file = parsed.data
    if (file.formatVersion > FORMAT_VERSION) {
      throw ApiError.unprocessable('TEMPLATE_FILE_TOO_NEW', {
        fileVersion: file.formatVersion,
        supportedVersion: FORMAT_VERSION,
      })
    }

    const templates = new TemplateRepo(ctx())
    const pools = new SequencePoolRepo(ctx())
    const sources = new DataSourceRepo(ctx())
    const images = new ImageRepo(ctx())
    const printers = new PrinterRepo(ctx())

    const clashes = file.templates.filter((t) => templates.find(t.id) !== undefined)
    if (clashes.length > 0 && request.body.onConflict === undefined) {
      // Not an error so much as a question: the caller has to choose, because
      // overwriting cannot be undone.
      throw ApiError.conflict('TEMPLATE_ALREADY_EXISTS', {
        templates: clashes.map((t) => ({ id: t.id, name: t.name })),
      })
    }

    // Hashes of what is already here, so an identical logo is reused.
    const localHashes = new Map<string, string>()
    for (const asset of images.list()) {
      try {
        localHashes.set(createHash('sha256').update(readFileSync(asset.storagePath)).digest('hex'), asset.id)
      } catch {
        // A row whose file is gone. Skip it; a fresh copy will be written.
      }
    }

    const widestPrinter = printers
      .list()
      .filter((printer) => printer.capabilities !== null)
      .map((printer) => maxLabelWidthMm(printer.capabilities!))
      .reduce<number | null>((widest, width) => (widest === null || width > widest ? width : widest), null)

    const warnings: ImportWarning[] = []
    const imported: Array<{ id: string; name: string }> = []
    const existingPools = pools.list()
    const existingSources = sources.list()

    for (const exported of file.templates) {
      const assetMap = new Map<string, string>()
      for (const element of exported.elements) {
        if (element.type !== 'image' || assetMap.has(element.assetId)) {
          continue
        }
        const asset = file.assets[element.assetId]
        if (asset !== undefined) {
          assetMap.set(element.assetId, importAsset(images, localHashes, element.assetId, asset))
        }
      }

      const variables = exported.variables.map((variable) => {
        if (variable.kind !== 'sequence') {
          return variable
        }
        const decision = resolvePool(variable.poolId, file.pools[variable.poolId], existingPools)
        if ('poolId' in decision) {
          return variable
        }
        if ('matchedByName' in decision) {
          warnings.push({
            code: 'SEQUENCE_POOL_MATCHED_BY_NAME',
            templateName: exported.name,
            detail: { variable: variable.name, poolName: decision.matchedByName.name },
          })
          return { ...variable, poolId: decision.matchedByName.id }
        }
        if ('create' in decision) {
          const created = pools.create({
            name: decision.create.name,
            digits: decision.create.digits,
            step: decision.create.step,
          })
          pools.setFloor(created.id, decision.create.floor)
          existingPools.push({ ...created, floor: decision.create.floor })
          warnings.push({
            code: 'SEQUENCE_POOL_CREATED',
            templateName: exported.name,
            detail: { poolName: created.name, firstNumber: decision.create.floor },
          })
          return { ...variable, poolId: created.id }
        }
        return variable
      })

      let dataSourceId = exported.dataSourceId
      if (dataSourceId !== null) {
        const definition = file.dataSources[dataSourceId]
        const decision = resolveDataSource(dataSourceId, definition, existingSources)
        if ('matchedByName' in decision) {
          dataSourceId = decision.matchedByName.id
          warnings.push({
            code: 'DATA_SOURCE_MATCHED_BY_NAME',
            templateName: exported.name,
            detail: { sourceName: decision.matchedByName.name },
          })
          if (decision.missingColumns.length > 0) {
            warnings.push({
              code: 'DATA_SOURCE_COLUMNS_DIFFER',
              templateName: exported.name,
              detail: { sourceName: decision.matchedByName.name, columns: decision.missingColumns },
            })
          }
        } else if ('unresolved' in decision) {
          warnings.push({
            code: 'DATA_SOURCE_MISSING',
            templateName: exported.name,
            detail: {
              sourceName: definition?.name ?? dataSourceId,
              columns: definition?.columns ?? [],
            },
          })
        }
      }

      if (widestPrinter !== null && exported.widthMm > widestPrinter + 1e-6) {
        // Reported, not refused. Width is checked against the printer a job is
        // actually sent to; the machine that will print this may not be here.
        warnings.push({
          code: 'LABEL_WIDER_THAN_ANY_PRINTER',
          templateName: exported.name,
          detail: { widthMm: exported.widthMm, maxLabelWidthMm: Number(widestPrinter.toFixed(3)) },
        })
      }

      const input = {
        name: exported.name,
        printerKind: exported.printerKind,
        widthMm: exported.widthMm,
        heightMm: exported.heightMm,
        dpi: exported.dpi,
        elements: remapAssetIds(exported.elements, assetMap) as LabelElement[],
        variables,
        dataSourceId,
      }

      const clash = templates.find(exported.id)
      const saved =
        clash === undefined
          ? templates.create(input, exported.id)
          : request.body.onConflict === 'overwrite'
            ? templates.update(exported.id, input, clash.version)
            : templates.create(input)

      // An import is a save, so it owes the library the same picture. Drawn
      // after the row is written and never allowed to fail it: a design whose
      // barcode content cannot be encoded is still a design worth keeping.
      templates.saveThumbnail(
        saved.id,
        renderThumbnail({
          ir: {
            widthMm: saved.widthMm,
            heightMm: saved.heightMm,
            dpi: saved.dpi,
            elements: saved.elements,
          },
          fonts,
          resolveImage: createImageResolver(images),
        }),
      )
      imported.push({ id: saved.id, name: saved.name })
    }

    // The message travels with the code: the side that knows what happened
    // words it once, and both front ends show that wording rather than each
    // inventing their own.
    const locale = negotiateLocale(request.headers['accept-language'])
    return {
      imported,
      warnings: warnings.map((warning) => ({ ...warning, message: renderWarning(warning, locale) })),
    }
  })
}
