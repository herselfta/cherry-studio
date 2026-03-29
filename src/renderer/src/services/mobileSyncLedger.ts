import { loggerService } from '@logger'
import { uuid } from '@renderer/utils'

const logger = loggerService.withContext('MobileSyncLedger')

export const MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY = 'mobile_sync_source_device_id'
export const MOBILE_SYNC_LEDGER_STORAGE_KEY = 'mobile_sync_ledger_v2'
export const MOBILE_SYNC_GLOBAL_LEDGER_STORAGE_KEY = 'mobile_sync_global_ledger_v3'

export type MobileSyncLedgerEntry = {
  lastImportedExportedAt: number
  topicIds: string[]
  messageIds: string[]
  blockIds: string[]
}

export type MobileSyncLedger = Record<string, MobileSyncLedgerEntry>

function normalizeLedgerEntry(entry: MobileSyncLedgerEntry): MobileSyncLedgerEntry {
  return {
    lastImportedExportedAt: entry.lastImportedExportedAt,
    topicIds: Array.from(new Set(entry.topicIds)),
    messageIds: Array.from(new Set(entry.messageIds)),
    blockIds: Array.from(new Set(entry.blockIds))
  }
}

export function getOrCreateMobileSyncSourceDeviceId(storage: Storage = localStorage): string {
  const existing = storage.getItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY)
  if (existing) {
    return existing
  }

  const deviceId = uuid()
  storage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, deviceId)
  return deviceId
}

export function readMobileSyncLedger(storage: Storage = localStorage): MobileSyncLedger {
  const serialized = storage.getItem(MOBILE_SYNC_LEDGER_STORAGE_KEY)
  if (!serialized) {
    return {}
  }

  try {
    return JSON.parse(serialized) as MobileSyncLedger
  } catch (error) {
    logger.warn('Failed to parse mobile sync ledger', error as Error)
    return {}
  }
}

export function getMobileSyncLedgerEntry(
  sourceDeviceId: string,
  storage: Storage = localStorage
): MobileSyncLedgerEntry | undefined {
  return readMobileSyncLedger(storage)[sourceDeviceId]
}

export function writeMobileSyncLedgerEntry(
  sourceDeviceId: string,
  entry: MobileSyncLedgerEntry,
  storage: Storage = localStorage
) {
  const ledger = readMobileSyncLedger(storage)
  ledger[sourceDeviceId] = normalizeLedgerEntry(entry)
  storage.setItem(MOBILE_SYNC_LEDGER_STORAGE_KEY, JSON.stringify(ledger))
}

export function getLatestMobileSyncLedgerEntry(storage: Storage = localStorage): MobileSyncLedgerEntry | undefined {
  const serialized = storage.getItem(MOBILE_SYNC_GLOBAL_LEDGER_STORAGE_KEY)
  if (!serialized) {
    return undefined
  }

  try {
    return normalizeLedgerEntry(JSON.parse(serialized) as MobileSyncLedgerEntry)
  } catch (error) {
    logger.warn('Failed to parse global mobile sync ledger', error as Error)
    return undefined
  }
}

export function writeLatestMobileSyncLedgerEntry(entry: MobileSyncLedgerEntry, storage: Storage = localStorage) {
  storage.setItem(MOBILE_SYNC_GLOBAL_LEDGER_STORAGE_KEY, JSON.stringify(normalizeLedgerEntry(entry)))
}
