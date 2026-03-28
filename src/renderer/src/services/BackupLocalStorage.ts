export const BACKUP_LOCAL_STORAGE_VERSION = 7
export const PERSISTED_REDUX_STATE_STORAGE_KEY = 'persist:cherry-studio'
export const MANUAL_SYNC_SCHEDULE_STORAGE_KEY = 'cherry-studio:manual-sync:schedules:v1'
export const BACKUP_MANUAL_SYNC_CONFIRM_PREFERENCES_KEY = 'cherry-studio:backup:manual-sync-confirm:v1'

const MANUAL_SYNC_PROVIDERS = ['webdav', 's3', 'local', 'nutstore'] as const
const DEFAULT_CONFIRM_BEFORE_RESTORE = true
const NON_PORTABLE_PERSISTED_SETTINGS_KEYS = [
  'localBackupDir',
  'localBackupAutoSync',
  'localBackupSyncInterval',
  'localBackupMaxBackups',
  'localBackupSkipBackupFile'
] as const

// Keep this list aligned with cross-device localStorage-backed settings.
// When a new feature stores portable settings outside Redux/IndexedDB, add it here.
export const BACKUP_AWARE_LOCAL_STORAGE_KEYS = ['language', 'memory_currentUserId'] as const

type BackupAwareLocalStorageKey = (typeof BACKUP_AWARE_LOCAL_STORAGE_KEYS)[number]
type ManualSyncProvider = (typeof MANUAL_SYNC_PROVIDERS)[number]

type ManualSyncScheduleConfig = {
  uploadTimes: string[]
  restoreTimes: string[]
  confirmBeforeRestore: boolean
}

type ManualSyncScheduleMap = Record<ManualSyncProvider, ManualSyncScheduleConfig>

type ManualSyncConfirmPreferences = Record<ManualSyncProvider, boolean>

function createDefaultManualSyncScheduleMap(): ManualSyncScheduleMap {
  return MANUAL_SYNC_PROVIDERS.reduce<ManualSyncScheduleMap>((result, provider) => {
    result[provider] = {
      uploadTimes: [],
      restoreTimes: [],
      confirmBeforeRestore: DEFAULT_CONFIRM_BEFORE_RESTORE
    }
    return result
  }, {} as ManualSyncScheduleMap)
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function parseManualSyncScheduleMap(value: unknown): ManualSyncScheduleMap {
  const scheduleMap = createDefaultManualSyncScheduleMap()

  if (!value || typeof value !== 'object') {
    return scheduleMap
  }

  for (const provider of MANUAL_SYNC_PROVIDERS) {
    const providerValue = (value as Record<string, unknown>)[provider]
    if (!providerValue || typeof providerValue !== 'object') {
      continue
    }

    const providerConfig = providerValue as Record<string, unknown>
    scheduleMap[provider] = {
      uploadTimes: normalizeStringArray(providerConfig.uploadTimes),
      restoreTimes: normalizeStringArray(providerConfig.restoreTimes),
      confirmBeforeRestore:
        typeof providerConfig.confirmBeforeRestore === 'boolean'
          ? providerConfig.confirmBeforeRestore
          : DEFAULT_CONFIRM_BEFORE_RESTORE
    }
  }

  return scheduleMap
}

function parseManualSyncConfirmPreferences(value: unknown): ManualSyncConfirmPreferences | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  let hasPortablePreference = false
  const preferences = MANUAL_SYNC_PROVIDERS.reduce<ManualSyncConfirmPreferences>((result, provider) => {
    const providerValue = (value as Record<string, unknown>)[provider]

    if (typeof providerValue === 'boolean') {
      hasPortablePreference = true
      result[provider] = providerValue
      return result
    }

    if (
      providerValue &&
      typeof providerValue === 'object' &&
      typeof (providerValue as Record<string, unknown>).confirmBeforeRestore === 'boolean'
    ) {
      hasPortablePreference = true
      result[provider] = (providerValue as Record<string, boolean>).confirmBeforeRestore
      return result
    }

    result[provider] = DEFAULT_CONFIRM_BEFORE_RESTORE
    return result
  }, {} as ManualSyncConfirmPreferences)

  return hasPortablePreference ? preferences : null
}

