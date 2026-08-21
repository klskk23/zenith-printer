/**
 * Simplified Chinese copy.
 *
 * Constitution Principle IV: this directory is the one place non-English string
 * literals are allowed. Keys stay English; the values are the translations.
 *
 * Principle III.0 requires every message to answer three questions — what
 * happened, why, and what to do next — so a raw error code never reaches a user.
 */

export interface ErrorCopy {
  what: string
  why: string
  next: string
}

/**
 * Device faults, keyed by niimbluelib's `PrinterErrorCode`.
 * All 53 values are covered; a missing entry would leak a bare number.
 */
export const DEVICE_ERROR_COPY: Readonly<Record<number, ErrorCopy>> = {
  1: { what: '打印机上盖未合上', why: '换纸或清理后盖子没有扣紧', next: '合上上盖听到咔哒声后重新提交任务' },
  2: { what: '打印机缺纸', why: '这卷标签纸已经用完', next: '装入新的标签纸，然后在队列页面点击恢复' },
  3: { what: '打印机电量过低', why: '电池电量不足以完成打印', next: '接上电源充电后重新提交任务' },
  4: { what: '电池异常', why: '打印机报告电池状态不正常', next: '断电静置几分钟后重新开机；若反复出现请联系维修' },
  5: { what: '打印被取消', why: '有人在打印机上按下了取消键', next: '确认已打出的标签数量后重新提交剩余份数' },
  6: { what: '打印数据错误', why: '打印机无法解析收到的数据', next: '这是软件缺陷，请把任务编号提供给维护人员' },
  7: { what: '打印头过热', why: '连续打印导致打印头温度过高', next: '等待三到五分钟让打印头冷却后再继续' },
  8: { what: '出纸异常', why: '纸张可能卡住或未正确装入', next: '打开上盖检查纸路，取出卡纸后重新装纸' },
  9: { what: '打印机正忙', why: '打印机正在处理其他任务', next: '稍后重试；若持续出现请检查是否有人在直接操作打印机' },
  10: { what: '未检测到打印头', why: '打印头未装好或接触不良', next: '关机后重新安装打印头' },
  11: { what: '环境温度过低', why: '当前温度低于打印机工作范围', next: '将打印机移到较温暖的环境，回温后重试' },
  12: { what: '打印头松动', why: '打印头未锁紧到位', next: '打开上盖，将打印头压紧至锁定位置' },
  13: { what: '缺少碳带', why: '未安装碳带或碳带已用完', next: '装入新碳带后在队列页面点击恢复' },
  14: { what: '碳带型号不匹配', why: '当前碳带与所选打印参数不符', next: '更换为匹配的碳带，或调整打印参数中的介质类型' },
  15: { what: '碳带已用尽', why: '这卷碳带已经走到末端', next: '更换新碳带后重新提交任务' },
  16: { what: '纸张型号不匹配', why: '装入的纸张与所选打印参数不符', next: '更换纸张，或调整打印参数中的介质类型' },
  17: { what: '纸张设置失败', why: '打印机拒绝了纸张类型设置', next: '确认该机型支持所选介质类型后重试' },
  18: { what: '打印模式设置失败', why: '打印机拒绝了打印模式设置', next: '确认该机型支持所选打印模式后重试' },
  19: { what: '打印浓度设置失败', why: '打印机拒绝了浓度设置', next: '将浓度调整到该机型支持的范围内' },
  20: { what: 'RFID 写入失败', why: '耗材标签写入未成功', next: '重新装纸后重试；若反复失败请更换耗材' },
  21: { what: '边距设置失败', why: '打印机拒绝了边距设置', next: '检查打印参数中的偏移校正是否超出范围' },
  22: { what: '通信异常', why: '与打印机的数据传输出错', next: '检查数据线连接，然后重新提交任务' },
  23: { what: '打印机已断开', why: '打印过程中连接中断', next: '检查数据线与电源，确认打印机在线后重新提交' },
  24: { what: '画布参数错误', why: '标签尺寸超出打印机支持范围', next: '在编辑器中缩小标签尺寸至该打印机的可打印宽度以内' },
  25: { what: '旋转参数异常', why: '打印方向设置不被该机型支持', next: '将打印方向改回该机型的默认值' },
  26: { what: '参数格式错误', why: '发送给打印机的参数结构不正确', next: '这是软件缺陷，请把任务编号提供给维护人员' },
  27: { what: '出纸异常（B3S 系列）', why: '走纸检测未通过，可能是纸张规格不符或纸路有异物', next: '取出纸卷检查纸路，重新装纸后重试' },
  28: { what: '纸张检测失败', why: '打印机无法识别当前装入的纸张', next: '重新装纸并确保标签间隙对准检测位置' },
  29: { what: 'RFID 标签未写入', why: '耗材信息尚未写入标签', next: '重新装纸后重试' },
  30: { what: '该机型不支持设置浓度', why: '当前打印机没有浓度调节能力', next: '在打印参数中保持默认浓度' },
  31: { what: '该机型不支持设置打印模式', why: '当前打印机没有打印模式选项', next: '在打印参数中保持默认模式' },
  32: { what: '标签材质设置错误', why: '所选材质参数无效', next: '调整打印参数中的介质类型' },
  33: { what: '该机型不支持设置标签材质', why: '当前打印机没有材质选项', next: '在打印参数中保持默认材质' },
  34: { what: '该机型不支持写入 RFID', why: '当前打印机没有 RFID 写入能力', next: '无需处理，此功能对该机型不可用' },
  50: { what: '页面数据非法', why: '发送的页面数据不符合打印机要求', next: '这是软件缺陷，请把任务编号提供给维护人员' },
  51: { what: '碳带页面数据非法', why: '碳带相关的页面数据不正确', next: '这是软件缺陷，请把任务编号提供给维护人员' },
  52: { what: '接收数据超时', why: '打印机等待数据的时间超过限制', next: '检查连接质量后重新提交任务' },
  53: { what: '非专用碳带', why: '检测到非原厂碳带', next: '更换为原厂碳带，或在打印机设置中允许第三方耗材' },
}

