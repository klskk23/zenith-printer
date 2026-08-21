/**
 * Printer persistence.
 *
 * Columns are snake_case; the wire contract is camelCase (Principle III.A).
 * The mapping happens here so nothing above this layer has to know.
 */
import type { Database } from '../index.ts'
import type { Printer, PrinterInput, ProbedCapabilities, QueueState } from '../../domain/printer.ts'
import type { Clock, IdGenerator } from '../../clock.ts'

type Row = Record<string, unknown>

function toPrinter(row: Row): Printer {
  const probed = row.dpi !== null && row.dpi !== undefined

  const capabilities: ProbedCapabilities | null = probed
    ? {
        dpi: Number(row.dpi),
        printheadPixels: Number(row.printhead_pixels),
        densityMin: Number(row.density_min),
        densityMax: Number(row.density_max),
        densityDefault: Number(row.density_default),
        paperTypes: JSON.parse(String(row.paper_types ?? '[]')) as number[],
        printDirection: String(row.print_direction) as 'top' | 'left',
        supportsConsumableLevel: Number(row.supports_consumable_level) === 1,
        model: row.model === null ? null : String(row.model),
        serial: row.serial === null ? null : String(row.serial),
        firmwareVersion: row.firmware_version === null ? null : String(row.firmware_version),
      }
    : null

  const printer: Printer = {
    id: String(row.id),
    name: String(row.name),
    kind: String(row.kind) as Printer['kind'],
    transport: String(row.transport) as Printer['transport'],
    address: String(row.address),
    capabilities,
    queueState: String(row.queue_state) as QueueState,
    queuePausedReason: row.queue_paused_reason === null ? null : String(row.queue_paused_reason),
    lastProbedAt: row.last_probed_at === null ? null : String(row.last_probed_at),
    createdAt: String(row.created_at),
    offsetXDots: Number(row.offset_x_dots ?? 0),
    offsetYDots: Number(row.offset_y_dots ?? 0),
  }

  if (row.print_task_name !== null && row.print_task_name !== undefined) {
    printer.printTaskName = String(row.print_task_name)
  }
  return printer
}

export interface PrinterRepoDeps {
  db: Database
  clock: Clock
  ids: IdGenerator
}

export class PrinterRepo {
  readonly #db: Database
  readonly #clock: Clock
  readonly #ids: IdGenerator

  constructor(deps: PrinterRepoDeps) {
    this.#db = deps.db
    this.#clock = deps.clock
    this.#ids = deps.ids
  }

  list(): Printer[] {
    return this.#db
      .prepare('SELECT * FROM printers ORDER BY created_at, name')
      .all()
      .map((row) => toPrinter(row as Row))
  }

  find(id: string): Printer | undefined {
    const row = this.#db.prepare('SELECT * FROM printers WHERE id = ?').get(id)
    return row === undefined ? undefined : toPrinter(row as Row)
  }

  create(input: PrinterInput): Printer {
    const id = this.#ids.next()
    this.#db
      .prepare(
        `INSERT INTO printers (id, name, kind, transport, address, print_task_name, queue_state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'running', ?)`,
      )
      .run(
        id,
        input.name,
        input.kind,
        input.transport,
        input.address,
        input.printTaskName ?? null,
        this.#clock.now().toISOString(),
      )
    const created = this.find(id)
    if (created === undefined) {
      throw new Error(`printer ${id} vanished immediately after insert`)
    }
    return created
  }

  /** Store probe results (FR-025). Never asks the operator for these. */
  saveCapabilities(id: string, capabilities: ProbedCapabilities): Printer | undefined {
    this.#db
      .prepare(
        `UPDATE printers SET
           dpi = ?, printhead_pixels = ?, density_min = ?, density_max = ?, density_default = ?,
           paper_types = ?, print_direction = ?, supports_consumable_level = ?,
           model = ?, serial = ?, firmware_version = ?, last_probed_at = ?
         WHERE id = ?`,
      )
      .run(
        capabilities.dpi,
        capabilities.printheadPixels,
        capabilities.densityMin,
        capabilities.densityMax,
        capabilities.densityDefault,
        JSON.stringify(capabilities.paperTypes),
        capabilities.printDirection,
        capabilities.supportsConsumableLevel ? 1 : 0,
        capabilities.model,
        capabilities.serial,
        capabilities.firmwareVersion,
        this.#clock.now().toISOString(),
        id,
      )
    return this.find(id)
  }

  setQueueState(id: string, state: QueueState, reason: string | null): Printer | undefined {
    this.#db
      .prepare('UPDATE printers SET queue_state = ?, queue_paused_reason = ? WHERE id = ?')
      .run(state, reason, id)
    return this.find(id)
  }

  /** Jobs still waiting on this printer; blocks deletion (FR-052). */
  /**
   * Store the position correction.
   *
   * Belongs to the machine rather than to a profile: it describes where this
   * printer currently lays ink down, and reloading a roll — even one of the
   * identical type — can change that (FR-052).
   */
  setOffset(id: string, offsetXDots: number, offsetYDots: number): Printer | undefined {
    this.#db
      .prepare('UPDATE printers SET offset_x_dots = ?, offset_y_dots = ? WHERE id = ?')
      .run(Math.round(offsetXDots), Math.round(offsetYDots), id)
    return this.find(id)
  }

  /**
   * Change how the printer is reached, and what it is called.
   *
   * `kind` and `transport` are not editable: they decide which driver speaks to
   * the device, and a record that swapped them would be a different machine
   * wearing the same id — along with its job history and its offset. Deleting
   * and adding says that plainly.
   *
   * A changed address clears the probed capabilities. They describe whatever
   * answered at the *old* address, and printing against a head width or a dpi
   * belonging to another machine produces labels that are wrong in ways nobody
   * checks. The rest of the system already handles an unprobed printer — the
   * job endpoint refuses with `needsProbe` rather than guessing.
   */
  updateConnection(
    id: string,
    changes: { name?: string; address?: string; printTaskName?: string },
  ): Printer | undefined {
    const current = this.find(id)
    if (current === undefined) {
      return undefined
    }

    const name = changes.name ?? current.name
    const address = changes.address ?? current.address
    const printTaskName = changes.printTaskName ?? current.printTaskName
    const moved = address !== current.address

    this.#db
      .prepare(
        `UPDATE printers
            SET name = ?, address = ?, print_task_name = ?
          WHERE id = ?`,
      )
      .run(name, address, printTaskName ?? null, id)

    if (moved) {
      this.#db
        .prepare(
          `UPDATE printers
              SET dpi = NULL, printhead_pixels = NULL, density_min = NULL, density_max = NULL,
                  density_default = NULL, paper_types = NULL, print_direction = NULL,
                  supports_consumable_level = NULL, model = NULL, serial = NULL,
                  firmware_version = NULL, last_probed_at = NULL
            WHERE id = ?`,
        )
        .run(id)
    }

    return this.find(id)
  }

  queuedJobCount(id: string): number {
    const row = this.#db
      .prepare("SELECT COUNT(*) AS n FROM print_jobs WHERE printer_id = ? AND status IN ('queued','printing')")
      .get(id)
    return Number(row?.n ?? 0)
  }

  delete(id: string): void {
    this.#db.prepare('DELETE FROM printers WHERE id = ?').run(id)
  }
}
