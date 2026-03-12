import { loggerService } from '@logger'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { setNutstoreSyncState } from '@renderer/store/nutstore'
import type { WebDavConfig } from '@renderer/types'
import { NUTSTORE_HOST } from '@shared/config/nutstore'
import dayjs from 'dayjs'
import { type CreateDirectoryOptions } from 'webdav'

import {
  AUTO_SYNC_FILE_NAME,
  decideAutoSyncAction,
  getAutoSyncScopeKey,
  getNormalizedBackupData,
  getRemoteRevision,
  hasMeaningfulLocalData,
  loadAutoSyncMetadata,
  saveAutoSyncMetadata
} from './AutoSyncService'
import { getBackupData, handleData } from './BackupService'

const logger = loggerService.withContext('NutstoreService')

function getNutstoreToken() {
  const nutstoreToken = store.getState().nutstore.nutstoreToken

  if (!nutstoreToken) {
    window.toast.error(i18n.t('message.error.invalid.nutstore_token'))
    return null
  }
  return nutstoreToken
}

async function createNutstoreConfig(nutstoreToken: string): Promise<WebDavConfig | null> {
  const result = await window.api.nutstore.decryptToken(nutstoreToken)
  if (!result) {
    logger.warn('Invalid nutstore token')
    return null
  }

  const nutstorePath = store.getState().nutstore.nutstorePath

  const { username, access_token } = result
  return {
    webdavHost: NUTSTORE_HOST,
    webdavUser: username,
    webdavPass: access_token,
    webdavPath: nutstorePath
  }
}

export async function checkConnection() {
  const nutstoreToken = getNutstoreToken()
  if (!nutstoreToken) {
    return false
  }

  const config = await createNutstoreConfig(nutstoreToken)
  if (!config) {
    return false
  }

  const isSuccess = await window.api.backup.checkWebdavConnection({
    ...config,
    webdavPath: '/'
  })

  return isSuccess
}

let syncTimeout: NodeJS.Timeout | null = null
let isAutoSyncRunning = false
let isManualBackupRunning = false

async function cleanupOldBackups(webdavConfig: WebDavConfig, maxBackups: number): Promise<void> {
  if (maxBackups <= 0) {
    logger.debug('[cleanupOldBackups] Skip cleanup: maxBackups <= 0')
    return
  }

  try {
    const files = await window.api.backup.listWebdavFiles(webdavConfig)

    if (!files || !Array.isArray(files)) {
      logger.warn('[cleanupOldBackups] Failed to list nutstore directory contents')
      return
    }

    const backupFiles = files
      .filter(
        (file) =>
          file.fileName.startsWith('cherry-studio') &&
          file.fileName.endsWith('.zip') &&
          file.fileName !== AUTO_SYNC_FILE_NAME
      )
      .sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime())

    if (backupFiles.length < maxBackups) {
      logger.info(`[cleanupOldBackups] No cleanup needed: ${backupFiles.length}/${maxBackups} backups`)
      return
    }

    const filesToDelete = backupFiles.slice(maxBackups - 1)
    logger.info(`[cleanupOldBackups] Deleting ${filesToDelete.length} old backup files`)

    let deletedCount = 0
    for (const file of filesToDelete) {
      try {
        await window.api.backup.deleteWebdavFile(file.fileName, webdavConfig)
        deletedCount++
      } catch (error) {
        logger.error(`[cleanupOldBackups] Failed to delete ${file.fileName}:`, error as Error)
      }
    }

    if (deletedCount > 0) {
      logger.info(`[cleanupOldBackups] Successfully deleted ${deletedCount} old backups`)
    }
  } catch (error) {
    logger.error('[cleanupOldBackups] Error during cleanup:', error as Error)
  }
}

