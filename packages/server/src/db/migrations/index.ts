/**
 * Schema migrations, applied in id order and recorded so they run once.
 *
 * Column names are snake_case here and mapped to camelCase at the repository
 * boundary; camelCase is the wire contract (Principle III.A), not the storage
 * convention.
 */
import type { Migration } from '../index.ts'

const initialSchema = `
  CREATE TABLE printers (
    id                        TEXT PRIMARY KEY,
    name                      TEXT NOT NULL,
    kind                      TEXT NOT NULL CHECK (kind IN ('niimbot', 'zpl')),
    transport                 TEXT NOT NULL CHECK (transport IN ('serial', 'tcp')),
    address                   TEXT NOT NULL,
    print_task_name           TEXT,

    -- Probed capabilities. NULL until the first successful probe; never
    -- hardcoded per model (constitution: "Hardware compatibility").
    dpi                       INTEGER,
    printhead_pixels          INTEGER,
    density_min               INTEGER,
    density_max               INTEGER,
    density_default           INTEGER,
    paper_types               TEXT,
    print_direction           TEXT CHECK (print_direction IN ('top', 'left')),
    supports_consumable_level INTEGER,
    model                     TEXT,
    serial                    TEXT,
    firmware_version          TEXT,
    last_probed_at            TEXT,

    queue_state               TEXT NOT NULL DEFAULT 'running'
                              CHECK (queue_state IN ('running', 'paused')),
    queue_paused_reason       TEXT,
    created_at                TEXT NOT NULL
  );

  CREATE TABLE profiles (
    id           TEXT PRIMARY KEY,
    printer_id   TEXT NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    density      INTEGER NOT NULL,
    label_type   INTEGER NOT NULL,
    speed        INTEGER,
    -- Stored in millimetres; the UI steps in dots (constitution: "Units").
    offset_x_mm  REAL NOT NULL DEFAULT 0,
    offset_y_mm  REAL NOT NULL DEFAULT 0,
    is_default   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL
  );
  CREATE INDEX profiles_printer_idx ON profiles(printer_id);

  CREATE TABLE templates (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    -- Bound to a printer KIND, not an instance, so two identical machines can
    -- share one template.
    printer_kind  TEXT NOT NULL CHECK (printer_kind IN ('niimbot', 'zpl')),
    width_mm      REAL NOT NULL,
    height_mm     REAL NOT NULL,
    dpi           INTEGER NOT NULL,
    elements      TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE variable_fields (
    template_id  TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    label        TEXT NOT NULL,
    source       TEXT NOT NULL CHECK (source IN ('manual', 'sequence')),
    sample_value TEXT,
    seq_start    INTEGER,
    seq_digits   INTEGER,
    seq_step     INTEGER,
    PRIMARY KEY (template_id, name)
  );

  CREATE TABLE images (
    id           TEXT PRIMARY KEY,
    filename     TEXT NOT NULL,
    mime_type    TEXT NOT NULL,
    size_bytes   INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    ref_count    INTEGER NOT NULL DEFAULT 0,
    -- The one soft-deleted entity: snapshots can duplicate text and numbers,
    -- but not binaries, so history keeps these resolvable (FR-051).
    deleted_at   TEXT,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE print_jobs (
    id                  TEXT PRIMARY KEY,
    idempotency_key     TEXT NOT NULL,

    -- Nulled rather than blocked when the upstream entity is deleted; the
    -- snapshot below keeps the record self-contained (FR-050, FR-051).
    printer_id          TEXT REFERENCES printers(id) ON DELETE SET NULL,
    template_id         TEXT REFERENCES templates(id) ON DELETE SET NULL,
    profile_id          TEXT REFERENCES profiles(id) ON DELETE SET NULL,

    requested_copies    INTEGER NOT NULL,
    -- NULL means "unknown", which is NOT the same as 0. It is what a crash
    -- mid-print leaves behind, and the UI must say so (FR-053).
    pages_printed       INTEGER,

    manual_field_values TEXT NOT NULL DEFAULT '{}',
    -- Locked at enqueue time so concurrent jobs cannot overlap (FR-049).
    seq_ranges          TEXT NOT NULL DEFAULT '{}',

    status              TEXT NOT NULL
                        CHECK (status IN ('queued','printing','completed','failed','cancelled')),
    failure_code        TEXT,
    failure_message     TEXT,

    snapshot            TEXT NOT NULL,

    created_at          TEXT NOT NULL,
    started_at          TEXT,
    finished_at         TEXT
  );

  -- Duplicate submissions must return the original job rather than burning a
  -- second batch of stock (FR-017).
  CREATE UNIQUE INDEX print_jobs_idempotency_idx ON print_jobs(idempotency_key);
  CREATE INDEX print_jobs_queue_idx ON print_jobs(printer_id, status, created_at);
`

export const migrations: Migration[] = [{ id: 1, name: 'initial_schema', up: initialSchema }]
