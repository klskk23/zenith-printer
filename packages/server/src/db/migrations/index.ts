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
import { backfillThumbnails } from './thumbnail-backfill.ts'
import { relativiseImagePaths } from './image-path-migration.ts'

/**
 * The column that made `delete` wrong.
 *
 * `ref_count` was meant to say whether history still needed an image, but
 * nothing ever incremented it — so it read zero for every row and every delete
 * removed the file, including ones a job's snapshot still pointed at. The
 * question is now answered by reading the designs (see `image-references.ts`),
 * and a column that is always zero would only invite somebody to trust it.
 */
const dropImageRefCount = `ALTER TABLE images DROP COLUMN ref_count;`

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
    -- Reset floor: numbering starts again here.
    floor      INTEGER NOT NULL DEFAULT 0 CHECK (floor >= 0),
    -- Claims at or below this rowid predate the last reset and no longer count
    -- towards the current value. Without it a reset could never lower the
    -- number, since the derivation takes a maximum over history — and a reset
    -- button that silently does nothing is worse than no reset button. The
    -- claims themselves are kept: they are the evidence of what went onto
    -- labels, which is exactly why resetting backwards has to be confirmed as
    -- capable of producing duplicates (FR-006).
    floor_watermark INTEGER NOT NULL DEFAULT 0,
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

/**
 * The library's picture for a design, generated when it is saved.
 *
 * A BLOB on the row rather than a file beside the image assets: it is derived
 * data with exactly the lifetime of the row, so storing it anywhere else just
 * creates something to leave behind when a template is deleted.
 */
const templateThumbnail = `
  ALTER TABLE templates ADD COLUMN thumbnail BLOB;
`

/**
 * Where a data source's rows come from.
 *
 * Six nullable columns on the row rather than a side table: a data source has
 * at most one origin, and that origin lives exactly as long as the row does —
 * deleting the source deletes it, unlinking clears it. A join table would only
 * add a way for the two to disagree.
 *
 * No backfill. `local` is not a placeholder for the right answer; for every
 * data source that already exists, it *is* the right answer.
 *
 * `source_kind` is a CHECK rather than a boolean so that a second kind of
 * origin later costs a value, not another column.
 */
const dataSourceLink = `
  ALTER TABLE data_sources ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'local'
    CHECK (source_kind IN ('local', 'google-sheets'));
  ALTER TABLE data_sources ADD COLUMN spreadsheet_id    TEXT;
  ALTER TABLE data_sources ADD COLUMN spreadsheet_title TEXT;
  ALTER TABLE data_sources ADD COLUMN worksheet_id      INTEGER;
  ALTER TABLE data_sources ADD COLUMN worksheet_title   TEXT;
  ALTER TABLE data_sources ADD COLUMN last_refreshed_at TEXT;
`

/**
 * Sequence claims outlive the job that made them.
 *
 * `job_id` was `REFERENCES print_jobs(id) ON DELETE CASCADE`, and that was
 * harmless for exactly as long as nothing ever deleted a job. Nothing did —
 * cancelling marks a row, it does not remove it — so with foreign keys on, the
 * cascade never fired once. History pruning deletes rows, and the cascade would
 * have taken with it the only record of which serials went onto labels. A
 * pool's current value is derived from those rows and is not stored anywhere
 * else (domain/sequence-pool.ts), so the counter would have rolled quietly
 * backwards and the next batch would have repeated numbers already in a box.
 *
 * The reference goes rather than becoming ON DELETE SET NULL: a claim whose job
 * is gone still has to name a job id, because (job_id, pool_id) is what makes a
 * job's claim on one pool unique.
 *
 * The pool reference keeps its cascade. Deleting a pool deletes the numbering
 * scheme itself, and claims against a scheme that no longer exists are not
 * evidence of anything.
 *
 * **The rowids are carried across explicitly.** `sequence_pools.floor_watermark`
 * holds a rowid from this table: claims at or below it predate the last reset
 * and stop counting. A plain `INSERT ... SELECT` renumbers from 1, and since
 * releasing a cancelled job's claim leaves gaps, the new numbers would be
 * *lower* than the old ones — dropping post-reset claims below the watermark
 * and rolling the counter back. The same fault this migration exists to
 * prevent, reintroduced by the fix for it.
 */
const claimsOutliveJobs = `
  CREATE TABLE job_sequence_claims_new (
    job_id        TEXT NOT NULL,
    pool_id       TEXT NOT NULL REFERENCES sequence_pools(id) ON DELETE CASCADE,
    variable_name TEXT NOT NULL,
    start_value   INTEGER NOT NULL,
    end_value     INTEGER NOT NULL,
    step          INTEGER NOT NULL,
    digits        INTEGER NOT NULL,
    PRIMARY KEY (job_id, pool_id)
  );

  INSERT INTO job_sequence_claims_new
    (rowid, job_id, pool_id, variable_name, start_value, end_value, step, digits)
  SELECT rowid, job_id, pool_id, variable_name, start_value, end_value, step, digits
  FROM job_sequence_claims;

  DROP TABLE job_sequence_claims;
  ALTER TABLE job_sequence_claims_new RENAME TO job_sequence_claims;

  CREATE INDEX idx_job_sequence_claims_pool ON job_sequence_claims (pool_id, end_value);
`