export async function backupToNutstore({
  showMessage = false,
  customFileName = '',
  backupData,
  autoSyncProcess = false
}: {
  showMessage?: boolean
  customFileName?: string
  backupData?: string
  autoSyncProcess?: boolean
} = {}) {
  const nutstoreToken = getNutstoreToken()
  if (!nutstoreToken) {
    return
  }

  if (isManualBackupRunning) {
    logger.verbose('[backupToNutstore] Backup already in progress')
    return
  }

  if (autoSyncProcess) {
    showMessage = false
  }

  const config = await createNutstoreConfig(nutstoreToken)
  if (!config) {
    return
  }

  let deviceType = 'unknown'
  try {
    deviceType = (await window.api.system.getDeviceType()) || 'unknown'
  } catch (error) {
    logger.error('[backupToNutstore] Failed to get device type:', error as Error)
  }
  const timestamp = dayjs().format('YYYYMMDDHHmmss')
  const backupFileName = customFileName || `cherry-studio.${timestamp}.${deviceType}.zip`
  const finalFileName = backupFileName.endsWith('.zip') ? backupFileName : `${backupFileName}.zip`

  isManualBackupRunning = true

  store.dispatch(setNutstoreSyncState({ syncing: true, lastSyncError: null }))

  const finalBackupData = backupData || (await getBackupData())
  const skipBackupFile = store.getState().nutstore.nutstoreSkipBackupFile
  const maxBackups = store.getState().nutstore.nutstoreMaxBackups

  try {
    // 先清理旧备份
    await cleanupOldBackups(config, maxBackups)

    const isSuccess = await window.api.backup.backupToWebdav(finalBackupData, {
      ...config,
      fileName: finalFileName,
      skipBackupFile: skipBackupFile
    })

    if (isSuccess) {
      store.dispatch(setNutstoreSyncState({ lastSyncError: null }))
      showMessage && window.toast.success(i18n.t('message.backup.success'))
    } else {
      store.dispatch(setNutstoreSyncState({ lastSyncError: 'Backup failed' }))
      if (!autoSyncProcess) {
        window.toast.error(i18n.t('message.backup.failed'))
      }
      throw new Error(i18n.t('message.backup.failed'))
    }
  } catch (error) {
    store.dispatch(setNutstoreSyncState({ lastSyncError: 'Backup failed' }))
    logger.error('[Nutstore] Backup failed:', error as Error)
    if (!autoSyncProcess) {
      window.toast.error(i18n.t('message.backup.failed'))
    }
    throw error
  } finally {
    if (!autoSyncProcess) {
      store.dispatch(setNutstoreSyncState({ lastSyncTime: Date.now(), syncing: false }))
    }
    isManualBackupRunning = false
  }
}

export async function restoreFromNutstore(fileName?: string) {
  const nutstoreToken = getNutstoreToken()
  if (!nutstoreToken) {
    return
  }

  const config = await createNutstoreConfig(nutstoreToken)
  if (!config) {
    return
  }

  let data = ''

  try {
    data = await window.api.backup.restoreFromWebdav({ ...config, fileName })
  } catch (error: any) {
    logger.error('[backup] restoreFromWebdav: Error downloading file from WebDAV:', error as Error)
    window.modal.error({
      title: i18n.t('message.restore.failed'),
      content: error.message
    })
  }

  try {
    await handleData(JSON.parse(data))
  } catch (error) {
    logger.error('[backup] Error downloading file from WebDAV:', error as Error)
    window.toast.error(i18n.t('error.backup.file_format'))
  }
}

export async function startNutstoreAutoSync() {
  const nutstoreToken = getNutstoreToken()

  if (!nutstoreToken) {
    logger.warn('[startNutstoreAutoSync] Invalid nutstore token, nutstore auto sync disabled')
    return
  }

  stopNutstoreAutoSync()
  scheduleNextSync()
}

export function stopNutstoreAutoSync() {
  if (syncTimeout) {
    logger.verbose('[Nutstore AutoSync] Stopping nutstore auto sync')
    clearTimeout(syncTimeout)
    syncTimeout = null
  }
  isAutoSyncRunning = false
}

