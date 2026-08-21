/**
 * Frontend copy, Simplified Chinese.
 *
 * Constitution Principle IV: the only place in the frontend where non-English
 * string literals live. Keys stay English.
 *
 * Server errors are deliberately absent — they arrive already worded in the
 * four-field response shape and are shown verbatim, so one fault never gets two
 * different descriptions.
 */
export const copy = {
  app: {
    title: 'Zenith Printer',
    subtitle: '标签设计与打印',
  },
  connection: {
    connecting: '正在连接服务…',
    connected: '服务已连接',
    disconnected: '服务未连接',
  },
  networkError: {
    what: '无法连接到打印服务',
    why: '服务可能已停止，或网络中断',
    next: '确认服务正在运行后刷新页面重试',
  },

  nav: {
    editor: '标签设计',
    printers: '打印机',
  },

  workspace: {
    tabs: {
      index: '首页',
      design: '标签设计',
      templates: '模板库',
      printers: '打印机',
      queue: '打印队列',
      history: '打印历史',
      settings: '设置',
    },
    untitledDesign: '未命名设计',
    close: '关闭',
    unsavedMark: '有未保存的修改',
    confirmCloseTitle: '关闭这个标签页？',
    confirmCloseBody: '该标签页有未保存的修改，关闭后无法恢复。',
    confirmCloseCancel: '取消',
    confirmCloseConfirm: '仍然关闭',
    leavePrompt: '有未保存的修改，确定要离开吗？',
    softLimitWarning: '已打开 10 个标签页。继续开启可能影响编辑流畅度，但不会被阻止。',
    disconnectedBanner: '与打印服务的连接已断开。编辑不会中断，但保存和打印会失败。',
  },

  index: {
    printerSection: '打印机状态',
    templateSection: '最近模板',
    recentJobsSection: '最近打印',
    managePrinters: '管理打印机',
    allTemplates: '模板库',
    allHistory: '打印历史',
    noPrinters: '还没有添加打印机',
    noTemplates: '还没有保存的模板',
    noRecentJobs: '还没有打印记录',
    queueRunning: '队列运行中',
    queuePaused: '队列已暂停',
    pendingJobs: (n: number) => `${n} 个待处理任务`,
    remaining: (n: number) => `余量 ${n} 张`,
    // The two printer families differ here and the difference is the user's to
    // know: a model that cannot count its stock stops mid-batch with no warning.
    remainingUnsupported: '本机型无法上报余量',
    online: '在线',
    offline: '离线',
    unknownState: '状态未知',
    resubmit: '重新提交',
  },

  printers: {
    heading: '打印机',
    empty: '还没有添加打印机',
    add: '添加打印机',
    probe: '探测',
    probing: '正在探测…',
    remove: '删除打印机',
    confirmRemove: '确定删除这台打印机吗？',
    notProbed: '尚未探测',
    fields: {
      name: '名称',
      kind: '类型',
      transport: '接入方式',
      address: '地址',
      printTaskName: '打印任务',
    },
    edit: '编辑连接',
    manageProfiles: '打印参数',
    addressChangeClearsProbe: '地址变了，已探测的设备参数会被清空——它们描述的是旧地址上的那台机器。保存后请重新探测。',
    hints: {
      // The single most consequential piece of guidance in the whole app.
      printTaskName: 'B3S_P 请填 B1。可选值：D11_V1 / D110 / B1 / B21_V1 / B21_L2B / D110M_V4 / H1S',
      serialAddress: '例如 /dev/ttyACM0',
      tcpAddress: '例如 192.168.1.50:9100',
    },
    capabilities: {
      heading: '设备能力（探测所得）',
      dpi: '分辨率',
      maxWidth: '最大打印宽度',
      density: '浓度范围',
      consumable: '耗材余量上报',
      supported: '支持',
      unsupported: '不支持',
      // FR-016: the user must know this model cannot warn them in advance.
      unsupportedHint: '该机型无法提前预警缺料，打印中途可能因缺纸中断',
      model: '型号',
      firmware: '固件',
    },
    queue: {
      running: '队列运行中',
      paused: '队列已暂停',
      pause: '暂停队列',
      resume: '恢复队列',
    },
  },

  editor: {
    layers: {
      heading: '图层',
      empty: '画布上还没有元素',
      toFront: '置顶',
      toBack: '置底',
    },
    zoom: {
      label: '缩放',
      hint: 'Alt + 滚轮可缩放',
    },
    contextMenu: {
      delete: '删除',
      copy: '复制',
      paste: '粘贴',
      duplicate: '创建副本',
      toFront: '置顶',
      toBack: '置底',
    },
    undo: '撤销',
    redo: '重做',
    moduleWidth: '模块宽度',
    moduleWidthHint: (dots: number, mm: number) => `${dots} dot = ${mm.toFixed(3)} mm`,
    atMinModuleWidth: '已是可扫描的最小尺寸，无法再缩小',
    derivedWidth: '宽度（由模块宽度决定）',
    variableWidthHint: '内容来自可变字段，实际宽度随每张标签的内容变化',
    rotation: '旋转',
    filled: '填充',
    heading: '标签设计',
    properties: '元素属性',
    canvas: '画布',
    canvasWidth: '宽度',
    canvasHeight: '高度',
    addElement: '添加元素',
    noSelection: '选中一个元素以编辑其属性',
    elements: {
      text: '文字',
      barcode: '条码',
      qrcode: '二维码',
      image: '图片',
      line: '直线',
      rect: '矩形',
      ellipse: '椭圆',
    },
    fields: {
      content: '内容',
      x: 'X 坐标',
      y: 'Y 坐标',
      x2: '终点 X',
      y2: '终点 Y',
      width: '宽度',
      height: '高度',
      rotation: '旋转',
      fontFamily: '字体',
      fontSize: '字号',
      bold: '加粗',
      align: '对齐',
      symbology: '码制',
      showHumanReadable: '显示可读字符',
      strokeWidth: '线宽',
      filled: '填充',
      cornerRadius: '圆角',
      errorCorrection: '纠错级别',
      image: '图片',
      rotationDegrees: (degrees: number): string => `${degrees}°`,
    },
    image: {
      choose: '选择图片…',
      replace: '更换图片…',
      notChosen: '尚未选择图片',
      uploading: '上传中…',
      pasteHint: '也可以直接按 Ctrl+V 粘贴剪贴板中的图片',
      rejectedType: '只支持 PNG 和 JPEG 图片',
      rejectedSize: (maxMb: number): string => `图片超过 ${maxMb} MB 上限`,
    },
    align: { left: '左对齐', center: '居中', right: '右对齐' },
    fonts: { sans: '黑体', serif: '宋体', mono: '等宽' },
    units: {
      mm: 'mm',
      // Offsets and strokes step in dots because that is the machine's real
      // resolution; entering multiples of 0.125mm would be absurd.
      dots: 'dot',
      dotsSuffix: (dots: number, mm: number): string => `${dots} dot（${mm.toFixed(3)} mm）`,
    },
    delete: '删除元素',
    duplicate: '复制元素',
  },

  violations: {
    CANVAS_TOO_WIDE: (v: Record<string, number | string>): string =>
      `画布宽度 ${v.widthMm}mm 超出该打印机的最大打印宽度 ${v.maxWidthMm}mm`,
    STROKE_TOO_THIN: (v: Record<string, number | string>): string =>
      `线宽小于一个点，打印后不可见。最小为 ${v.minWidthMm}mm（1 dot）`,
    ELEMENT_OUT_OF_BOUNDS: (): string => '该元素超出画布，超出部分不会被打印',
    BARCODE_CONTENT_EMPTY: (): string => '条码内容为空',
    IMAGE_NOT_CHOSEN: (): string => '还没有为这个图片元素选择图片',
  },

  preview: {
    heading: '打印预览',
    refresh: '刷新预览',
    loading: '正在渲染…',
    clipped: '红色区域超出画布，不会被打印',
    hint: '预览为二值化后的实际打印图像，细线与浅色会在此消失',
  },

  print: {
    action: '打印',
    heading: '确认打印',
    // FR-017: printing consumes physical stock and cannot be undone.
    warning: '打印会消耗标签纸且无法撤销，请确认内容与份数无误。',
    printer: '打印机',
    copies: '份数',
    confirm: '确认打印',
    cancel: '取消',
    submitting: '正在提交…',
    queued: '已加入队列',
    queuedDetail: (jobId: string): string => `任务编号 ${jobId}`,
    selectPrinter: '请先选择一台打印机',
    needsProbe: '这台打印机尚未探测，无法确定可打印范围',
  },

  fields: {
    heading: '可变字段',
    empty: '还没有可变字段。加一个之后，同一个模板就能覆盖内容不同的一批标签',
    addManual: '手工填入',
    addSequence: '递增序号',
    manual: '手工填入（本次打印全部份数共用一个值）',
    sequence: '递增序号（逐份递增，每份不同）',
    bindTo: '绑定到选中元素',
    unbound: '不绑定（固定内容）',
    notBindable: '只有文字、条码、二维码可以绑定可变字段',
    remove: '删除',
    name: '字段名',
    label: '显示名',
    sampleValue: '示例值',
    sampleHint: '仅用于编辑器预览版式，不会被打印',
    seqStart: '起始值',
    seqDigits: '位数',
    seqStep: '步长',
    seqPreview: (start: number, digits: number, step: number): string => {
      const at = (i: number): string => String(start + i * step).padStart(digits, '0')
      return `依次为 ${at(0)}、${at(1)}、${at(2)}…；位数决定补零，${digits} 位最大到 ${'9'.repeat(digits)}`
    },
  },

  templates: {
    heading: '模板',
    empty: '还没有保存模板',
    save: '保存为模板',
    saveAs: '另存为',
    update: '保存',
    load: '载入',
    remove: '删除',
    confirmRemove: '确定删除这个模板吗？已打印的历史记录不受影响。',
    name: '模板名称',
    conflict: '这个模板已被其他人修改。请重新载入后再保存，否则会覆盖对方的改动。',
    reload: '重新载入',
    boundKind: '适用机型',
    searchPlaceholder: '搜索模板名称',
    open: '打开',
    confirmDelete: '确定删除这个模板吗？已打印的历史记录不受影响。',
    fieldCount: (n: number) => (n === 0 ? '无可变字段' : `${n} 个可变字段`),
  },

  settings: {
    heading: '设置',
    // The most important sentence on this page: it tells you why the thing you
    // are looking for is not here.
    scopeNote: '这里的设置只影响当前浏览器，不会影响其他人。服务端配置（空跑模式、日志级别等）由部署方式决定，界面上不提供。',
    language: '界面语言',
    languageNames: { 'zh-CN': '中文', 'en-US': 'English' },
    defaultSize: '新建标签默认尺寸',
    defaultWidth: '宽度',
    defaultHeight: '高度',
    defaultDpi: '分辨率',
    defaultFont: '默认字体',
    displayUnit: '尺寸显示单位',
    displayUnits: { mm: '毫米', dot: '打印点' },
    theme: '主题',
    themes: { light: '浅色', dark: '深色', system: '跟随系统' },
    pollInterval: '队列刷新间隔（毫秒）',
    alwaysConfirmTabClose: '关闭标签页时总是确认',
    unsaved: '有未保存的修改',
    localOnlyHint: '换一个浏览器会回到默认值——系统没有账号，无法记住是谁。',
  },

  offset: {
    heading: '物理偏移校正',
    up: '上移',
    right: '右移',
    down: '下移',
    left: '左移',
    unit: 'dot',
    // The single most useful sentence on this panel: it explains why the value
    // is not something you set once.
    hint: '每次更换纸卷后都可能需要重新校正，即使是同型号纸。',
    printCalibration: '打印校正页',
    confirmTitle: '打印校正页？',
    confirmBody: '这会实际打印一张标签并消耗纸张，无法撤销。',
    confirmSize: (w: number, h: number) => `将按 ${w}×${h}mm 打印。`,
    needsProfile: '还没有记录纸张尺寸的打印参数。校正页要贴着纸边来量，必须和纸一样大——请先新建一个打印参数并填入纸张宽高。',
    confirmCancel: '取消',
    confirmPrint: '打印',
    save: '保存偏移',
    saved: '偏移已保存',
  },

  overflow: {
    heading: '以下标签有内容超出边界',
    // Overflow warns but never blocks: the judgement belongs to whoever holds
    // the roll, and holding back a whole batch for one clipped label is worse.
    note: '超出部分会被裁切。你可以照常打印，也可以修改后重试。',
    row: (index: number) => `第 ${index + 1} 张`,
    reasons: {
      ELEMENT_OUT_OF_BOUNDS: '元素超出标签范围',
      BARCODE_TOO_WIDE: '条码宽度超出可用宽度',
    },
    widths: (actual: number, available: number) => `${actual} mm / 可用 ${available} mm`,
    inHistory: '本次打印有内容被裁切',
  },

  profiles: {
    heading: '打印参数',
    empty: '还没有打印参数，将使用探测到的默认值',
    add: '新建参数',
    name: '名称',
    labelWidth: '纸张宽度',
    labelHeight: '纸张高度',
    margins: '边距',
    marginLinked: '四边相同',
    marginTop: '上',
    marginRight: '右',
    marginBottom: '下',
    marginLeft: '左',
    marginHint: '边距只作提示，不阻止在其中放置元素。',
    canvasFollowsProfile: '选择参数后画布尺寸会跟随纸张尺寸，已有元素位置不变。',
    noProfileSelected: '尚未选择打印参数，因此不显示边距。',
    density: '浓度',
    labelType: '介质类型',
    halftone: '图片色调',
    halftoneHint: '只作用于图片元素。文字和条码始终用硬阈值——把它们抖动会让笔画发毛，也会在条码的空白区里落下杂点。',
    halftoneModes: {
      none: '不处理（硬阈值）',
      'floyd-steinberg': '误差扩散（照片）',
      ordered: '有序网点（耐热扩散）',
    },
    offsetX: '水平偏移',
    offsetY: '垂直偏移',
    isDefault: '设为默认',
    isDefaultHint: '默认参数会在选择该打印机时自动选中，校正页也按它的纸张尺寸打印。每台打印机只有一个默认。',
    remove: '删除',
    confirmRemove: (name: string) => `确定删除打印参数「${name}」吗？使用该参数的历史记录不受影响。`,
    offsetHint: '按点调节；预览会同步显示偏移后的效果，不必试打',
    densityHint: (min: number, max: number): string => `该机型支持 ${min} – ${max}`,
  },

  printForm: {
    heading: '填写字段',
    range: (start: string, end: string, copies: number): string =>
      `本次将消耗 ${start} – ${end}，共 ${copies} 个序号`,
    overflow: (end: number, max: number, digits: number): string =>
      `本次会递增到 ${end}，超出 ${digits} 位能表示的最大值 ${max}。请增加位数或调小起始值。`,
    overrideHint: '默认从上次打印之后接续；如需重打报废批次，可改回原来的起始值',
    conflict: (start: string, suggested: string): string =>
      `起始值 ${start} 低于建议值 ${suggested}，这一段序号此前已经打印过。若是重打报废批次则属正常，否则会出现重复序号。`,
  },

  jobs: {
    heading: '打印队列',
    empty: '队列为空',
    // Stated rather than left blank: a blank where a name goes reads as
    // missing data, not as "there was never a template".
    adHoc: '未使用模板（一次性设计）',
    template: '模板',
    time: '时间',
    copies: (n: number) => `${n} 张`,
    cancel: '取消',
    status: {
      queued: '排队中',
      printing: '打印中',
      completed: '已完成',
      failed: '失败',
      cancelled: '已取消',
    },
    progress: (printed: number, total: number): string => `已打印 ${printed} / 共 ${total}`,
    // Deliberately not "0": the count is unknown, and showing zero would send
    // someone to reprint the whole batch.
    progressUnknown: (total: number): string => `已打印份数未知 / 共 ${total}`,
    countManually: '服务在打印过程中重启，实际打出的份数无法确认。请清点实物后再决定补打数量。',
    paused: {
      heading: (printer: string) => `${printer} 的打印队列已暂停`,
      note: '排队中的任务不会开始，直到你恢复队列。请先确认故障已经处理。',
      reasons: {
        JOB_INTERRUPTED_BY_RESTART: '上一个任务因服务重启而中断，已打印份数未知。',
        DEVICE_LACK_PAPER: '上一个任务因缺纸而失败。',
        DEVICE_COVER_OPEN: '上一个任务因上盖未合上而失败。',
        PRINTER_UNREACHABLE: '上一个任务因无法连接打印机而失败。',
      } as Record<string, string>,
    },
    reprint: {
      action: '补打',
      heading: '补打这个任务',
      unknownCount: '这次打印的实际份数无法确认。请清点已打出的标签，填入还需要补打的数量。',
      knownCount: (printed: number, total: number) => `已打出 ${printed} 张，原计划 ${total} 张。默认补打差额，可自行调整。`,
      confirm: (copies: number) => `打印 ${copies} 张`,
    },
  },

  history: {
    heading: '打印历史',
    empty: '还没有完成的任务',
    adHoc: '未保存的标签',
    expand: (total: number): string => `查看全部 ${total} 条`,
    collapse: '收起',
  },

  images: {
    heading: '图片',
    upload: '上传图片',
    uploading: '正在上传…',
    empty: '还没有上传图片',
    remove: '删除',
    tooLarge: '图片过大，请压缩后重试',
    unsupported: '不支持的图片格式，请使用 PNG 或 JPEG',
  },

  common: {
    save: '保存',
    cancel: '取消',
    close: '关闭',
    confirm: '确定',
    confirmTitle: '确认这项操作？',
    loading: '加载中…',
    retry: '重试',
  },
} as const
