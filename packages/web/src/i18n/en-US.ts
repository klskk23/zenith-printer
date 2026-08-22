/**
 * Frontend copy, English.
 *
 * Mirrors `zh-CN.ts` key for key. `Copy` is derived from the Chinese bundle, so
 * a key added there and forgotten here is a compile error rather than a blank
 * label at runtime.
 *
 * Server errors are deliberately absent — they arrive already worded and are
 * shown verbatim, in whichever language the request asked for. One fault never
 * gets two descriptions.
 */
import type { Copy } from './types.ts'

export const copy: Copy = {
  app: {
    title: 'Zenith Printer',
    subtitle: 'Label design and printing',
  },
  connection: {
    connecting: 'Connecting…',
    connected: 'Connected',
    disconnected: 'Not connected',
  },
  networkError: {
    what: 'Cannot reach the print service',
    why: 'The service may have stopped, or the network is down',
    next: 'Check the service is running, then reload the page',
  },

  nav: {
    editor: 'Label design',
    printers: 'Printers',
  },

  workspace: {
    tabs: {
      index: 'Home',
      design: 'Label design',
      templates: 'Templates',
      printers: 'Printers',
      queue: 'Print queue',
      history: 'Print history',
      settings: 'Settings',
      'data-sources': 'Data sources',
      'data-source': 'Data source',
    },
    untitledDesign: 'Untitled design',
    close: 'Close',
    unsavedMark: 'Unsaved changes',
    confirmCloseTitle: 'Close this tab?',
    confirmCloseBody: 'This tab has unsaved changes. Closing it cannot be undone.',
    confirmCloseCancel: 'Cancel',
    confirmCloseConfirm: 'Close anyway',
    leavePrompt: 'There are unsaved changes. Leave anyway?',
    softLimitWarning:
      'Ten tabs are open. Opening more may make editing less responsive, but nothing is stopping you.',
    disconnectedBanner:
      'Disconnected from the print service. Editing continues, but saving and printing will fail.',
  },

  index: {
    printerSection: 'Printers',
    templateSection: 'Recent templates',
    recentJobsSection: 'Recent prints',
    managePrinters: 'Manage printers',
    allTemplates: 'Templates',
    allHistory: 'Print history',
    noPrinters: 'No printers added yet',
    noTemplates: 'No saved templates yet',
    noRecentJobs: 'Nothing printed yet',
    queueRunning: 'Queue running',
    queuePaused: 'Queue paused',
    pendingJobs: (n: number) => `${n} job${n === 1 ? '' : 's'} pending`,
    remaining: (n: number) => `${n} labels left`,
    remainingUnsupported: 'This model cannot report remaining stock',
    online: 'Online',
    offline: 'Offline',
    unknownState: 'State unknown',
    resubmit: 'Resubmit',
  },

  printers: {
    heading: 'Printers',
    empty: 'No printers added yet',
    add: 'Add printer',
    probe: 'Probe',
    probing: 'Probing…',
    remove: 'Remove printer',
    confirmRemove: 'Remove this printer?',
    notProbed: 'Not probed yet',
    fields: {
      name: 'Name',
      kind: 'Kind',
      transport: 'Connection',
      address: 'Address',
      printTaskName: 'Print task',
    },
    edit: 'Edit connection',
    manageProfiles: 'Print profiles',
    addressChangeClearsProbe:
      'The address changed, so the probed device settings will be cleared — they describe whatever was at the old address. Probe again after saving.',
    hints: {
      printTaskName:
        'B3S_P uses B1. Valid values: D11_V1 / D110 / B1 / B21_V1 / B21_L2B / D110M_V4 / H1S',
      serialAddress: 'e.g. /dev/ttyACM0',
      tcpAddress: 'e.g. 192.168.1.50:9100',
    },
    capabilities: {
      heading: 'Capabilities (from probing)',
      dpi: 'Resolution',
      maxWidth: 'Maximum print width',
      density: 'Density range',
      consumable: 'Reports remaining stock',
      supported: 'Supported',
      unsupported: 'Not supported',
      unsupportedHint:
        'This model gives no warning before running out, so a job can stop mid-batch',
      model: 'Model',
      firmware: 'Firmware',
    },
    queue: {
      running: 'Queue running',
      paused: 'Queue paused',
      pause: 'Pause queue',
      resume: 'Resume queue',
    },
  },

  editor: {
    layers: {
      heading: 'Layers',
      empty: 'Nothing on the canvas yet',
      toFront: 'Bring to front',
      toBack: 'Send to back',
    },
    zoom: {
      label: 'Zoom',
      hint: 'Alt + scroll to zoom',
    },
    contextMenu: {
      delete: 'Delete',
      copy: 'Copy',
      paste: 'Paste',
      duplicate: 'Duplicate',
      toFront: 'Bring to front',
      toBack: 'Send to back',
    },
    undo: 'Undo',
    redo: 'Redo',
    moduleWidth: 'Module width',
    moduleWidthHint: (dots: number, mm: number) => `${dots} dot = ${mm.toFixed(3)} mm`,
    atMinModuleWidth: 'Already the smallest scannable size; it cannot go lower',
    derivedWidth: 'Width (follows the module width)',
    variableWidthHint:
      'Content comes from a variable field, so the printed width changes with each label',
    rotation: 'Rotation',
    filled: 'Filled',
    heading: 'Label design',
    properties: 'Properties',
    canvas: 'Canvas',
    canvasWidth: 'Width',
    canvasHeight: 'Height',
    addElement: 'Add element',
    noSelection: 'Select an element to edit its properties',
    elements: {
      text: 'Text',
      barcode: 'Barcode',
      qrcode: 'QR code',
      image: 'Image',
      line: 'Line',
      rect: 'Rectangle',
      ellipse: 'Ellipse',
    },
    fields: {
      content: 'Content',
      x: 'X',
      y: 'Y',
      x2: 'End X',
      y2: 'End Y',
      width: 'Width',
      height: 'Height',
      rotation: 'Rotation',
      fontFamily: 'Font',
      fontSize: 'Size',
      bold: 'Bold',
      align: 'Align',
      symbology: 'Symbology',
      showHumanReadable: 'Show text below',
      strokeWidth: 'Stroke',
      filled: 'Filled',
      cornerRadius: 'Corner radius',
      errorCorrection: 'Error correction',
      image: 'Image',
      rotationDegrees: (degrees: number): string => `${degrees}°`,
    },
    image: {
      choose: 'Choose image…',
      replace: 'Replace image…',
      notChosen: 'No image chosen yet',
      uploading: 'Uploading…',
      pasteHint: 'Or press Ctrl+V to paste an image from the clipboard',
      rejectedType: 'Only PNG and JPEG images are supported',
      rejectedSize: (maxMb: number): string => `Image is over the ${maxMb} MB limit`,
    },
    align: { left: 'Left', center: 'Centre', right: 'Right' },
    fonts: { sans: 'Sans', serif: 'Serif', mono: 'Monospace' },
    units: {
      mm: 'mm',
      dots: 'dot',
      dotsSuffix: (dots: number, mm: number): string => `${dots} dot (${mm.toFixed(3)} mm)`,
    },
    delete: 'Delete element',
    duplicate: 'Duplicate element',
  },

  violations: {
    CANVAS_TOO_WIDE: (v: Record<string, number | string>): string =>
      `The canvas is ${v.widthMm}mm wide, beyond this printer's maximum of ${v.maxWidthMm}mm`,
    STROKE_TOO_THIN: (v: Record<string, number | string>): string =>
      `A stroke thinner than one dot disappears when printed. The minimum is ${v.minWidthMm}mm (1 dot)`,
    BARCODE_CONTENT_EMPTY: (): string => 'The barcode has no content',
    IMAGE_NOT_CHOSEN: (): string => 'No image has been chosen for this element',
  },

  preview: {
    heading: 'Print preview',
    refresh: 'Refresh preview',
    loading: 'Rendering…',
    clipped: 'The red region falls outside the canvas and will not be printed',
    hint: 'This is the thresholded image as it will print — fine lines and pale tones vanish here',
    firstOfMany: (copies: number) => `${copies} labels; this is the first`,
    needsFields: 'Fill in the fields above to preview',
    needsTemplateForSequence:
      'Sequence fields need the design saved as a template first: a sequence carries on across print runs, and an unsaved design has nothing to carry on from.',
    failed: 'Could not render a preview',
  },

  print: {
    action: 'Print',
    heading: 'Confirm printing',
    warning: 'Printing consumes stock and cannot be undone. Check the content and the quantity.',
    printer: 'Printer',
    copies: 'Copies',
    confirm: 'Print',
    cancel: 'Cancel',
    submitting: 'Submitting…',
    queued: 'Added to the queue',
    queuedDetail: (jobId: string): string => `Job ${jobId}`,
    batchTooLarge: (labels: number, max: number): string =>
      `This batch is ${labels} labels, above the per-job limit of ${max}. Reduce the rows or copies and submit in several batches`,
    needsProbe: 'This printer has not been probed, so its printable area is unknown',
  },

  dataSources: {
    heading: 'Data sources',
    explain:
      'A data source is one table. A design binds to one of them and references its columns as ${column} inside content.',
    empty: 'No data sources yet. Upload a CSV, or copy a block of cells from a spreadsheet and paste it in',
    upload: 'Upload CSV',
    uploading: 'Importing…',
    uploadProgress: (done: number, total: number): string => `parsed ${done} of ${total} rows`,
    name: 'Name',
    rename: 'Rename',
    renameHint: 'Renaming affects no references: designs bind by id, and column references use only the column name',
    columns: 'Columns',
    rowCount: (n: number): string => `${n} rows`,
    columnList: (names: string[]): string => names.join(', '),
    open: 'Edit',
    replace: 'Replace',
    delete: 'Delete',
    encoding: 'Character encoding',
    encodingAuto: 'Detect',
    delimiter: 'Separator',
    delimiterAuto: 'Detect',
    detected: (encoding: string, delimiter: string): string =>
      `decoded as ${encoding}, separated by ${delimiter === '\t' ? 'tab' : delimiter}`,
    retryHint: 'If the text is mojibake, or a whole row landed in one column, set these by hand and retry',
    deleteTitle: (name: string): string => `Delete "${name}"?`,
    deleteWarning:
      'The rows in this table are deleted and cannot be recovered. Designs using it are not deleted, but will show a warning — rebind them to another table of the same shape to fix them.',
    deleteAffected: (names: string[]): string => `Designs using it: ${names.join(', ')}`,
    deleteConfirm: 'Delete',
    replaceTitle: 'Replacing would remove columns',
    replaceWarning: (columns: string[], templates: string[]): string =>
      `The new file has no: ${columns.join(', ')}. These designs reference them and would break: ${templates.join(', ')}`,
    replaceConfirm: 'Replace anyway',
    addRow: 'Add row',
    deleteRow: 'Delete this row',
    pasteHint: 'Select a cell and press Ctrl+V to paste a block copied from a spreadsheet',
    pasteTooWide: (needed: number, available: number): string =>
      `The pasted block is ${needed} columns wide; only ${available} remain from here. Column names are reference names and cannot be conjured up — upload a CSV to add columns`,
    page: (page: number, total: number): string => `Page ${page} of ${total}`,
    prev: 'Previous',
    next: 'Next',
    bindingMissing: 'The bound data source has been deleted',
    bindingColumns: (columns: string[]): string => `The bound data source has no: ${columns.join(', ')}`,
    gridHint: 'Works like a spreadsheet: arrow keys to move, shift+arrows to select a range, Ctrl+A for everything, Ctrl+C to copy, Ctrl+V to paste. Blocks copied from Google Sheets or Excel paste straight in; rows past the end are appended, columns past the last are refused — a column name is a reference name and cannot be conjured up.',
    patchFailed: 'That change was not saved. Check and retry; the grid is showing your local edit, which may differ from the server.',
    rebindHint: 'Pick another table of the same shape in the design properties to fix it',
  },

  rowSelection: {
    heading: 'Rows to print',
    selectAll: (n: number): string => `Select all (${n} rows)`,
    clear: 'Clear selection',
    rangeLabel: 'Row range',
    rangePlaceholder: 'e.g. 5-12',
    rangeApply: 'Apply',
    rangeInvalid: 'Cannot read that range. Write it as 5-12, or 5-12, 20',
    selected: (rows: number, labels: number): string => `${rows} rows selected, ${labels} labels`,
    none: 'No rows selected. This design uses a data source, and each row is one label',
    widthNotChecked:
      'Content width is not checked per row — a barcode on some rows may run past the label edge, which only the printed labels will show',
    ordinal: 'Row',
  },
  pools: {
    heading: 'Sequence pools',
    explain:
      'A pool exists in its own right and can be shared between designs — a box label and a carton label running off one series of numbers. The current value is derived from what was printed, never stored separately.',
    empty: 'No pools yet. Create one, then pick it in a design\'s variables panel',
    name: 'Name',
    digits: 'Digits',
    add: 'Create',
    reset: 'Reset',
    delete: 'Delete',
    nextIs: (value: string): string => `next ${value}`,
    resetTo: (floor: string): string => `Restart at (last restarted from ${floor})`,
    resetTitle: (name: string): string => `Restart numbering for "${name}"?`,
    resetWarning:
      'Restarting below a number that has already been printed will reissue it, and two boxes carrying the same serial cannot be told apart afterwards. Spans already issued stay on record. This cannot be undone.',
    resetConfirm: 'Restart numbering',
    deleteTitle: (name: string): string => `Delete "${name}"?`,
    deleteWarning:
      'Spans already issued stay on record, because those numbers are on physical labels. A pool still referenced by a design cannot be deleted.',
    deleteConfirm: 'Delete',
    deleteRefused: 'Designs still reference it. Point them at another pool, or make the variable a constant.',
  },
  variables: {
    heading: 'Variables',
    empty: 'No variables yet. Once defined, reference one as ${name} inside text, barcode or QR content',
    name: 'Variable name',
    value: 'Fixed value',
    pool: 'Sequence pool',
    remove: 'Remove',
    addConstant: 'Add constant',
    addSequence: 'Add sequence',
    newPool: 'New pool',
    referenceHint: (name: string): string => `Reference it as \${${name}} in content`,
    poolOption: (name: string, next: number, digits: number): string =>
      `${name} (next ${String(next).padStart(digits, '0')})`,
    collides: (name: string): string =>
      `"${name}" is also a column of the bound data source. One name pointing at two values leaves no way to say which is meant — rename one of them`,
    unresolved: (names: string): string =>
      `Content references names that nothing defines: ${names}. Define them here, or use a column name from the data source`,
  },

  templates: {
    heading: 'Templates',
    empty: 'No saved templates yet',
    save: 'Save as template',
    saveAs: 'Save as new',
    update: 'Save',
    load: 'Load',
    remove: 'Delete',
    confirmRemove: 'Delete this template? Printed history is unaffected.',
    name: 'Template name',
    conflict:
      'Someone else has changed this template. Reload before saving, or their work will be overwritten.',
    reload: 'Reload',
    boundKind: 'Printer kind',
    searchPlaceholder: 'Search template names',
    open: 'Open',
    confirmDelete: 'Delete this template? Printed history is unaffected.',
    fieldCount: (n: number) => (n === 0 ? 'No variable fields' : `${n} variable field${n === 1 ? '' : 's'}`),
  },

  settings: {
    heading: 'Settings',
    scopeNote:
      'These settings affect this browser only and nobody else. Server configuration (dry-run mode, log level and so on) belongs to the deployment and is deliberately not offered here.',
    language: 'Interface language',
    languageNames: { 'zh-CN': '中文', 'en-US': 'English' },
    defaultSize: 'Default size for new labels',
    defaultWidth: 'Width',
    defaultHeight: 'Height',
    defaultDpi: 'Resolution',
    defaultFont: 'Default font',
    displayUnit: 'Size unit',
    displayUnits: { mm: 'Millimetres', dot: 'Dots' },
    theme: 'Theme',
    themes: { light: 'Light', dark: 'Dark', system: 'Follow system' },
    pollInterval: 'Queue refresh interval (ms)',
    alwaysConfirmTabClose: 'Always confirm before closing a tab',
    unsaved: 'Unsaved changes',
    localOnlyHint:
      'Another browser starts from the defaults — there are no accounts, so there is nobody to remember.',
  },

  offset: {
    stock: 'Calibration stock',
    heading: 'Position correction',
    up: 'Move up',
    right: 'Move right',
    down: 'Move down',
    left: 'Move left',
    unit: 'dot',
    hint: 'Expect to re-measure this after every paper change, even with identical stock.',
    printCalibration: 'Print calibration page',
    confirmTitle: 'Print a calibration page?',
    confirmBody: 'This prints a real label and consumes stock. It cannot be undone.',
    confirmSize: (w: number, h: number) => `It will print at ${w}×${h}mm.`,
    needsProfile: 'No profile records a stock size yet. The calibration page is measured against the edges of the paper, so it has to be the same size — create a profile with the stock width and height first.',
    confirmCancel: 'Cancel',
    confirmPrint: 'Print',
    save: 'Save correction',
    saved: 'Correction saved',
  },

  overflow: {
    heading: 'These labels have content past the edge',
    note: 'The overhang will be clipped. You can print anyway, or change it and try again.',
    row: (index: number) => `Label ${index + 1}`,
    reasons: {
      ELEMENT_OUT_OF_BOUNDS: 'Element extends past the label',
      BARCODE_TOO_WIDE: 'Barcode is wider than the space available',
    },
    widths: (actual: number, available: number) => `${actual} mm / ${available} mm available`,
    inHistory: 'Some content was clipped on this run',
  },

  profiles: {
    heading: 'Print settings',
    empty: 'No print settings yet; the probed defaults will be used',
    add: 'New settings',
    name: 'Name',
    labelWidth: 'Stock width',
    labelHeight: 'Stock height',
    margins: 'Margins',
    marginLinked: 'Same on all sides',
    marginTop: 'Top',
    marginRight: 'Right',
    marginBottom: 'Bottom',
    marginLeft: 'Left',
    marginHint: 'Margins are advice; nothing stops you placing elements inside them.',
    canvasFollowsProfile:
      'Choosing these settings resizes the canvas to the stock. Existing elements stay where they are.',
    noProfileSelected: 'No print settings chosen, so no margins are shown.',
    density: 'Density',
    labelType: 'Media type',
    threshold: 'Black/white cut-off',
    thresholdHint:
      'Pixels darker than this are printed. 128 is the midpoint and suits black-on-white artwork. Raising it rescues pale shapes and hairlines, at the cost of fattening every stroke on the label.',
    halftone: 'Image tone',
    halftoneHint:
      'Images only. Text and barcodes always use a hard threshold — dithering them frays the strokes and drops stray dots into a barcode’s quiet zones.',
    halftoneModes: {
      none: 'None (hard threshold)',
      'floyd-steinberg': 'Error diffusion (photos)',
      ordered: 'Ordered screen (survives heat spread)',
    },
    offsetX: 'Horizontal offset',
    offsetY: 'Vertical offset',
    isDefault: 'Make default',
    isDefaultHint: 'The default is selected automatically when this printer is chosen, and the calibration page prints at its stock size. One per printer.',
    remove: 'Delete',
    confirmRemove: (name: string) => `Delete the print settings "${name}"? Printed history is unaffected.`,
    offsetHint: 'Adjusted in dots; the preview shows the corrected result, so no test print is needed',
    densityHint: (min: number, max: number): string => `This model supports ${min} – ${max}`,
  },

  printForm: {
    heading: 'Fill in the fields',
    range: (start: string, end: string, copies: number): string =>
      `This run uses ${start} – ${end}, ${copies} numbers in total`,
    overflow: (end: number, max: number, digits: number): string =>
      `This run would reach ${end}, beyond the ${max} that ${digits} digits can express. Add digits, or start lower.`,
    overrideHint:
      'Continues from the last print by default; to reprint a spoiled batch, set the original start value',
    conflict: (start: string, suggested: string): string =>
      `Start ${start} is below the suggested ${suggested}; this range has been printed before. Fine when reprinting a spoiled batch, otherwise you will produce duplicates.`,
  },

  jobs: {
    heading: 'Print queue',
    empty: 'The queue is empty',
    adHoc: 'No template (one-off design)',
    template: 'Template',
    time: 'Time',
    copies: (n: number) => `${n} labels`,
    cancel: 'Cancel',
    status: {
      queued: 'Queued',
      printing: 'Printing',
      completed: 'Completed',
      failed: 'Failed',
      cancelled: 'Cancelled',
    },
    progress: (printed: number, total: number): string => `${printed} of ${total} printed`,
    progressUnknown: (total: number): string => `Printed count unknown, of ${total}`,
    countManually:
      'The service restarted mid-print, so the number actually produced cannot be confirmed. Count the labels before deciding how many to reprint.',
    paused: {
      heading: (printer: string) => `${printer}'s print queue is paused`,
      note: 'Queued jobs will not start until you resume it. Clear the fault first.',
      reasons: {
        JOB_INTERRUPTED_BY_RESTART:
          'The previous job was interrupted by a service restart; the printed count is unknown.',
        DEVICE_LACK_PAPER: 'The previous job failed because the printer ran out of paper.',
        DEVICE_COVER_OPEN: 'The previous job failed because the lid was open.',
        PRINTER_UNREACHABLE: 'The previous job failed because the printer could not be reached.',
      } as Record<string, string>,
    },
    reprint: {
      action: 'Reprint',
      heading: 'Reprint this job',
      unknownCount:
        'How many were printed cannot be confirmed. Count the labels produced and enter how many are still needed.',
      knownCount: (printed: number, total: number) =>
        `${printed} of ${total} were printed. The shortfall is filled in by default; adjust it if you need to.`,
      confirm: (copies: number) => `Print ${copies}`,
    },
  },

  history: {
    heading: 'Print history',
    empty: 'Nothing finished yet',
    adHoc: 'Unsaved label',
    expand: (total: number): string => `Show all ${total}`,
    collapse: 'Show fewer',
  },

  images: {
    heading: 'Images',
    upload: 'Upload image',
    uploading: 'Uploading…',
    empty: 'No images uploaded yet',
    remove: 'Delete',
    tooLarge: 'That image is too large; compress it and try again',
    unsupported: 'Unsupported image format; use PNG or JPEG',
  },

  common: {
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    confirm: 'Confirm',
    confirmTitle: 'Confirm this action?',
    loading: 'Loading…',
    retry: 'Retry',
    error: 'Something went wrong',
  },
}