/**
 * A third kind of origin, and an identity for a row that is not its position.
 *
 * Two changes, together because both need `data_sources` rebuilt and rebuilding
 * it twice would be twice the risk.
 *
 * **`http`.** Migration 12 left `source_kind` as a CHECK precisely so that a new
 * origin would cost a value rather than a column. SQLite cannot alter a CHECK,
 * so collecting the value means rewriting the table.
 *
 * **`key_column` / `row_key`.** Until now a row's identity *was* its ordinal:
 * `(source_id, ordinal)` is the primary key, every write path goes through a
 * whole-table DELETE and renumbers 1..n, and a refresh compared only the column
 * set and the row count. That is sound for a table a person edits and then
 * prints from — they are looking at it. It is not sound for a table that
 * changes on its own: an upstream insert shifts every row below it, a selection
 * of ordinals then names different rows than it did, and nothing anywhere
 * notices, because the ordinals still exist. `expandSelection` only refuses
 * ordinals that are *gone*.
 *
 * So a row may now carry a key taken from one of its own columns, and a refresh
 * can upsert by it. Ordinals stay dense 1..n — `patchRows` and the browser's
 * select-all both depend on that — but they stop being what a row *is*.
 *
 * **The order below is the whole point.** `data_source_rows` references
 * `data_sources` with ON DELETE CASCADE, so dropping the parent to rebuild it
 * would fire an implicit DELETE FROM and take every row with it. The child is
 * therefore copied aside and dropped *first*; only then is the parent rebuilt,
 * with nothing left pointing at it. Doing it the other way round is a silent
 * total data loss that a migration test on an empty database would not catch.
 */
const httpSourcesAndRowKeys = `
  CREATE TABLE data_source_rows_backup AS SELECT * FROM data_source_rows;
  DROP TABLE data_source_rows;

  CREATE TABLE data_sources_new (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    columns    TEXT NOT NULL,
    row_count  INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source_kind TEXT NOT NULL DEFAULT 'local'
      CHECK (source_kind IN ('local', 'google-sheets', 'http')),
    spreadsheet_id    TEXT,
    spreadsheet_title TEXT,
    worksheet_id      INTEGER,
    worksheet_title   TEXT,
    last_refreshed_at TEXT,

    -- Where an http source reads from, and what it sends to get in.
    url          TEXT,
    -- Credentials. Stored, never returned: the read endpoints redact it, for
    -- the same reason the Google private key may only come from the
    -- environment — an endpoint with no authentication must not hand back the
    -- means of authenticating somewhere else.
    headers_json TEXT,

    -- Which column names a row. Null means identity is still position, which
    -- is what every source created before now means.
    key_column TEXT,

    -- 0 means "only when asked", which is what this product did exclusively
    -- until there was a key column to make anything else safe.
    refresh_interval_seconds INTEGER NOT NULL DEFAULT 0,
    refresh_before_print     INTEGER NOT NULL DEFAULT 0
  );

  INSERT INTO data_sources_new
    (id, name, columns, row_count, created_at, updated_at, source_kind,
     spreadsheet_id, spreadsheet_title, worksheet_id, worksheet_title, last_refreshed_at)
  SELECT id, name, columns, row_count, created_at, updated_at, source_kind,
         spreadsheet_id, spreadsheet_title, worksheet_id, worksheet_title, last_refreshed_at
  FROM data_sources;

  DROP TABLE data_sources;
  ALTER TABLE data_sources_new RENAME TO data_sources;

  CREATE TABLE data_source_rows (
    source_id   TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
    ordinal     INTEGER NOT NULL,
    values_json TEXT NOT NULL,
    -- The value of the source's key column for this row, or null where
    -- identity is still position.
    row_key     TEXT,
    PRIMARY KEY (source_id, ordinal)
  );

  INSERT INTO data_source_rows (source_id, ordinal, values_json)
  SELECT source_id, ordinal, values_json FROM data_source_rows_backup;

  DROP TABLE data_source_rows_backup;

  -- Partial, so the sources that have no key column are unaffected by it. Two
  -- rows sharing a key would make "update the row with this key" ambiguous,
  -- and the refresh path would have to pick one.
  CREATE UNIQUE INDEX idx_data_source_rows_key
    ON data_source_rows (source_id, row_key) WHERE row_key IS NOT NULL;
`

