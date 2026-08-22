/** Shapes mirroring the REST contract. Field names are camelCase throughout. */
export type PrinterKind = 'niimbot' | 'zpl'
export type TransportKind = 'serial' | 'tcp'
export type QueueState = 'running' | 'paused'
export type JobStatus = 'queued' | 'printing' | 'completed' | 'failed' | 'cancelled'

export interface Capabilities {
  dpi: number
  printheadPixels: number
  densityMin: number
  densityMax: number
  densityDefault: number
  paperTypes: number[]
  printDirection: 'top' | 'left'
  supportsConsumableLevel: boolean
  model: string | null
  serial: string | null
  firmwareVersion: string | null
}

export interface Printer {
  id: string
  name: string
  kind: PrinterKind
  transport: TransportKind
  address: string
  printTaskName?: string
  capabilities: Capabilities | null
  queueState: QueueState
  queuePausedReason: string | null
  lastProbedAt: string | null
  createdAt: string
  /** Position correction in dots; belongs to the machine, not the paper. */
  offsetXDots: number
  offsetYDots: number
}

export interface PrintJobSummary {
  jobId: string
  status: JobStatus
  requestedCopies: number
  deduplicated: boolean
}

export interface ImageAsset {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  createdAt: string
}
