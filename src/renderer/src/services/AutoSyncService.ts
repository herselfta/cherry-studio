import { loggerService } from '@logger'

const logger = loggerService.withContext('AutoSyncService')

const AUTO_SYNC_METADATA_STORAGE_KEY = 'cherry-studio:auto-sync:metadata:v1'
const DEFAULT_SYNC_STATE = {
  lastSyncTime: null,
  syncing: false,
  lastSyncError: null
}
const INDEXED_DB_TABLES_WITH_USER_DATA = [
  'files',
  'topics',
  'knowledge_notes',
  'translate_history',
  'quick_phrases',
  'message_blocks',
  'translate_languages'
]

export const AUTO_SYNC_FILE_NAME = 'cherry-studio.sync.zip'

export type SyncFileEntry = {
  fileName: string
  modifiedTime: string
  size: number
}

export type AutoSyncMetadata = {
  lastSyncedFingerprint: string | null
  lastRemoteRevision: string | null
  updatedAt: number | null
}

export type AutoSyncDecision = 'push' | 'pull' | 'conflict' | 'noop'

export function getNormalizedBackupData(rawBackupData: string): string {
  const backupPayload = JSON.parse(rawBackupData)
  const persistedState =
    backupPayload?.localStorage?.['persist:cherry-studio'] ?? localStorage.getItem('persist:cherry-studio') ?? ''

  return stableStringify({
    version: backupPayload.version ?? 5,
    localStorage: {
      'persist:cherry-studio': normalizePersistedState(persistedState)
    },
    indexedDB: backupPayload.indexedDB ?? {}
  })
}

export function hasMeaningfulLocalData(rawBackupData: string): boolean {
  try {
    const backupPayload = JSON.parse(rawBackupData)
    const indexedDB = backupPayload?.indexedDB ?? {}

    const hasIndexedDbData = INDEXED_DB_TABLES_WITH_USER_DATA.some((tableName) => {
      const tableData = indexedDB[tableName]
      return Array.isArray(tableData) && tableData.length > 0
    })

    if (hasIndexedDbData) {
      return true
    }

    const persistedState =
      backupPayload?.localStorage?.['persist:cherry-studio'] ?? localStorage.getItem('persist:cherry-studio') ?? ''

    return hasMeaningfulAssistantsState(persistedState)
  } catch (error) {
    logger.warn('Failed to inspect local backup payload, treat it as meaningful local data', error as Error)
    return true
  }
}

export function getAutoSyncScopeKey(provider: string, config: Record<string, unknown>): string {
  return `${provider}:${stableStringify(config)}`
}

export function loadAutoSyncMetadata(scopeKey: string): AutoSyncMetadata {
  const metadataMap = readAutoSyncMetadataMap()
  return metadataMap[scopeKey] ?? createEmptyMetadata()
}

export function saveAutoSyncMetadata(scopeKey: string, metadata: Partial<AutoSyncMetadata>) {
  const metadataMap = readAutoSyncMetadataMap()
  const nextMetadata: AutoSyncMetadata = {
    ...createEmptyMetadata(),
    ...metadataMap[scopeKey],
    ...metadata,
    updatedAt: Date.now()
  }

  metadataMap[scopeKey] = nextMetadata
  localStorage.setItem(AUTO_SYNC_METADATA_STORAGE_KEY, JSON.stringify(metadataMap))
}

export function findAutoSyncSnapshot(files: SyncFileEntry[], fileName = AUTO_SYNC_FILE_NAME): SyncFileEntry | null {
  return files.find((file) => file.fileName === fileName) ?? null
}

export function getRemoteRevision(file: SyncFileEntry | null): string | null {
  if (!file) {
    return null
  }

  return `${file.modifiedTime}:${file.size}`
}

export function decideAutoSyncAction({
  metadata,
  currentFingerprint,
  remoteRevision,
  hasMeaningfulLocalState
}: {
  metadata: AutoSyncMetadata
  currentFingerprint: string
  remoteRevision: string | null
  hasMeaningfulLocalState: boolean
}): AutoSyncDecision {
  const hasBaseline = Boolean(metadata.lastSyncedFingerprint || metadata.lastRemoteRevision)

  if (!remoteRevision) {
    return 'push'
  }

  if (!hasBaseline) {
    return hasMeaningfulLocalState ? 'conflict' : 'pull'
  }

  const localChanged = currentFingerprint !== metadata.lastSyncedFingerprint
  const remoteChanged = remoteRevision !== metadata.lastRemoteRevision

  if (localChanged && remoteChanged) {
    return 'conflict'
  }

  if (remoteChanged) {
    return 'pull'
  }

  if (localChanged) {
    return 'push'
  }

  return 'noop'
}

function createEmptyMetadata(): AutoSyncMetadata {
  return {
    lastSyncedFingerprint: null,
    lastRemoteRevision: null,
    updatedAt: null
  }
}

function readAutoSyncMetadataMap(): Record<string, AutoSyncMetadata> {
  const metadataValue = localStorage.getItem(AUTO_SYNC_METADATA_STORAGE_KEY)

  if (!metadataValue) {
    return {}
  }

  try {
    const parsed = JSON.parse(metadataValue)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch (error) {
    logger.warn('Failed to parse auto sync metadata, resetting it', error as Error)
    return {}
  }
}

function normalizePersistedState(persistedStateValue: string): string {
  if (!persistedStateValue) {
    return ''
  }

  try {
    const parsedState = JSON.parse(persistedStateValue)

    return stableStringify({
      ...parsedState,
      backup: sanitizePersistedSlice(parsedState.backup, sanitizeBackupState),
      nutstore: sanitizePersistedSlice(parsedState.nutstore, sanitizeNutstoreState)
    })
  } catch (error) {
    logger.warn('Failed to normalize persisted state, falling back to raw persisted value', error as Error)
    return persistedStateValue
  }
}

function sanitizePersistedSlice(
  persistedSlice: unknown,
  sanitizer: (state: Record<string, unknown>) => Record<string, unknown>
) {
  if (typeof persistedSlice !== 'string') {
    return persistedSlice
  }

  try {
    return stableStringify(sanitizer(JSON.parse(persistedSlice)))
  } catch (error) {
    logger.warn('Failed to sanitize persisted slice, leaving it untouched', error as Error)
    return persistedSlice
  }
}

function sanitizeBackupState(state: Record<string, unknown>) {
  return {
    ...state,
    webdavSync: DEFAULT_SYNC_STATE,
    localBackupSync: DEFAULT_SYNC_STATE,
    s3Sync: DEFAULT_SYNC_STATE
  }
}

function sanitizeNutstoreState(state: Record<string, unknown>) {
  return {
    ...state,
    nutstoreSyncState: DEFAULT_SYNC_STATE
  }
}

function hasMeaningfulAssistantsState(persistedStateValue: string): boolean {
  if (!persistedStateValue) {
    return false
  }

  try {
    const parsedState = JSON.parse(persistedStateValue)
    if (typeof parsedState?.assistants !== 'string') {
      return false
    }

    const assistantsState = JSON.parse(parsedState.assistants)
    const assistants = Array.isArray(assistantsState?.assistants) ? assistantsState.assistants : []
    return assistants.length > 1
  } catch (error) {
    logger.warn('Failed to inspect assistants state, treat it as meaningful local data', error as Error)
    return true
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue)
  }

  if (value && typeof value === 'object') {
    const sortedEntries = Object.entries(value as Record<string, unknown>)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, nestedValue]) => [key, sortValue(nestedValue)])

    return Object.fromEntries(sortedEntries)
  }

  return value
}
