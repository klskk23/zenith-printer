/**
 * Schema migrations, applied in id order and recorded so they run once.
 *
 * Column names are snake_case here and mapped to camelCase at the repository
 * boundary; camelCase is the wire contract (Principle III.A), not the storage
 * convention.
 */
import type { Migration } from '../index.ts'
import { migrateOffsets } from './offset-migration.ts'
import { claimsFromSeqRanges, rewriteElementContent } from './variable-migration.ts'

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

/**
 * Optimistic concurrency for templates moves from `updated_at` to a counter.
 *
 * Comparing timestamps looks equivalent but is not: two saves that land on the
 * same instant compare equal, so the second silently overwrites the first while
 * reporting success. With an injected fixed clock — which is what the tests
 * use — that is the normal case rather than a rare race.
 *
 * Existing rows start at 1; nothing holds an older token, because the previous
 * token was a timestamp and every comparison against it now goes through the
 * counter instead.
 */
const templateVersion = `
  ALTER TABLE templates ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
`

/**
 * Offsets move from the profile to the printer; the profile gains the stock.
 *
 * The two describe different things and were conflated. An offset says where
 * this machine currently lays ink down — it changes when a roll is reloaded,
 * even a roll of the identical type, because the paper does not sit in exactly
 * the same place twice. Margins and stock size describe the paper. Keeping the
 * offset on the profile meant re-entering it on every profile of the same
 * machine, and switching profiles silently moved the print.
 *
 * Offsets are stored in dots here rather than millimetres. This is the only
 * position in the system stored that way, and deliberately: an offset is a
 * whole-bitmap translation, whose natural granularity is the print dot. Going
 * through millimetres would round twice for no gain.
 *
 * The existing value is carried over from each printer's default profile.
 * Where other profiles of the same printer disagree, their values are dropped
 * and recorded — see `migrateOffsets` in offset-migration.ts, which runs after
 * the schema change and can log what it discarded.
 */
const printerOffsetAndStock = `
  ALTER TABLE printers ADD COLUMN offset_x_dots INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE printers ADD COLUMN offset_y_dots INTEGER NOT NULL DEFAULT 0;

  ALTER TABLE profiles ADD COLUMN label_width_mm  REAL;
  ALTER TABLE profiles ADD COLUMN label_height_mm REAL;
  ALTER TABLE profiles ADD COLUMN margin_top_mm    REAL NOT NULL DEFAULT 0;
  ALTER TABLE profiles ADD COLUMN margin_right_mm  REAL NOT NULL DEFAULT 0;
  ALTER TABLE profiles ADD COLUMN margin_bottom_mm REAL NOT NULL DEFAULT 0;
  ALTER TABLE profiles ADD COLUMN margin_left_mm   REAL NOT NULL DEFAULT 0;
`

/**
 * Drop the old offset columns.
 *
 * Separate from the migration above so the data move happens in between, with
 * the old values still readable. SQLite supports DROP COLUMN from 3.35.
 */
const dropProfileOffsets = `
  ALTER TABLE profiles DROP COLUMN offset_x_mm;
  ALTER TABLE profiles DROP COLUMN offset_y_mm;
`

/**
 * Halftoning, per profile.
 *
 * A thermal head has no grey, so a photograph put through the ordinary
 * threshold comes out as slabs of black and white. Which screen suits depends
 * on the stock, and the stock is what a profile describes.
 */
const profileHalftone = `
  ALTER TABLE profiles ADD COLUMN halftone TEXT NOT NULL DEFAULT 'none'
                       CHECK (halftone IN ('none', 'floyd-steinberg', 'ordered'));
`

/**
 * The binarisation cut-off, per profile.
 *
 * 128 preserves exactly what every existing label already does, so this is a
 * setting that appears without changing anything until somebody moves it.
 */
const profileThreshold = `
  ALTER TABLE profiles ADD COLUMN threshold INTEGER NOT NULL DEFAULT 128
                       CHECK (threshold BETWEEN 1 AND 255);
`


/**
 * Data sources, sequence pools, and the claims that record issued serials.
 *
 * Row values are JSON rather than real columns: column names come from
 * somebody's spreadsheet header — arbitrary Chinese text — and the whole set
 * changes when a data source is replaced. JSON makes "column" data rather than
 * schema.
 *
 * `job_sequence_claims` replaces the `seq_ranges` JSON blob on print_jobs. A
 * pool is shared across designs, so its current value can no longer be derived
 * by narrowing on template_id; without an indexable row per claim, every
 * submission would scan the whole job table and parse JSON.
 */