function readSerializedJson(value: string | null): unknown {
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function sanitizePersistedReduxState(value: string): string {
  const persistedReduxState = readSerializedJson(value)
  if (!persistedReduxState || typeof persistedReduxState !== 'object') {
    return value
  }

  const serializedSettings = (persistedReduxState as Record<string, unknown>).settings
  if (typeof serializedSettings !== 'string') {
    return value
  }

  const settingsState = readSerializedJson(serializedSettings)
  if (!settingsState || typeof settingsState !== 'object') {
    return value
  }

  const sanitizedSettingsState = { ...(settingsState as Record<string, unknown>) }
  let hasRemovedLocalOnlySettings = false

  for (const key of NON_PORTABLE_PERSISTED_SETTINGS_KEYS) {
    if (!(key in sanitizedSettingsState)) {
      continue
    }

    delete sanitizedSettingsState[key]
    hasRemovedLocalOnlySettings = true
  }

  if (!hasRemovedLocalOnlySettings) {
    return value
  }

  return JSON.stringify({
    ...(persistedReduxState as Record<string, unknown>),
    settings: JSON.stringify(sanitizedSettingsState)
  })
}

function restoreNonPortablePersistedSettings(
  incomingPersistedReduxState: string,
  currentPersistedReduxState: string | null
): string {
  const sanitizedIncomingState = sanitizePersistedReduxState(incomingPersistedReduxState)
  const incomingPersistedState = readSerializedJson(sanitizedIncomingState)
  const currentPersistedState = readSerializedJson(currentPersistedReduxState)

  if (!incomingPersistedState || typeof incomingPersistedState !== 'object') {
    return sanitizedIncomingState
  }

  if (!currentPersistedState || typeof currentPersistedState !== 'object') {
    return sanitizedIncomingState
  }

  const incomingSerializedSettings = (incomingPersistedState as Record<string, unknown>).settings
  const currentSerializedSettings = (currentPersistedState as Record<string, unknown>).settings
  if (typeof incomingSerializedSettings !== 'string' || typeof currentSerializedSettings !== 'string') {
    return sanitizedIncomingState
  }

  const incomingSettingsState = readSerializedJson(incomingSerializedSettings)
  const currentSettingsState = readSerializedJson(currentSerializedSettings)
  if (!incomingSettingsState || typeof incomingSettingsState !== 'object') {
    return sanitizedIncomingState
  }

  if (!currentSettingsState || typeof currentSettingsState !== 'object') {
    return sanitizedIncomingState
  }

  const mergedSettingsState = { ...(incomingSettingsState as Record<string, unknown>) }
  let restoredLocalOnlySetting = false

  for (const key of NON_PORTABLE_PERSISTED_SETTINGS_KEYS) {
    if (!(key in (currentSettingsState as Record<string, unknown>))) {
      continue
    }

    mergedSettingsState[key] = (currentSettingsState as Record<string, unknown>)[key]
    restoredLocalOnlySetting = true
  }

  if (!restoredLocalOnlySetting) {
    return sanitizedIncomingState
  }

  return JSON.stringify({
    ...(incomingPersistedState as Record<string, unknown>),
    settings: JSON.stringify(mergedSettingsState)
  })
}

function getManualSyncConfirmPreferences(storage: Storage): ManualSyncConfirmPreferences {
  const currentSchedules = parseManualSyncScheduleMap(
    readSerializedJson(storage.getItem(MANUAL_SYNC_SCHEDULE_STORAGE_KEY))
  )

  return MANUAL_SYNC_PROVIDERS.reduce<ManualSyncConfirmPreferences>((result, provider) => {
    result[provider] = currentSchedules[provider].confirmBeforeRestore
    return result
  }, {} as ManualSyncConfirmPreferences)
}

function getBackupManualSyncConfirmPreferences(snapshot: Record<string, unknown>): ManualSyncConfirmPreferences | null {
  const portablePreferences = parseManualSyncConfirmPreferences(
    readSerializedJson(
      typeof snapshot[BACKUP_MANUAL_SYNC_CONFIRM_PREFERENCES_KEY] === 'string'
        ? (snapshot[BACKUP_MANUAL_SYNC_CONFIRM_PREFERENCES_KEY] as string)
        : null
    )
  )
  if (portablePreferences) {
    return portablePreferences
  }

  return parseManualSyncConfirmPreferences(
    readSerializedJson(
      typeof snapshot[MANUAL_SYNC_SCHEDULE_STORAGE_KEY] === 'string'
        ? (snapshot[MANUAL_SYNC_SCHEDULE_STORAGE_KEY] as string)
        : null
    )
  )
}

export type BackupLocalStorageSnapshot = Partial<
  Record<
    | typeof PERSISTED_REDUX_STATE_STORAGE_KEY
    | BackupAwareLocalStorageKey
    | typeof MANUAL_SYNC_SCHEDULE_STORAGE_KEY
    | typeof BACKUP_MANUAL_SYNC_CONFIRM_PREFERENCES_KEY,
    string
  >
>

function asStorageSnapshot(value: unknown): Record<string, unknown> | BackupLocalStorageSnapshot {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

export function createBackupLocalStorageSnapshot(storage: Storage = localStorage): BackupLocalStorageSnapshot {
  const snapshot: BackupLocalStorageSnapshot = {}
  const persistedReduxState = storage.getItem(PERSISTED_REDUX_STATE_STORAGE_KEY)

  if (persistedReduxState !== null) {
    // Migration backups should not drag machine-local backup directory settings
    // across devices. Keep the portable Redux snapshot, but strip local backup
    // provider configuration so restore targets fall back to their own defaults.
    snapshot[PERSISTED_REDUX_STATE_STORAGE_KEY] = sanitizePersistedReduxState(persistedReduxState)
  }

  snapshot[BACKUP_MANUAL_SYNC_CONFIRM_PREFERENCES_KEY] = JSON.stringify(getManualSyncConfirmPreferences(storage))

  for (const key of BACKUP_AWARE_LOCAL_STORAGE_KEYS) {
    const value = storage.getItem(key)
    if (value !== null) {
      snapshot[key] = value
    }
  }

  return snapshot
}

export function restoreBackupLocalStorageSnapshot(
  value: unknown,
  {
    removeMissingPortableKeys = false,
    storage = localStorage
  }: {
    removeMissingPortableKeys?: boolean
    storage?: Storage
  } = {}
) {
  const snapshot = asStorageSnapshot(value)
  const persistedReduxState = snapshot[PERSISTED_REDUX_STATE_STORAGE_KEY]

  if (typeof persistedReduxState === 'string') {
    storage.setItem(
      PERSISTED_REDUX_STATE_STORAGE_KEY,
      restoreNonPortablePersistedSettings(persistedReduxState, storage.getItem(PERSISTED_REDUX_STATE_STORAGE_KEY))
    )
  }

  const manualSyncConfirmPreferences = getBackupManualSyncConfirmPreferences(snapshot)
  if (manualSyncConfirmPreferences) {
    const currentScheduleMap = parseManualSyncScheduleMap(
      readSerializedJson(storage.getItem(MANUAL_SYNC_SCHEDULE_STORAGE_KEY))
    )
    for (const provider of MANUAL_SYNC_PROVIDERS) {
      currentScheduleMap[provider].confirmBeforeRestore = manualSyncConfirmPreferences[provider]
    }
    storage.setItem(MANUAL_SYNC_SCHEDULE_STORAGE_KEY, JSON.stringify(currentScheduleMap))
  }

  for (const key of BACKUP_AWARE_LOCAL_STORAGE_KEYS) {
    const snapshotValue = snapshot[key]
    if (typeof snapshotValue === 'string') {
      storage.setItem(key, snapshotValue)
      continue
    }

    if (removeMissingPortableKeys) {
      storage.removeItem(key)
    }
  }
}