/** Application-level errors, keyed by the stable `code` in the REST contract. */
export const APP_ERROR_COPY: Readonly<Record<string, ErrorCopy>> = {
  PRINTER_UNREACHABLE: {
    what: '打印机无法连接',
    why: '设备可能已关机、断开数据线，或网络地址不可达。精臣打印机闲置一小时后会自动关机，且无法通过 USB 唤醒',
    next: '请到设备旁确认电源已开启、连线正常，然后重新提交任务',
  },
  PRINTER_HAS_QUEUED_JOBS: {
    what: '该打印机仍有排队中的任务，无法删除',
    why: '删除后这些任务将失去归属，无法继续执行',
    next: '先取消或等待队列中的任务完成，然后再删除打印机',
  },
  JOB_ALREADY_PRINTING: {
    what: '任务已经在打印中，无法取消',
    why: '标签正在物理输出，中途停止会造成废标签且无法准确记录数量',
    next: '等待任务结束；如需立即停止，请在打印机上按取消键，之后核对已打出的数量',
  },
  INSUFFICIENT_CONSUMABLE: {
    what: '剩余标签纸不足以完成本次打印',
    why: '当前纸卷的剩余数量少于请求份数',
    next: '减少打印份数，或更换新纸卷后重新提交',
  },
  SEQUENCE_OVERFLOW: {
    what: '递增序号超出了设定的位数',
    why: '本次打印的序号区间上界超过该位数能表示的最大值',
    next: '增加序号位数，或将起始值调整到较小的数值',
  },
  FIELD_VALIDATION_FAILED: {
    what: '填入的字段值不符合要求',
    why: '内容不满足所选条码码制的规则，或超出了标签可打印范围',
    next: '按提示修改字段内容后重新提交',
  },
  TEMPLATE_PRINTER_MISMATCH: {
    what: '模板与所选打印机不匹配',
    why: '模板是为另一类打印机设计的，画布尺寸与可打印范围不兼容',
    next: '选择匹配的打印机，或为该机型另建模板',
  },
  QUEUE_PAUSED: {
    what: '该打印机的队列已暂停',
    why: '上一个任务失败，或有人手动暂停了队列',
    next: '处理完故障后在队列页面点击恢复',
  },
  DEVICE_ERROR: {
    what: '打印机拒绝了本次操作',
    why: '设备已连接，但未按预期响应；可能是固件不兼容或状态异常',
    next: '关闭打印机电源等待几秒后重新开机，然后重试；若反复出现请记录型号与固件版本',
  },
  RENDER_FAILED: {
    what: '标签渲染失败',
    why: '服务端在生成打印图像时出错',
    next: '这是软件缺陷，请把任务编号提供给维护人员',
  },
  JOB_INTERRUPTED_BY_RESTART: {
    what: '任务因服务重启而中断，已打印份数未知',
    why: '服务在打印过程中重启，无法确认实际已经输出了多少张',
    next: '请清点实际打出的标签数量，再决定补打多少份',
  },
  VALIDATION_FAILED: {
    what: '请求内容不合法',
    why: '提交的数据未通过校验',
    next: '按提示修正后重试',
  },
  NOT_FOUND: {
    what: '找不到指定的资源',
    why: '它可能已被删除',
    next: '刷新页面后重试',
  },
  INTERNAL_ERROR: {
    what: '服务内部错误',
    why: '发生了预期之外的故障',
    next: '请把操作时间提供给维护人员，以便查阅日志',
  },
}
