/**
 * English copy.
 *
 * Mirrors `zh-CN.ts` key for key. Principle III.0 requires every message to
 * answer three questions — what happened, why, and what to do next — so the
 * translation keeps that structure rather than shortening it.
 */
import type { AppErrorCode, ErrorCopy, LocaleBundle } from './types.ts'

const DEVICE: Readonly<Record<number, ErrorCopy>> = {
  1: { what: 'The printer lid is open', why: 'It was not latched after a paper change or cleaning', next: 'Close the lid until it clicks, then resubmit the job' },
  2: { what: 'The printer is out of paper', why: 'This roll of labels has run out', next: 'Load a new roll, then press Resume on the queue page' },
  3: { what: 'Printer battery is low', why: 'There is not enough charge to finish printing', next: 'Connect the charger, then resubmit the job' },
  4: { what: 'Battery fault', why: 'The printer reports an abnormal battery state', next: 'Disconnect power, wait a few minutes, then switch on again; contact service if it repeats' },
  5: { what: 'Printing was cancelled', why: 'Someone pressed cancel on the printer itself', next: 'Check how many labels were produced, then resubmit the remainder' },
  6: { what: 'Bad print data', why: 'The printer could not parse what it received', next: 'This is a software defect — give the job id to whoever maintains this service' },
  7: { what: 'Print head overheated', why: 'Continuous printing raised the head above its safe temperature', next: 'Wait three to five minutes for it to cool, then continue' },
  8: { what: 'Paper feed fault', why: 'The paper may be jammed or loaded incorrectly', next: 'Open the lid, check the paper path, clear any jam and reload' },
  9: { what: 'The printer is busy', why: 'It is still working on another job', next: 'Retry shortly; if it persists, check whether someone is operating the printer directly' },
  10: { what: 'No print head detected', why: 'The printer cannot see its print head', next: 'Power off, reseat the print head, then power on again' },
  11: { what: 'Ambient temperature too low', why: 'Thermal printing needs the head above its minimum working temperature', next: 'Move the printer somewhere warmer and let it acclimatise before retrying' },
  12: { what: 'Print head is loose', why: 'The head is not locked in position', next: 'Open the lid, press the head down until it locks, then retry' },
  13: { what: 'No ribbon', why: 'This model needs a ribbon and none is loaded', next: 'Load a ribbon, then resubmit the job' },
  14: { what: 'Ribbon type mismatch', why: 'The loaded ribbon does not match what the job requires', next: 'Load the correct ribbon type, or adjust the profile to match' },
  15: { what: 'Ribbon used up', why: 'The ribbon has reached its end', next: 'Fit a new ribbon, then press Resume on the queue page' },
  16: { what: 'Paper type mismatch', why: 'The loaded stock does not match the paper type in the profile', next: 'Load matching stock, or change the paper type in the profile' },
  17: { what: 'Could not apply the paper setting', why: 'The printer rejected the paper type sent to it', next: 'Check the paper type in the profile, then retry' },
  18: { what: 'Could not apply the print mode', why: 'The printer rejected the print mode sent to it', next: 'Check the print mode in the profile, then retry' },
  19: { what: 'Could not apply the density setting', why: 'The printer rejected the density value sent to it', next: 'Set a density inside the range this model reports, then retry' },
  20: { what: 'RFID write failed', why: 'The printer could not write to the tag on this stock', next: 'Check the stock is genuine RFID media, then retry' },
  21: { what: 'Could not apply the margin setting', why: 'The printer rejected the margins sent to it', next: 'Reduce the margins in the profile, then retry' },
  22: { what: 'Communication fault', why: 'The link to the printer was disturbed mid-exchange', next: 'Check the cable or network, then retry' },
  23: { what: 'The printer disconnected', why: 'The connection dropped during the job', next: 'Check power and cabling, then resubmit the job' },
  24: { what: 'Bad canvas parameters', why: 'The label dimensions sent to the printer are outside what it accepts', next: 'Check the label size against the printer capabilities, then retry' },
  25: { what: 'Bad rotation parameter', why: 'The printer rejected the print direction sent to it', next: 'This is a software defect — give the job id to whoever maintains this service' },
  26: { what: 'Malformed parameter', why: 'A value sent to the printer was not in the expected format', next: 'This is a software defect — give the job id to whoever maintains this service' },
  27: { what: 'Paper feed fault (B3S family)', why: 'The paper may be jammed or loaded incorrectly', next: 'Open the lid, check the paper path, clear any jam and reload' },
  28: { what: 'Paper detection failed', why: 'The printer could not locate the label gap', next: 'Check that the stock matches the paper type in the profile, then retry' },
  29: { what: 'RFID tag not written', why: 'The job finished but the tag was left unwritten', next: 'Check the stock is genuine RFID media, then reprint the affected labels' },
  30: { what: 'This model cannot set density', why: 'The printer does not support a density command', next: 'Remove the density setting from the profile' },
  31: { what: 'This model cannot set the print mode', why: 'The printer does not support a print-mode command', next: 'Remove the print-mode setting from the profile' },
  32: { what: 'Bad label material setting', why: 'The printer rejected the label material sent to it', next: 'Check the label material in the profile, then retry' },
  33: { what: 'This model cannot set label material', why: 'The printer does not support a label-material command', next: 'Remove the label material setting from the profile' },
  34: { what: 'This model cannot write RFID', why: 'The printer has no RFID writer', next: 'Use a printer that supports RFID, or drop the RFID step' },
  50: { what: 'Invalid page data', why: 'The printer rejected the page it was sent', next: 'This is a software defect — give the job id to whoever maintains this service' },
  51: { what: 'Invalid ribbon page data', why: 'The printer rejected the ribbon page it was sent', next: 'This is a software defect — give the job id to whoever maintains this service' },
  52: { what: 'Timed out receiving data', why: 'The printer stopped acknowledging data mid-job', next: 'Check the cable or network, then resubmit the job' },
  53: { what: 'Non-genuine ribbon', why: 'The printer does not recognise the ribbon as its own brand', next: 'Fit a genuine ribbon, or accept reduced print quality if the model allows it' },
}

