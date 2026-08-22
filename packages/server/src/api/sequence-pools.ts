/**
 * Sequence pools.
 *
 * A pool is a standalone object, not a property of a design: two designs
 * drawing from one run of numbers is a real requirement, and it only works if
 * the counter outlives whichever design references it.
 *
 * `current` is derived, never stored — see `sequence-pool.ts` for why a second
 * copy of that number would be dangerous rather than merely redundant.
 */
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { SequencePoolRepo } from '../db/repositories/sequence-pool-repo.ts'
import { currentValue, nextValue, sequencePoolInputSchema } from '../domain/sequence-pool.ts'
import { ApiError, HttpStatus } from './errors.ts'

const idParams = z.object({ id: z.string().min(1) })

const resetBody = z.object({
  floor: z.number().int().min(0),
  /**
   * Required. Restarting at a number already printed produces duplicate
   * serials, and two boxes carrying the same serial cannot be told apart
   * afterwards — so this cannot be reached by an idempotent retry.
   */
  confirm: z.boolean().optional(),
})

export function registerSequencePoolRoutes(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const pools = (): SequencePoolRepo =>
    new SequencePoolRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })

  const view = (repo: SequencePoolRepo, id: string) => {
    const pool = repo.find(id)
    if (pool === undefined) {
      throw ApiError.notFound({ poolId: id })
    }
    const highest = repo.highestClaimed(pool.id)
    return {
      ...pool,
      current: currentValue(pool.floor, highest),
      nextValue: nextValue(pool, highest),
    }
  }

  typed.get('/api/sequence-pools', async () => {
    const repo = pools()
    return { pools: repo.list().map((pool) => view(repo, pool.id)) }
  })

  typed.post(
    '/api/sequence-pools',
    { schema: { body: sequencePoolInputSchema } },
    async (request, reply) => {
      const repo = pools()
      if (repo.findByName(request.body.name) !== undefined) {
        throw ApiError.conflict('DATA_SOURCE_NAME_TAKEN', { name: request.body.name })
      }
      const created = repo.create(request.body)
      return reply.status(HttpStatus.Created).send(view(repo, created.id))
    },
  )

  typed.patch(
    '/api/sequence-pools/:id',
    { schema: { params: idParams, body: sequencePoolInputSchema } },
    async (request) => {
      const repo = pools()
      // Reads it first so a missing pool is a 404 rather than a silent no-op.
      view(repo, request.params.id)
      const clash = repo.findByName(request.body.name)
      if (clash !== undefined && clash.id !== request.params.id) {
        throw ApiError.conflict('DATA_SOURCE_NAME_TAKEN', { name: request.body.name })
      }
      repo.update(request.params.id, request.body)
      return view(repo, request.params.id)
    },
  )

  typed.post(
    '/api/sequence-pools/:id/reset',
    { schema: { params: idParams, body: resetBody } },
    async (request) => {
      const repo = pools()
      view(repo, request.params.id)
      if (request.body.confirm !== true) {
        throw ApiError.unprocessable('SEQUENCE_RESET_NOT_CONFIRMED', { poolId: request.params.id })
      }
      repo.setFloor(request.params.id, request.body.floor)
      return view(repo, request.params.id)
    },
  )

  typed.delete('/api/sequence-pools/:id', { schema: { params: idParams } }, async (request, reply) => {
    const repo = pools()
    view(repo, request.params.id)

    // Refused while designs still reference it: deleting would leave their
    // sequence variables with nothing to resolve to, and unlike a data source
    // there is no equivalent pool to re-point them at.
    const affected = repo.templatesUsing(request.params.id)
    if (affected.length > 0) {
      throw ApiError.conflict('SEQUENCE_POOL_IN_USE', { affectedTemplates: affected })
    }

    repo.delete(request.params.id)
    return reply.status(HttpStatus.NoContent).send()
  })
}
