import { loggerService } from '@logger'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { setNutstoreSyncState } from '@renderer/store/nutstore'
import type { WebDavConfig } from '@renderer/types'
import { NUTSTORE_HOST } from '@shared/config/nutstore'
import dayjs from 'dayjs'
import { type CreateDirectoryOptions } from 'webdav'

import { getBackupData, handleData, isMigrationBackupFile, LEGACY_INTERNAL_BACKUP_FILE_NAME } from './BackupService'

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
          file.fileName !== LEGACY_INTERNAL_BACKUP_FILE_NAME &&
          isMigrationBackupFile(file.fileName)
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
  autoBackupProcess = false
}: {
  showMessage?: boolean
  customFileName?: string
  autoBackupProcess?: boolean
} = {}) {
  const nutstoreToken = getNutstoreToken()
  if (!nutstoreToken) {
    return
  }

  if (isManualBackupRunning) {
    logger.verbose('[backupToNutstore] Backup already in progress')
    return
  }

  if (autoBackupProcess) {
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
  const backupFileName = customFileName || `cherry-studio.migration.${timestamp}.${deviceType}.zip`
  const finalFileName = backupFileName.endsWith('.zip') ? backupFileName : `${backupFileName}.zip`

  isManualBackupRunning = true

  store.dispatch(setNutstoreSyncState({ syncing: true, lastSyncError: null }))

  const skipBackupFile = store.getState().nutstore.nutstoreSkipBackupFile
  const maxBackups = store.getState().nutstore.nutstoreMaxBackups

  try {
    // 先清理旧备份
    await cleanupOldBackups(config, maxBackups)

    // Nutstore is a remote backend, so it must upload the portable migration payload
    // instead of direct storage snapshots. Keeping this aligned with WebDAV/S3 avoids
    // another cross-platform regression when users switch transport providers.
    const isSuccess = await window.api.backup.backupMigrationToWebdav({
      ...config,
      fileName: finalFileName,
      skipBackupFile: skipBackupFile
    }, await getBackupData())

    if (isSuccess) {
      store.dispatch(setNutstoreSyncState({ lastSyncError: null }))
      showMessage && window.toast.success(i18n.t('message.backup.success'))
    } else {
      store.dispatch(setNutstoreSyncState({ lastSyncError: 'Backup failed' }))
      if (!autoBackupProcess) {
        window.toast.error(i18n.t('message.backup.failed'))
      }
      throw new Error(i18n.t('message.backup.failed'))
    }
  } catch (error) {
    store.dispatch(setNutstoreSyncState({ lastSyncError: 'Backup failed' }))
    logger.error('[Nutstore] Backup failed:', error as Error)
    if (!autoBackupProcess) {
      window.toast.error(i18n.t('message.backup.failed'))
    }
    throw error
  } finally {
    if (!autoBackupProcess) {
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

export async function startNutstoreAutoBackup() {
  const nutstoreToken = getNutstoreToken()

  if (!nutstoreToken) {
    logger.warn('[startNutstoreAutoBackup] Invalid nutstore token, nutstore auto backup disabled')
    return
  }

  stopNutstoreAutoBackup()
  scheduleNextBackup()
}

export function stopNutstoreAutoBackup() {
  if (syncTimeout) {
    logger.verbose('[Nutstore AutoBackup] Stopping nutstore auto backup')
    clearTimeout(syncTimeout)
    syncTimeout = null
  }
  isAutoSyncRunning = false
}

function scheduleNextBackup(scheduleType: 'immediate' | 'fromLastSyncTime' | 'fromNow' = 'fromLastSyncTime') {
  if (syncTimeout) {
    clearTimeout(syncTimeout)
    syncTimeout = null
  }

  const { nutstoreSyncInterval, nutstoreSyncState } = store.getState().nutstore

  if (nutstoreSyncInterval <= 0) {
    logger.warn('[Nutstore AutoBackup] Invalid backup interval, nutstore auto backup disabled')
    stopNutstoreAutoBackup()
    return
  }

  const requiredInterval = nutstoreSyncInterval * 60 * 1000
  let timeUntilNextBackup = 1000

  switch (scheduleType) {
    case 'fromLastSyncTime':
      timeUntilNextBackup = Math.max(1000, (nutstoreSyncState?.lastSyncTime || 0) + requiredInterval - Date.now())
      break
    case 'fromNow':
      timeUntilNextBackup = requiredInterval
      break
  }

  syncTimeout = setTimeout(() => {
    void performAutoBackup()
  }, timeUntilNextBackup)

  logger.verbose(
    `[Nutstore AutoBackup] Next backup scheduled in ${Math.floor(timeUntilNextBackup / 1000 / 60)} minutes ${Math.floor(
      (timeUntilNextBackup / 1000) % 60
    )} seconds`
  )
}

async function performAutoBackup() {
  if (isAutoSyncRunning || isManualBackupRunning) {
    logger.verbose('[Nutstore AutoBackup] Backup already in progress, rescheduling')
    scheduleNextBackup('fromNow')
    return
  }

  if (isStreamingInProgress()) {
    logger.info('[Nutstore AutoBackup] Streaming in progress, deferring backup')
    scheduleNextBackup('fromNow')
    return
  }

  isAutoSyncRunning = true

  const maxRetries = 4
  let retryCount = 0
  let shouldScheduleNextRun = true

  while (retryCount < maxRetries) {
    try {
      logger.verbose(`[Nutstore AutoBackup] Starting automatic backup... (attempt ${retryCount + 1}/${maxRetries})`)
      store.dispatch(setNutstoreSyncState({ syncing: true, lastSyncError: null }))

      await backupToNutstore({
        autoBackupProcess: true
      })

      store.dispatch(
        setNutstoreSyncState({
          lastSyncError: null,
          lastSyncTime: Date.now(),
          syncing: false
        })
      )
      logger.info('[Nutstore AutoBackup] Automatic backup completed')
      break
    } catch (error: any) {
      retryCount++

      if (retryCount === maxRetries) {
        logger.error('[Nutstore AutoBackup] Automatic backup failed after all retries:', error as Error)
        store.dispatch(
          setNutstoreSyncState({
            lastSyncError: i18n.t('settings.data.auto_sync.messages.failed'),
            lastSyncTime: Date.now(),
            syncing: false
          })
        )

        await window.modal.error({
          title: i18n.t('message.backup.failed'),
          content: `[Nutstore AutoBackup] ${new Date().toLocaleString()} ${error.message}`
        })
      } else {
        const backoffDelay = Math.pow(2, retryCount - 1) * 10000 - 3000
        logger.warn(`[Nutstore AutoBackup] Failed, retry ${retryCount}/${maxRetries} after ${backoffDelay / 1000}s`)
        await new Promise((resolve) => setTimeout(resolve, backoffDelay))

        if (!isAutoSyncRunning) {
          logger.info('[Nutstore AutoBackup] Retry cancelled by user, exit')
          shouldScheduleNextRun = false
          break
        }
      }
    }
  }

  isAutoSyncRunning = false

  if (shouldScheduleNextRun) {
    scheduleNextBackup('fromNow')
  }
}

function isStreamingInProgress() {
  const loadingByTopic = store.getState().messages.loadingByTopic || {}
  return Object.values(loadingByTopic).some((loading) => loading === true)
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