const APP: Readonly<Record<AppErrorCode, ErrorCopy>> = {
  PRINTER_UNREACHABLE: {
    what: 'Could not reach the printer',
    why: 'It is powered off, unplugged, or the address is wrong',
    next: 'Check power and cabling, confirm the address on the printer page, then retry',
  },
  PRINTER_HAS_QUEUED_JOBS: {
    what: 'This printer still has queued jobs',
    why: 'Removing it would strand work already accepted; moving its address would send the rest of a batch to another machine, or to nowhere',
    next: 'Wait for the queue to drain, or cancel the remaining jobs first',
  },
  JOB_ALREADY_PRINTING: {
    what: 'That job is already printing',
    why: 'It left the queue before this request arrived',
    next: 'Wait for it to finish, or cancel it from the queue page',
  },
  INSUFFICIENT_CONSUMABLE: {
    what: 'Not enough label stock to finish this job',
    why: 'The roll has fewer labels left than the job requests',
    next: 'Reduce the quantity, or fit a new roll and resubmit',
  },
  SEQUENCE_OVERFLOW: {
    what: 'The running number exceeds its digit count',
    why: 'The end of the range needs more digits than the field allows',
    next: 'Increase the digit count, or start from a smaller value',
  },
  FIELD_VALIDATION_FAILED: {
    what: 'A field value is not acceptable',
    why: 'It breaks the rules of the chosen barcode symbology, or falls outside the printable area',
    next: 'Correct the field content, then resubmit',
  },
  TEMPLATE_VERSION_CONFLICT: {
    what: 'This template was changed somewhere else',
    why: 'Someone saved a newer version while you were editing',
    next: 'Reload the template and reapply your changes — your current edits are still on screen',
  },
  DATA_SOURCE_READ_ONLY: {
    what: 'This data source is read-only here',
    why: 'Its rows come from a Google Sheet. An edit made here would be overwritten wholesale by the next refresh, with nothing said about it',
    next: 'Edit it in Google; to take the table over on this machine, unlink it first',
  },
  DATA_SOURCE_UNLINK_NOT_CONFIRMED: {
    what: 'Unlinking needs to be confirmed',
    why: 'Afterwards it can no longer be refreshed from Google and the origin cannot be restored. Every row is kept and becomes maintained here',
    next: 'Confirm that you want to take this table over, then submit again',
  },
  DATA_SOURCE_NOT_LINKED: {
    what: 'This data source is not linked to a spreadsheet',
    why: 'Its rows are maintained here rather than fetched from Google, so there is nothing to refresh',
    next: 'Edit its rows directly, or create a data source linked to a Google Sheet',
  },
  DATA_SOURCE_REFRESH_IN_PROGRESS: {
    what: 'This data source is already being refreshed',
    why: 'Two writers on one table would leave it half new and half old',
    next: 'Wait for the running refresh to finish and try again',
  },
  HTTP_SOURCE_UNREACHABLE: {
    what: 'Could not reach the system this table reads from',
    why: 'The address did not answer, or took longer than 30 seconds to',
    next: 'Check that the other system is running and that this machine can reach it, then refresh again. The rows already here are unchanged and still print',
  },
  HTTP_SOURCE_BAD_STATUS: {
    what: 'The system this table reads from refused the request',
    why: 'It answered with an error status rather than rows — commonly a credential it no longer accepts, or an address that no longer exists',
    next: 'Check the address and the headers on this data source. The rows already here are unchanged and still print',
  },
  HTTP_SOURCE_BAD_SHAPE: {
    what: 'The answer was not a table this can read',
    why: 'It has to be JSON carrying `columns` and `rows`, where every value is text and every row has exactly the declared columns',
    next: 'Show the detail below to whoever maintains the other system; the rows already here are unchanged and still print',
  },
  HTTP_SOURCE_DUPLICATE_KEY: {
    what: 'Two rows arrived with the same key',
    why: 'The key column is what tells one row from another across a refresh, so a repeated value leaves no way to say which row is which',
    next: 'Fix the duplicates in the other system, or point this data source at a column whose values are unique, then refresh again',
  },
  HTTP_SOURCE_MISSING_KEY: {
    what: 'A row arrived with nothing in its key column',
    why: 'A row with no key cannot be matched to the row it replaces, and dropping it would lose data nobody asked to lose',
    next: 'Fill the key column for every row in the other system, or choose a different key column, then refresh again',
  },
  HTTP_SOURCE_KEY_COLUMN_REQUIRED: {
    what: 'This data source needs a key column first',
    why: 'Refreshing before printing depends on a row keeping its identity across the refresh; without a key column a refresh can move the rows out from under a selection that was already made',
    next: 'Set a key column on this data source, then turn this on again',
  },
  DATA_SOURCE_NOT_FETCHABLE: {
    what: 'This data source is not fetched from anywhere',
    why: 'Its rows are maintained here rather than read from another system, so there is nothing to refresh',
    next: 'Edit its rows directly, or create a data source that reads from an address',
  },
  ROW_SELECTION_STALE_KEYS: {
    what: 'Some of the chosen rows are no longer there',
    why: 'They were removed from the other system since they were chosen, and printing the rest without saying so would leave a shortfall to find at counting time',
    next: 'Refresh the table and choose again',
  },
  GOOGLE_URL_INVALID: {
    what: 'That is not a Google Sheets link',
    why: 'No spreadsheet id could be found in it — it may be a Docs or Slides link, or a mistyped paste',
    next: 'Copy the full link from the spreadsheet address bar and try again',
  },
  GOOGLE_NOT_CONFIGURED: {
    what: 'No Google identity is configured on this machine',
    why: 'The server has no credentials file, so it cannot read spreadsheets as anybody',
    next: 'Ask whoever deploys this to set ZENITH_GOOGLE_CREDENTIALS to a service-account key and restart',
  },
  GOOGLE_NOT_SHARED: {
    what: 'This spreadsheet cannot be read',
    why: 'It has not been shared with this machine\u2019s identity',
    next: 'Open Share in the spreadsheet and give that address Viewer access, then try again',
  },
  GOOGLE_SPREADSHEET_NOT_FOUND: {
    what: 'That spreadsheet could not be found',
    why: 'It may have been deleted, or the link points at an id that does not exist — or it was never shared with this machine',
    next: 'Check the spreadsheet still exists and has been shared with the address above',
  },
  GOOGLE_CREDENTIALS_INVALID: {
    what: 'Google refused this machine\u2019s identity',
    why: 'The credentials are invalid, expired, or the service account was disabled. This is a credentials problem, not a spreadsheet problem',
    next: 'Ask whoever deploys this to check the credentials file and reissue the key if needed',
  },
  GOOGLE_RATE_LIMITED: {
    what: 'Google turned this request away for now',
    why: 'Too many requests in a short window',
    next: 'Wait a moment and try again',
  },
  GOOGLE_UNREACHABLE: {
    what: 'Google could not be reached',
    why: 'The network is down, or the request timed out',
    next: 'Check this machine\u2019s internet connection. Data already fetched is unaffected and can still be printed',
  },
  GOOGLE_WORKSHEET_NOT_FOUND: {
    what: 'That worksheet could not be found',
    why: 'It may have been deleted in Google',
    next: 'Check the worksheet still exists, or pick another one',
  },
  GOOGLE_WORKSHEET_EMPTY: {
    what: 'That worksheet is empty',
    why: 'It has no rows at all, so there are no column names to read',
    next: 'Put column names in the first row and at least one data row, then try again',
  },
  TEMPLATE_FILE_INVALID: {
    what: 'This is not a template file this program can read',
    why: 'The file is not in the format this program exports, or its contents are damaged',
    next: 'Check that you picked a .json file produced by Templates → Export, and try again',
  },
  TEMPLATE_FILE_TOO_NEW: {
    what: 'This file comes from a newer version of the program',
    why: 'Its format version is higher than this machine can read, so part of its meaning would be lost',
    next: 'Upgrade this machine, or ask for an export from the version you are running',
  },
  TEMPLATE_ALREADY_EXISTS: {
    what: 'The file contains designs that are already on this machine',
    why: 'This design was imported before, or this file is its backup',
    next: 'Choose to overwrite the existing designs, or keep them and save copies',
  },
  QUEUE_PAUSED: {
    what: "This printer's queue is paused",
    why: 'The previous job failed, or someone paused it manually',
    next: 'Clear the fault, then press Resume on the queue page',
  },
  IMAGE_PRUNE_UNREADABLE_DESIGN: {
    what: 'Cannot prune images: one stored design could not be read',
    why: 'A template or print record holds content that no longer parses, so which images are still in use cannot be determined',
    next: 'The whole sweep was cancelled and nothing was deleted. Send the matching server log line to whoever maintains this',
  },
  PROFILE_PRINTER_MISMATCH: {
    what: 'Those settings belong to a different printer',
    why: 'Density and label type mean something only against a particular print head, so settings are kept per printer',
    next: "Pick settings that belong to the chosen printer, or switch back to the printer they were saved for",
  },
  DEVICE_ERROR: {
    what: 'The printer refused the operation',
    why: 'It is connected but did not respond as expected; firmware or state may be at fault',
    next: 'Power cycle the printer and retry; if it repeats, note the model and firmware version',
  },
  RENDER_FAILED: {
    what: 'Label rendering failed',
    why: 'The service errored while producing the print image',
    next: 'This is a software defect — give the job id to whoever maintains this service',
  },
  JOB_INTERRUPTED_BY_RESTART: {
    what: 'The job was interrupted by a service restart; the printed count is unknown',
    why: 'The service restarted mid-print and cannot confirm how many labels came out',
    next: 'Count the labels actually produced, then decide how many to reprint',
  },
  CONFIRMATION_REQUIRED: {
    what: 'This action prints physical labels',
    why: 'Printing consumes stock and cannot be undone',
    next: 'Confirm once you are ready to spend the labels',
  },
  CALIBRATION_STOCK_UNKNOWN: {
    what: 'The size of the calibration page is unknown',
    why: 'It is measured against the edges of the paper, so it has to be the size of the paper — and this printer has no profile recording a stock size',
    next: 'Create a profile with the stock width and height on the printer page, then print the calibration page',
  },
  VALIDATION_FAILED: {
    what: 'The request is not valid',
    why: 'The submitted data failed validation',
    next: 'Correct the highlighted fields and retry',
  },
  NOT_FOUND: {
    what: 'The requested item does not exist',
    why: 'It may have been deleted',
    next: 'Refresh the page and try again',
  },
  INTERNAL_ERROR: {
    what: 'Internal service error',
    why: 'Something unexpected went wrong',
    next: 'Give the time of the action to whoever maintains this service so they can check the logs',
  },
  CSV_NO_HEADER: {
    what: 'The CSV file has no usable header row',
    why: 'The first row contains a blank column name',
    next: 'Give every column a name in the first row and upload again',
  },
  CSV_DUPLICATE_COLUMN: {
    what: 'The CSV header has duplicate column names',
    why: 'A duplicate name leaves ${column} with no way to say which column it means',
    next: 'Give the duplicated columns distinct names and upload again',
  },
  CSV_TOO_MANY_ROWS: {
    what: 'The CSV has more rows than one data source may hold',
    why: 'A single data source is limited to 10,000 rows',
    next: 'Split the file, or filter out the rows you do not need first',
  },
  CSV_DECODE_FAILED: {
    what: 'The character encoding of the CSV could not be determined',
    why: 'UTF-8, GB18030 and Big5 all decoded to mojibake',
    next: 'Pick the encoding by hand in the upload dialog and retry',
  },
  DATA_SOURCE_NAME_TAKEN: {
    what: 'That data source name is already in use',
    why: 'The name is how a data source is picked from a list; duplicates cannot be told apart',
    next: 'Choose a different name and retry',
  },
  DATA_SOURCE_COLUMNS_REMOVED: {
    what: 'The new file is missing columns that designs still reference',
    why: 'Those references would lose their values once the table is replaced',
    next: 'Confirm to replace anyway, or add the missing columns and upload again',
  },
  DATA_SOURCE_UNKNOWN_COLUMN: {
    what: 'A column that this table does not have',
    why: 'Column names are reference names; they cannot be conjured up',
    next: 'To add a column, upload a CSV that contains it',
  },
  NO_ROWS_SELECTED: {
    what: 'No rows are selected',
    why: 'The design references a data source, and each row is one label',
    next: 'Tick the rows you want to print in the row selection panel',
  },
  BATCH_TOO_LARGE: {
    what: 'This job would print more labels than one job may hold',
    why: 'Selected rows times copies exceeds 1000 labels',
    next: 'Reduce the rows or the copies and submit in several batches',
  },
  VARIABLE_NOT_DEFINED: {
    what: 'The content contains a reference that cannot be resolved',
    why: 'That name is neither a variable defined in the design nor a column of the bound data source',
    next: 'Define it in the variables panel, or change it to an existing name',
  },
  VARIABLE_NAME_COLLIDES: {
    what: 'A variable name is also a column of the bound data source',
    why: 'One name pointing at two values leaves no way to say which is meant',
    next: 'Rename the variable, or use the column value instead',
  },
  SEQUENCE_POOL_IN_USE: {
    what: 'Designs still reference this sequence pool',
    why: 'Deleting it would leave their sequence variables with no value',
    next: 'Point those designs at another pool, or make the variable a constant',
  },
  ROW_SELECTION_STALE: {
    what: 'Some of the selected rows no longer exist',
    why: 'They were deleted between selecting them and submitting',
    next: 'Select the rows to print again',
  },
  BARCODE_EMPTY_VALUE: {
    what: 'A column used by a barcode is empty in some selected rows',
    why: 'Barcode content cannot be empty; those rows would fail mid-batch',
    next: 'Fill in those cells, or untick those rows',
  },
  SEQUENCE_RESET_NOT_CONFIRMED: {
    what: 'Resetting a sequence pool needs confirmation',
    why: 'Restarting below a number already printed reissues it, and two boxes with the same serial cannot be told apart afterwards',
    next: 'Confirm to continue; spans already issued stay on record',
  },
  DATA_SOURCE_DELETE_NOT_CONFIRMED: {
    what: 'Deleting a data source needs confirmation',
    why: 'The rows in this table are deleted and cannot be recovered',
    next: 'Confirm to continue; designs using it are not deleted but will show a warning until rebound to another table of the same shape',
  },
}

export const EN_US: LocaleBundle = { device: DEVICE, app: APP }