const dataSourcesAndPools = `
  CREATE TABLE data_sources (
    id         TEXT PRIMARY KEY,
    -- A label, not an identifier: designs bind by id, so renaming is free.
    name       TEXT NOT NULL UNIQUE,
    columns    TEXT NOT NULL,
    -- Denormalised so the list page does not COUNT(*) over ten thousand rows.
    row_count  INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE data_source_rows (
    source_id   TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
    -- Position in the table, 1-based. This is what a "5-12" selection means.
    ordinal     INTEGER NOT NULL,
    values_json TEXT NOT NULL,
    PRIMARY KEY (source_id, ordinal)
  );

  CREATE TABLE sequence_pools (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    digits     INTEGER NOT NULL CHECK (digits BETWEEN 1 AND 12),
    step       INTEGER NOT NULL DEFAULT 1 CHECK (step >= 1),
    -- Reset floor. The current value is max(floor, highest claimed) — history
    -- stays the only evidence of what was printed; this is just a declaration
    -- that numbering starts again here.
    floor      INTEGER NOT NULL DEFAULT 0 CHECK (floor >= 0),
    created_at TEXT NOT NULL
  );

  CREATE TABLE job_sequence_claims (
    job_id        TEXT NOT NULL REFERENCES print_jobs(id) ON DELETE CASCADE,
    pool_id       TEXT NOT NULL REFERENCES sequence_pools(id) ON DELETE CASCADE,
    variable_name TEXT NOT NULL,
    start_value   INTEGER NOT NULL,
    end_value     INTEGER NOT NULL,
    step          INTEGER NOT NULL,
    -- Stored, never inferred from end_value: a pool set to three digits that
    -- only reached 80 must still print "080", or the labels do not sort.
    digits        INTEGER NOT NULL,
    PRIMARY KEY (job_id, pool_id)
  );

  CREATE INDEX idx_job_sequence_claims_pool ON job_sequence_claims (pool_id, end_value);
`

/**
 * A design's variable definitions, and the one data source it is bound to.
 *
 * The binding is a column rather than something parsed out of element content:
 * that is what makes "at most one data source" impossible to violate instead of
 * a rule somebody has to check.
 *
 * No ON DELETE clause. A dangling id is exactly the state that must be visible
 * — the templates list and the design page show a warning for it. Cascading to
 * NULL would turn "bound to a table that is gone" into "never bound to
 * anything", and those are different situations for whoever has to fix it.
 */
const templateVariables = `
  ALTER TABLE templates ADD COLUMN variables TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE templates ADD COLUMN data_source_id TEXT;
`

/**
 * Retire the variable-field mechanism.
 *
 * Destructive, and only acceptable because there is no production data yet
 * (FR-051). The row-level moves happen in `migrateVariables` before these
 * statements run.
 */
const dropVariableFields = `
  DROP TABLE variable_fields;
  ALTER TABLE print_jobs DROP COLUMN manual_field_values;
  ALTER TABLE print_jobs DROP COLUMN seq_ranges;
`

export const migrations: Migration[] = [
  { id: 1, name: 'initial_schema', up: initialSchema },
  { id: 2, name: 'template_version', up: templateVersion },
  { id: 3, name: 'printer_offset_and_stock', up: printerOffsetAndStock, apply: migrateOffsets },
  { id: 4, name: 'drop_profile_offsets', up: dropProfileOffsets },
  { id: 5, name: 'profile_halftone', up: profileHalftone },
  { id: 6, name: 'profile_threshold', up: profileThreshold },
  { id: 7, name: 'data_sources_and_pools', up: dataSourcesAndPools },
  { id: 8, name: 'template_variables', up: templateVariables },
  // Reads seq_ranges, so it must land before migration 10 drops the column.
  // `apply` runs *after* `up`, hence the empty `up` here rather than folding
  // the move into the migration that does the dropping.
  { id: 9, name: 'claims_from_seq_ranges', up: '', apply: claimsFromSeqRanges },
  { id: 10, name: 'drop_variable_fields', up: dropVariableFields, apply: rewriteElementContent },
]