/**
 * A named combination of design, printer, settings and count.
 *
 * It exists so that a system on the other side of an HTTP call can print
 * without knowing what a template is or which printer is which. It hands over
 * rows and a preset id; everything else is a decision somebody made here, once,
 * in front of the machine.
 *
 * The references are `ON DELETE CASCADE` for the printer and the template and
 * `SET NULL` for the profile, matching what each deletion means: a preset whose
 * design or printer is gone cannot print anything and should not sit there
 * looking usable, while a preset whose print settings were deleted falls back
 * to the printer's defaults exactly as a job with no profile does.
 */
const printPresets = `
  CREATE TABLE print_presets (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    printer_id  TEXT NOT NULL REFERENCES printers(id)  ON DELETE CASCADE,
    profile_id  TEXT          REFERENCES profiles(id)  ON DELETE SET NULL,
    copies      INTEGER NOT NULL DEFAULT 1 CHECK (copies >= 1),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
`

/**
 * The third origin is the asset ledger, and it keeps almost nothing.
 *
 * Migration 16 added a generic `http` kind that stored a URL, a header set and
 * a key column. Every one of those is a copy of a decision made somewhere else:
 * the address and the credential belong to the deployment — the same place the
 * Google key comes from — and the key column is a constant. A stored copy
 * drifts the first time somebody moves the ledger or rotates a key, and the
 * only symptom is a refresh that quietly started failing.
 *
 * So the columns go, and what a source keeps is a category id.
 *
 * Any `http` source becomes `local`: its rows stay and are editable again,
 * which is exactly what releasing one did. There is nothing else honest to do
 * — the address it used to read from is no longer stored anywhere.
 *
 * **The order is the same as migration 16's, for the same reason.**
 * `data_source_rows` cascades on delete, so rebuilding the parent with the
 * child still pointing at it fires an implicit DELETE FROM and takes every row
 * of every table with it. Child aside and dropped first; parent rebuilt with
 * nothing left pointing at it.
 */
const nexusSources = `
  CREATE TABLE data_source_rows_backup AS SELECT * FROM data_source_rows;
  DROP TABLE data_source_rows;

  CREATE TABLE data_sources_new (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    columns    TEXT NOT NULL,
    row_count  INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source_kind TEXT NOT NULL DEFAULT 'local'
      CHECK (source_kind IN ('local', 'google-sheets', 'nexus')),
    spreadsheet_id    TEXT,
    spreadsheet_title TEXT,
    worksheet_id      INTEGER,
    worksheet_title   TEXT,
    last_refreshed_at TEXT,

    -- The whole configuration of a ledger-backed source. The address, the key
    -- and the key column are not here on purpose: see domain/nexus.ts.
    category_id TEXT,

    refresh_interval_seconds INTEGER NOT NULL DEFAULT 0,
    refresh_before_print     INTEGER NOT NULL DEFAULT 0
  );

  INSERT INTO data_sources_new
    (id, name, columns, row_count, created_at, updated_at, source_kind,
     spreadsheet_id, spreadsheet_title, worksheet_id, worksheet_title, last_refreshed_at,
     refresh_interval_seconds, refresh_before_print)
  SELECT id, name, columns, row_count, created_at, updated_at,
         CASE WHEN source_kind = 'http' THEN 'local' ELSE source_kind END,
         spreadsheet_id, spreadsheet_title, worksheet_id, worksheet_title, last_refreshed_at,
         refresh_interval_seconds, refresh_before_print
  FROM data_sources;

  DROP TABLE data_sources;
  ALTER TABLE data_sources_new RENAME TO data_sources;

  CREATE TABLE data_source_rows (
    source_id   TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
    ordinal     INTEGER NOT NULL,
    values_json TEXT NOT NULL,
    row_key     TEXT,
    PRIMARY KEY (source_id, ordinal)
  );

  INSERT INTO data_source_rows (source_id, ordinal, values_json, row_key)
  SELECT source_id, ordinal, values_json, row_key FROM data_source_rows_backup;

  DROP TABLE data_source_rows_backup;

  CREATE UNIQUE INDEX idx_data_source_rows_key
    ON data_source_rows (source_id, row_key) WHERE row_key IS NOT NULL;
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
  { id: 11, name: 'template_thumbnail', up: templateThumbnail, apply: backfillThumbnails },
  { id: 12, name: 'data_source_link', up: dataSourceLink },
  { id: 13, name: 'drop_image_ref_count', up: dropImageRefCount },
  { id: 14, name: 'relative_image_paths', up: '', apply: relativiseImagePaths },
  { id: 15, name: 'claims_outlive_jobs', up: claimsOutliveJobs },
  { id: 16, name: 'http_sources_and_row_keys', up: httpSourcesAndRowKeys },
  { id: 17, name: 'print_presets', up: printPresets },
  { id: 18, name: 'nexus_sources', up: nexusSources },
]