function scheduleNextSync(scheduleType: 'immediate' | 'fromLastSyncTime' | 'fromNow' = 'fromLastSyncTime') {
  if (syncTimeout) {
    clearTimeout(syncTimeout)
    syncTimeout = null
  }

  const { nutstoreSyncInterval, nutstoreSyncState } = store.getState().nutstore

  if (nutstoreSyncInterval <= 0) {
    logger.warn('[Nutstore AutoSync] Invalid sync interval, nutstore auto sync disabled')
    stopNutstoreAutoSync()
    return
  }

  const requiredInterval = nutstoreSyncInterval * 60 * 1000
  let timeUntilNextSync = 1000

  switch (scheduleType) {
    case 'fromLastSyncTime':
      timeUntilNextSync = Math.max(1000, (nutstoreSyncState?.lastSyncTime || 0) + requiredInterval - Date.now())
      break
    case 'fromNow':
      timeUntilNextSync = requiredInterval
      break
  }

  syncTimeout = setTimeout(() => {
    void performAutoSync()
  }, timeUntilNextSync)

  logger.verbose(
    `[Nutstore AutoSync] Next sync scheduled in ${Math.floor(timeUntilNextSync / 1000 / 60)} minutes ${Math.floor(
      (timeUntilNextSync / 1000) % 60
    )} seconds`
  )
}

async function performAutoSync() {
  if (isAutoSyncRunning || isManualBackupRunning) {
    logger.verbose('[Nutstore AutoSync] Sync already in progress, rescheduling')
    scheduleNextSync('fromNow')
    return
  }

  if (isStreamingInProgress()) {
    logger.info('[Nutstore AutoSync] Streaming in progress, deferring sync')
    scheduleNextSync('fromNow')
    return
  }

  isAutoSyncRunning = true

  const maxRetries = 4
  let retryCount = 0

  while (retryCount < maxRetries) {
    try {
      logger.verbose(`[Nutstore AutoSync] Starting auto sync... (attempt ${retryCount + 1}/${maxRetries})`)
      store.dispatch(setNutstoreSyncState({ syncing: true, lastSyncError: null }))

      const syncContext = await buildNutstoreAutoSyncContext()
      const metadata = loadAutoSyncMetadata(syncContext.scopeKey)
      const remoteSnapshot = await listNutstoreAutoSyncSnapshot(syncContext.config)
      const remoteRevision = getRemoteRevision(remoteSnapshot)
      const action = decideAutoSyncAction({
        metadata,
        currentFingerprint: syncContext.currentFingerprint,
        remoteRevision,
        hasMeaningfulLocalState: syncContext.hasMeaningfulLocalState
      })

      if (action === 'push') {
        const pushedSnapshot = await pushNutstoreAutoSyncSnapshot(syncContext.config, syncContext.backupData)
        const pushedRevision = getRemoteRevision(pushedSnapshot)

        if (!pushedRevision) {
          throw new Error('Remote sync snapshot revision is missing after push')
        }

        saveAutoSyncMetadata(syncContext.scopeKey, {
          lastSyncedFingerprint: syncContext.currentFingerprint,
          lastRemoteRevision: pushedRevision
        })
        store.dispatch(setNutstoreSyncState({ lastSyncError: null, lastSyncTime: Date.now(), syncing: false }))
        logger.info('[Nutstore AutoSync] Pushed local changes to remote sync snapshot')
      } else if (action === 'pull') {
        const remoteBackupData = await pullNutstoreAutoSyncSnapshot(syncContext.config)
        const pulledFingerprint = await window.api.backup.calculateSyncFingerprint(
          getNormalizedBackupData(remoteBackupData),
          syncContext.skipBackupFile
        )
        const refreshedRemoteSnapshot = await listNutstoreAutoSyncSnapshot(syncContext.config)
        const refreshedRemoteRevision = getRemoteRevision(refreshedRemoteSnapshot) || remoteRevision

        saveAutoSyncMetadata(syncContext.scopeKey, {
          lastSyncedFingerprint: pulledFingerprint,
          lastRemoteRevision: refreshedRemoteRevision
        })
        store.dispatch(setNutstoreSyncState({ lastSyncError: null, lastSyncTime: Date.now(), syncing: false }))
        logger.info('[Nutstore AutoSync] Pulled remote changes and restored local data')
      } else if (action === 'conflict') {
        const conflictMessage = 'Sync conflict detected. Resolve local or remote changes manually before retrying.'

        store.dispatch(setNutstoreSyncState({ lastSyncError: conflictMessage, syncing: false }))
        logger.warn(`[Nutstore AutoSync] ${conflictMessage}`)
      } else {
        saveAutoSyncMetadata(syncContext.scopeKey, {
          lastSyncedFingerprint: syncContext.currentFingerprint,
          lastRemoteRevision: remoteRevision
        })
        store.dispatch(setNutstoreSyncState({ lastSyncError: null, lastSyncTime: Date.now(), syncing: false }))
        logger.verbose('[Nutstore AutoSync] Local and remote snapshots are already in sync')
      }

      isAutoSyncRunning = false
      scheduleNextSync('fromNow')
      break
    } catch (error: any) {
      retryCount++

      if (retryCount === maxRetries) {
        logger.error('[Nutstore AutoSync] Auto sync failed after all retries:', error as Error)
        store.dispatch(
          setNutstoreSyncState({
            lastSyncError: 'Auto sync failed',
            lastSyncTime: Date.now(),
            syncing: false
          })
        )

        await window.modal.error({
          title: i18n.t('message.backup.failed'),
          content: `[Nutstore AutoSync] ${new Date().toLocaleString()} ${error.message}`
        })

        scheduleNextSync('fromNow')
        isAutoSyncRunning = false
      } else {
        const backoffDelay = Math.pow(2, retryCount - 1) * 10000 - 3000
        logger.warn(`[Nutstore AutoSync] Failed, retry ${retryCount}/${maxRetries} after ${backoffDelay / 1000}s`)
        await new Promise((resolve) => setTimeout(resolve, backoffDelay))

        if (!isAutoSyncRunning) {
          logger.info('[Nutstore AutoSync] Retry cancelled by user, exit')
          break
        }
      }
    }
  }
}

function isStreamingInProgress() {
  const loadingByTopic = store.getState().messages.loadingByTopic || {}
  return Object.values(loadingByTopic).some((loading) => loading === true)
}

async function buildNutstoreAutoSyncContext() {
  const nutstoreToken = getNutstoreToken()
  if (!nutstoreToken) {
    throw new Error('Invalid nutstore token')
  }

  const config = await createNutstoreConfig(nutstoreToken)
  if (!config) {
    throw new Error('Invalid nutstore config')
  }

  const backupData = await getBackupData()
  const skipBackupFile = store.getState().nutstore.nutstoreSkipBackupFile

  return {
    backupData,
    config,
    currentFingerprint: await window.api.backup.calculateSyncFingerprint(
      getNormalizedBackupData(backupData),
      skipBackupFile
    ),
    hasMeaningfulLocalState: hasMeaningfulLocalData(backupData),
    scopeKey: getAutoSyncScopeKey('nutstore', {
      webdavUser: config.webdavUser,
      webdavPath: config.webdavPath,
      skipBackupFile
    }),
    skipBackupFile
  }
}

async function listNutstoreAutoSyncSnapshot(config: WebDavConfig) {
  const files = await window.api.backup.listWebdavFiles(config)
  return files.find((file) => file.fileName === AUTO_SYNC_FILE_NAME) || null
}

async function pushNutstoreAutoSyncSnapshot(config: WebDavConfig, backupData: string) {
  await backupToNutstore({
    autoSyncProcess: true,
    backupData,
    customFileName: AUTO_SYNC_FILE_NAME
  })

  return await listNutstoreAutoSyncSnapshot(config)
}

async function pullNutstoreAutoSyncSnapshot(config: WebDavConfig) {
  const restoreData = await window.api.backup.restoreFromWebdav({
    ...config,
    fileName: AUTO_SYNC_FILE_NAME
  })
  await handleData(JSON.parse(restoreData))
  return restoreData
}

export async function createDirectory(path: string, options?: CreateDirectoryOptions) {
  const nutstoreToken = getNutstoreToken()
  if (!nutstoreToken) {
    return
  }
  const config = await createNutstoreConfig(nutstoreToken)
  if (!config) {
    return
  }

  await window.api.backup.createDirectory(config, path, options)
}
