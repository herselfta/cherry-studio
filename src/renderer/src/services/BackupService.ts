import { loggerService } from '@logger'
import db from '@renderer/databases'
import { upgradeToV7, upgradeToV8 } from '@renderer/databases/upgrades'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { setLocalBackupSyncState, setS3SyncState, setWebDAVSyncState } from '@renderer/store/backup'
import type { S3Config, WebDavConfig } from '@renderer/types'
import { uuid } from '@renderer/utils'
import dayjs from 'dayjs'

import {
  BACKUP_LOCAL_STORAGE_VERSION,
  createBackupLocalStorageSnapshot,
  restoreBackupLocalStorageSnapshot
} from './BackupLocalStorage'
import {
  buildBackupArtifactFileName,
  isRemotePortablePcArtifactFile,
  isStrictPcMigrationArtifactFile,
  LEGACY_PORTABLE_BACKUP_FILE_NAME,
  PC_MIGRATION_BACKUP_MARKER
} from './BackupArtifactService'
import { NotificationService } from './NotificationService'

const logger = loggerService.withContext('BackupService')

export const LEGACY_INTERNAL_BACKUP_FILE_NAME = LEGACY_PORTABLE_BACKUP_FILE_NAME
export const MIGRATION_BACKUP_MARKER = PC_MIGRATION_BACKUP_MARKER

export function isMigrationBackupFile(fileName: string) {
  // Migration backups intentionally keep using the legacy logical export format.
  // We tag new files explicitly so the local UI can separate portable archives from
  // same-platform direct snapshots and avoid restoring the wrong format by mistake.
  return isStrictPcMigrationArtifactFile(fileName)
}

export function isRemotePortablePcBackupFile(fileName: string) {
  return isRemotePortablePcArtifactFile(fileName)
}

// 重试删除S3文件的辅助函数
async function deleteS3FileWithRetry(fileName: string, s3Config: S3Config, maxRetries = 3) {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await window.api.backup.deleteS3File(fileName, s3Config)
      logger.verbose(`Successfully deleted old backup file: ${fileName} (attempt ${attempt})`)
      return true
    } catch (error: any) {
      lastError = error
      logger.warn(`Delete attempt ${attempt}/${maxRetries} failed for ${fileName}:`, error.message)

      // 如果不是最后一次尝试，等待一段时间再重试
      if (attempt < maxRetries) {
        const delay = attempt * 1000 + Math.random() * 1000 // 1-2秒的随机延迟
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  logger.error(`Failed to delete old backup file after ${maxRetries} attempts: ${fileName}`, lastError)
  return false
}

// 重试删除WebDAV文件的辅助函数
async function deleteWebdavFileWithRetry(fileName: string, webdavConfig: WebDavConfig, maxRetries = 3) {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await window.api.backup.deleteWebdavFile(fileName, webdavConfig)
      logger.verbose(`Successfully deleted old backup file: ${fileName} (attempt ${attempt})`)
      return true
    } catch (error: any) {
      lastError = error
      logger.warn(`Delete attempt ${attempt}/${maxRetries} failed for ${fileName}:`, error.message)

      // 如果不是最后一次尝试，等待一段时间再重试
      if (attempt < maxRetries) {
        const delay = attempt * 1000 + Math.random() * 1000 // 1-2秒的随机延迟
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  logger.error(`Failed to delete old backup file after ${maxRetries} attempts: ${fileName}`, lastError)
  return false
}

export async function backup(skipBackupFile: boolean) {
  const filename = `cherry-studio.${dayjs().format('YYYYMMDDHHmm')}.zip`
  const selectFolder = await window.api.file.selectFolder()
  if (selectFolder) {
    // Use direct backup method - copy IndexedDB/LocalStorage directories directly
    await window.api.backup.backup(filename, selectFolder, skipBackupFile)
    window.toast.success(i18n.t('message.backup.success'))
  }
}

export async function backupToLanTransfer() {
  // Let user select save location first
  const savePath = await window.api.file.selectFolder()

  if (!savePath) {
    return
  }

  // Create backup directly in the selected location
  const backupData = await getBackupData()
  await window.api.backup.createLanTransferBackup(backupData, savePath)

  window.toast.success(i18n.t('settings.data.export_to_phone.file.export_success'))
}

export async function restore() {
  const notificationService = NotificationService.getInstance()
  const file = await window.api.file.open({
    filters: [{ name: '备份文件', extensions: ['bak', 'zip'] }]
  })

  if (file) {
    try {
      // zip backup file
      if (file?.fileName.endsWith('.zip')) {
        const restoreData = await window.api.backup.restore(file.filePath)

        // Direct backup format returns void (app needs to relaunch)
        // Legacy format returns JSON string that needs to be processed
        if (restoreData !== undefined && restoreData !== null) {
          const data = JSON.parse(restoreData)
          await handleData(data)
        } else {
          // Direct backup was restored, app will relaunch
          notificationService.send({
            id: uuid(),
            type: 'success',
            title: i18n.t('common.success'),
            message: i18n.t('message.restore.success'),
            silent: false,
            timestamp: Date.now(),
            source: 'backup',
            channel: 'system'
          })
          // App will relaunch automatically
          return
        }
      } else {
        // Legacy .bak format
        const data = JSON.parse(await window.api.zip.decompress(file.content))
        await handleData(data)
      }

      notificationService.send({
        id: uuid(),
        type: 'success',
        title: i18n.t('common.success'),
        message: i18n.t('message.restore.success'),
        silent: false,
        timestamp: Date.now(),
        source: 'backup',
        channel: 'system'
      })
    } catch (error) {
      logger.error('restore: Error restoring backup file:', error as Error)
      window.modal.error({
        title: i18n.t('error.backup.file_format'),
        content: (error as Error).message,
        centered: true
      })
    }
  }
}

export async function reset() {
  window.modal.confirm({
    title: i18n.t('common.warning'),
    content: i18n.t('message.reset.confirm.content'),
    centered: true,
    okButtonProps: {
      danger: true
    },
    onOk: async () => {
      window.modal.confirm({
        title: i18n.t('message.reset.double.confirm.title'),
        content: i18n.t('message.reset.double.confirm.content'),
        centered: true,
        onOk: async () => {
          localStorage.clear()
          await clearDatabase()
          await window.api.resetData()
          window.toast.success(i18n.t('message.reset.success'))
          setTimeout(() => window.api.relaunchApp(), 1000)
        }
      })
    }
  })
}

// 备份到 webdav
/**
 * @param showMessage
 * @param customFileName
 * @param autoBackupProcess
 * if call in auto backup process, not show any message, any error will be thrown
 */
export async function backupToWebdav({
  showMessage = false,
  customFileName = '',
  autoBackupProcess = false
}: {
  showMessage?: boolean
  customFileName?: string
  autoBackupProcess?: boolean
} = {}) {
  const notificationService = NotificationService.getInstance()
  if (isManualBackupRunning) {
    logger.verbose('Manual backup already in progress')
    return
  }
  // force set showMessage to false when auto backup process
  if (autoBackupProcess) {
    showMessage = false
  }

  isManualBackupRunning = true

  store.dispatch(setWebDAVSyncState({ syncing: true, lastSyncError: null }))

  const {
    webdavHost,
    webdavUser,
    webdavPass,
    webdavPath,
    webdavMaxBackups,
    webdavSkipBackupFile,
    webdavDisableStream
  } = store.getState().settings
  let deviceType = 'unknown'
  let hostname = 'unknown'
  try {
    deviceType = (await window.api.system.getDeviceType()) || 'unknown'
    hostname = (await window.api.system.getHostname()) || 'unknown'
  } catch (error) {
    logger.error('Failed to get device type or hostname:', error as Error)
  }
  const backupFileName = customFileName || (await buildBackupArtifactFileName('pc'))
  const finalFileName = backupFileName.endsWith('.zip') ? backupFileName : `${backupFileName}.zip`

  // Remote backups must stay cross-platform portable. Do not switch WebDAV back to
  // direct backup snapshots unless cross-platform restore is intentionally dropped.
  try {
    const success = await window.api.backup.backupMigrationToWebdav(
      {
        webdavHost,
        webdavUser,
        webdavPass,
        webdavPath,
        fileName: finalFileName,
        skipBackupFile: webdavSkipBackupFile,
        disableStream: webdavDisableStream
      },
      await getBackupData()
    )
    if (success) {
      store.dispatch(
        setWebDAVSyncState({
          lastSyncError: null
        })
      )
      if (!autoBackupProcess) {
        notificationService.send({
          id: uuid(),
          type: 'success',
          title: i18n.t('common.success'),
          message: i18n.t('message.backup.success'),
          silent: false,
          timestamp: Date.now(),
          source: 'backup',
          channel: 'system'
        })
      }
      showMessage && window.toast.success(i18n.t('message.backup.success'))

      // 清理旧备份文件
      if (webdavMaxBackups > 0) {
        try {
          // 获取所有备份文件
          const files = await window.api.backup.listWebdavFiles({
            webdavHost,
            webdavUser,
            webdavPass,
            webdavPath
          })

          // 筛选当前设备的备份文件
          const currentDeviceFiles = files.filter(
            (file) =>
              file.fileName.includes(deviceType) &&
              file.fileName.includes(hostname) &&
              isRemotePortablePcBackupFile(file.fileName)
          )

          // 如果当前设备的备份文件数量超过最大保留数量，删除最旧的文件
          if (currentDeviceFiles.length > webdavMaxBackups) {
            // 文件已按修改时间降序排序，所以最旧的文件在末尾
            const filesToDelete = currentDeviceFiles.slice(webdavMaxBackups)

            logger.verbose(`Cleaning up ${filesToDelete.length} old backup files`)

            // 串行删除文件，避免并发请求导致的问题
            for (let i = 0; i < filesToDelete.length; i++) {
              const file = filesToDelete[i]
              await deleteWebdavFileWithRetry(file.fileName, {
                webdavHost,
                webdavUser,
                webdavPass,
                webdavPath
              })

              // 在删除操作之间添加短暂延迟，避免请求过于频繁
              if (i < filesToDelete.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, 500))
              }
            }
          }
        } catch (error) {
          logger.error('Failed to clean up old backup files:', error as Error)
        }
      }
    } else {
      // if auto backup process, throw error
      if (autoBackupProcess) {
        throw new Error(i18n.t('message.backup.failed'))
      }

      store.dispatch(setWebDAVSyncState({ lastSyncError: 'Backup failed' }))
      showMessage && window.toast.error(i18n.t('message.backup.failed'))
    }
  } catch (error: any) {
    // if auto backup process, throw error
    if (autoBackupProcess) {
      throw error
    }
    notificationService.send({
      id: uuid(),
      type: 'error',
      title: i18n.t('message.backup.failed'),
      message: error.message,
      silent: false,
      timestamp: Date.now(),
      source: 'backup',
      channel: 'system'
    })
    store.dispatch(setWebDAVSyncState({ lastSyncError: error.message }))
    showMessage && window.toast.error(i18n.t('message.backup.failed'))
    logger.error('[Backup] backupToWebdav: Error uploading file to WebDAV:', error)
    throw error
  } finally {
    if (!autoBackupProcess) {
      store.dispatch(
        setWebDAVSyncState({
          lastSyncTime: Date.now(),
          syncing: false
        })
      )
    }
    isManualBackupRunning = false
  }
}

export async function backupToWebdavWithConfig(
  webdavConfig: WebDavConfig,
  {
    showMessage = false,
    customFileName = '',
    autoBackupProcess = false
  }: {
    showMessage?: boolean
    customFileName?: string
    autoBackupProcess?: boolean
  } = {}
) {
  const notificationService = NotificationService.getInstance()
  if (isManualBackupRunning) {
    logger.verbose('Manual backup already in progress')
    return
  }

  if (autoBackupProcess) {
    showMessage = false
  }

  const shouldNotify = showMessage && !autoBackupProcess

  isManualBackupRunning = true

  store.dispatch(setWebDAVSyncState({ syncing: true, lastSyncError: null }))

  const { webdavMaxBackups } = store.getState().settings
  const backupFileName = customFileName || (await buildBackupArtifactFileName('pc'))
  const finalFileName = backupFileName.endsWith('.zip') ? backupFileName : `${backupFileName}.zip`

  try {
    const success = await window.api.backup.backupMigrationToWebdav(
      {
        ...webdavConfig,
        fileName: finalFileName
      },
      await getBackupData()
    )

    if (success) {
      store.dispatch(
        setWebDAVSyncState({
          lastSyncError: null
        })
      )

      if (shouldNotify) {
        notificationService.send({
          id: uuid(),
          type: 'success',
          title: i18n.t('common.success'),
          message: i18n.t('message.backup.success'),
          silent: false,
          timestamp: Date.now(),
          source: 'backup',
          channel: 'system'
        })
      }

      if (webdavMaxBackups > 0) {
        try {
          const files = await window.api.backup.listWebdavFiles(webdavConfig)
          const currentDeviceFiles = files
            .filter((file) => isRemotePortablePcBackupFile(file.fileName))
            .sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime())

          if (currentDeviceFiles.length > webdavMaxBackups) {
            const filesToDelete = currentDeviceFiles.slice(webdavMaxBackups)

            await Promise.all(
              filesToDelete.map((file) =>
                deleteWebdavFileWithRetry(file.fileName, webdavConfig).catch((error) => {
                  logger.error(`[WebDAV] Failed to delete old backup file ${file.fileName}:`, error)
                })
              )
            )
          }
        } catch (error) {
          logger.error('[WebDAV] Failed to cleanup old backup files:', error as Error)
        }
      }
    } else {
      store.dispatch(setWebDAVSyncState({ lastSyncError: 'Backup failed' }))
      if (shouldNotify) {
        notificationService.send({
          id: uuid(),
          type: 'error',
          title: i18n.t('common.error'),
          message: i18n.t('message.backup.failed'),
          silent: false,
          timestamp: Date.now(),
          source: 'backup',
          channel: 'system'
        })
      }
      throw new Error(i18n.t('message.backup.failed'))
    }
  } catch (error: any) {
    store.dispatch(setWebDAVSyncState({ lastSyncError: error.message }))
    logger.error('[Backup] backupToWebdavWithConfig: Error uploading file to WebDAV:', error)
    if (shouldNotify) {
      notificationService.send({
        id: uuid(),
        type: 'error',
        title: i18n.t('common.error'),
        message: error.message || i18n.t('message.backup.failed'),
        silent: false,
        timestamp: Date.now(),
        source: 'backup',
        channel: 'system'
      })
    }
    throw error
  } finally {
    if (!autoBackupProcess) {
      store.dispatch(
        setWebDAVSyncState({
          lastSyncTime: Date.now(),
          syncing: false
        })
      )
    }
    isManualBackupRunning = false
  }
}

// 从 webdav 恢复
export async function restoreFromWebdav(fileName?: string) {
  const { webdavHost, webdavUser, webdavPass, webdavPath } = store.getState().settings
  await restoreFromWebdavWithConfig(
    {
      webdavHost,
      webdavUser,
      webdavPass,
      webdavPath
    },
    fileName
  )
}

export async function restoreFromWebdavWithConfig(webdavConfig: WebDavConfig, fileName?: string) {
  let data = ''

  try {
    data = await window.api.backup.restoreFromWebdav({
      ...webdavConfig,
      fileName
    })
  } catch (error: any) {
    logger.error('[Backup] restoreFromWebdavWithConfig: Error downloading file from WebDAV:', error)
    window.modal.error({
      title: i18n.t('message.restore.failed'),
      content: error.message
    })
    return
  }

  if (!data) {
    logger.info('[WebDAVBackup] Direct backup restored, app will restart')
    return
  }

  try {
    await handleData(JSON.parse(data))
  } catch (error) {
    logger.error('[Backup] Error downloading file from WebDAV:', error as Error)
    window.toast.error(i18n.t('error.backup.file_format'))
  }
}

export async function backupToS3({
  showMessage = false,
  customFileName = '',
  autoBackupProcess = false
}: {
  showMessage?: boolean
  customFileName?: string
  autoBackupProcess?: boolean
} = {}) {
  const notificationService = NotificationService.getInstance()
  if (isManualBackupRunning) {
    logger.verbose('Manual backup already in progress')
    return
  }

  if (autoBackupProcess) {
    showMessage = false
  }

  isManualBackupRunning = true

  store.dispatch(setS3SyncState({ syncing: true, lastSyncError: null }))

  const s3Config = store.getState().settings.s3
  let deviceType = 'unknown'
  let hostname = 'unknown'
  try {
    deviceType = (await window.api.system.getDeviceType()) || 'unknown'
    hostname = (await window.api.system.getHostname()) || 'unknown'
  } catch (error) {
    logger.error('Failed to get device type or hostname:', error as Error)
  }
  const backupFileName = customFileName || (await buildBackupArtifactFileName('pc'))
  const finalFileName = backupFileName.endsWith('.zip') ? backupFileName : `${backupFileName}.zip`

  try {
    const success = await window.api.backup.backupMigrationToS3(
      {
        ...s3Config,
        fileName: finalFileName
      },
      await getBackupData()
    )

    if (success) {
      store.dispatch(
        setS3SyncState({
          lastSyncError: null,
          syncing: false,
          lastSyncTime: Date.now()
        })
      )
      if (!autoBackupProcess) {
        notificationService.send({
          id: uuid(),
          type: 'success',
          title: i18n.t('common.success'),
          message: i18n.t('message.backup.success'),
          silent: false,
          timestamp: Date.now(),
          source: 'backup',
          channel: 'system'
        })
      }
      showMessage && window.toast.success(i18n.t('message.backup.success'))

      // 清理旧备份文件
      if (s3Config.maxBackups > 0) {
        try {
          // 获取所有备份文件
          const files = await window.api.backup.listS3Files(s3Config)

          // 筛选当前设备的备份文件
          const currentDeviceFiles = files.filter((file) => {
            return (
              file.fileName.includes(deviceType) &&
              file.fileName.includes(hostname) &&
              isRemotePortablePcBackupFile(file.fileName)
            )
          })

          // 如果当前设备的备份文件数量超过最大保留数量，删除最旧的文件
          if (currentDeviceFiles.length > s3Config.maxBackups) {
            const filesToDelete = currentDeviceFiles.slice(s3Config.maxBackups)

            logger.verbose(`Cleaning up ${filesToDelete.length} old backup files`)

            for (let i = 0; i < filesToDelete.length; i++) {
              const file = filesToDelete[i]
              await deleteS3FileWithRetry(file.fileName, s3Config)

              if (i < filesToDelete.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, 500))
              }
            }
          }
        } catch (error) {
          logger.error('Failed to clean up old backup files:', error as Error)
        }
      }
    } else {
      if (autoBackupProcess) {
        throw new Error(i18n.t('message.backup.failed'))
      }

      store.dispatch(setS3SyncState({ lastSyncError: 'Backup failed' }))
      showMessage && window.toast.error(i18n.t('message.backup.failed'))
    }
  } catch (error: any) {
    if (autoBackupProcess) {
      throw error
    }
    notificationService.send({
      id: uuid(),
      type: 'error',
      title: i18n.t('message.backup.failed'),
      message: error.message,
      silent: false,
      timestamp: Date.now(),
      source: 'backup',
      channel: 'system'
    })
    store.dispatch(setS3SyncState({ lastSyncError: error.message }))
    logger.error('backupToS3: Error uploading file to S3:', error)
    showMessage && window.toast.error(i18n.t('message.backup.failed'))
    throw error
  } finally {
    if (!autoBackupProcess) {
      store.dispatch(
        setS3SyncState({
          lastSyncTime: Date.now(),
          syncing: false
        })
      )
    }
    isManualBackupRunning = false
  }
}

// 从 S3 恢复
export async function restoreFromS3(fileName?: string) {
  const s3Config = store.getState().settings.s3

  if (!fileName) {
    const files = await window.api.backup.listS3Files(s3Config)
    if (files.length > 0) {
      fileName = files[0].fileName
    }
  }

  if (fileName) {
    const restoreData = await window.api.backup.restoreFromS3({
      ...s3Config,
      fileName
    })

    // Direct backup format (version 6+) returns undefined - app needs to relaunch
    if (!restoreData) {
      logger.info('[S3Backup] Direct backup restored, app will restart')
      return
    }

    // Legacy backup format (version <= 5) returns JSON string
    const data = JSON.parse(restoreData)
    await handleData(data)
  }
}

let isManualBackupRunning = false

// 为每种备份类型维护独立的状态
let webdavSyncTimeout: NodeJS.Timeout | null = null
let isWebdavAutoSyncRunning = false

let s3SyncTimeout: NodeJS.Timeout | null = null
let isS3AutoSyncRunning = false

let localSyncTimeout: NodeJS.Timeout | null = null
let isLocalAutoSyncRunning = false

type BackupType = 'webdav' | 's3' | 'local'

export function startAutoBackup(immediate = false, type?: BackupType) {
  if (!type) {
    const settings = store.getState().settings
    const { webdavAutoSync, webdavHost, localBackupAutoSync, localBackupDir } = settings
    const s3Settings = settings.s3

    if (webdavAutoSync && webdavHost) {
      startAutoBackup(immediate, 'webdav')
    }
    if (s3Settings?.autoSync && s3Settings?.endpoint) {
      startAutoBackup(immediate, 's3')
    }
    if (localBackupAutoSync && localBackupDir) {
      startAutoBackup(immediate, 'local')
    }
    return
  }

  stopAutoBackup(type)

  if (type === 'webdav') {
    const settings = store.getState().settings
    const { webdavAutoSync, webdavHost } = settings

    if (!webdavAutoSync || !webdavHost) {
      logger.info('[WebdavAutoBackup] Invalid backup settings, auto backup disabled')
      return
    }

    scheduleNextBackup(immediate ? 'immediate' : 'fromLastSyncTime', 'webdav')
  } else if (type === 's3') {
    const settings = store.getState().settings
    const s3Settings = settings.s3

    if (!s3Settings?.autoSync || !s3Settings?.endpoint) {
      logger.verbose('[S3AutoBackup] Invalid backup settings, auto backup disabled')
      return
    }

    scheduleNextBackup(immediate ? 'immediate' : 'fromLastSyncTime', 's3')
  } else if (type === 'local') {
    const settings = store.getState().settings
    const { localBackupAutoSync, localBackupDir } = settings

    if (!localBackupAutoSync || !localBackupDir) {
      logger.verbose('[LocalAutoBackup] Invalid backup settings, auto backup disabled')
      return
    }

    scheduleNextBackup(immediate ? 'immediate' : 'fromLastSyncTime', 'local')
  }

  function scheduleNextBackup(scheduleType: 'immediate' | 'fromLastSyncTime' | 'fromNow', backupType: BackupType) {
    let syncInterval: number
    let lastSyncTime: number | undefined
    const settings = store.getState().settings
    const backup = store.getState().backup
    const logPrefix = getAutoBackupLogPrefix(backupType)

    if (backupType === 'webdav') {
      if (webdavSyncTimeout) {
        clearTimeout(webdavSyncTimeout)
        webdavSyncTimeout = null
      }
      syncInterval = settings.webdavSyncInterval
      lastSyncTime = backup.webdavSync?.lastSyncTime || undefined
    } else if (backupType === 's3') {
      if (s3SyncTimeout) {
        clearTimeout(s3SyncTimeout)
        s3SyncTimeout = null
      }
      syncInterval = settings.s3?.syncInterval || 0
      lastSyncTime = backup.s3Sync?.lastSyncTime || undefined
    } else if (backupType === 'local') {
      if (localSyncTimeout) {
        clearTimeout(localSyncTimeout)
        localSyncTimeout = null
      }
      syncInterval = settings.localBackupSyncInterval
      lastSyncTime = backup.localBackupSync?.lastSyncTime || undefined
    } else {
      return
    }

    if (!syncInterval || syncInterval <= 0) {
      logger.verbose(`${logPrefix} Invalid backup interval, auto backup disabled`)
      stopAutoBackup(backupType)
      return
    }

    const requiredInterval = syncInterval * 60 * 1000
    let timeUntilNextBackup = 1000

    switch (scheduleType) {
      case 'fromLastSyncTime':
        timeUntilNextBackup = Math.max(1000, (lastSyncTime || 0) + requiredInterval - Date.now())
        break
      case 'fromNow':
        timeUntilNextBackup = requiredInterval
        break
    }

    setAutoBackupTimeout(
      backupType,
      setTimeout(() => performAutoBackup(backupType), timeUntilNextBackup)
    )

    logger.verbose(
      `${logPrefix} Next backup scheduled in ${Math.floor(timeUntilNextBackup / 1000 / 60)} minutes ${Math.floor(
        (timeUntilNextBackup / 1000) % 60
      )} seconds`
    )
  }

  async function performAutoBackup(backupType: BackupType) {
    const logPrefix = getAutoBackupLogPrefix(backupType)

    if (isAutoBackupRunning(backupType) || isManualBackupRunning) {
      logger.verbose(`${logPrefix} Backup already in progress, rescheduling`)
      scheduleNextBackup('fromNow', backupType)
      return
    }

    if (isStreamingInProgress()) {
      logger.info(`${logPrefix} Streaming in progress, deferring backup`)
      scheduleNextBackup('fromNow', backupType)
      return
    }

    setAutoBackupRunning(backupType, true)

    const maxRetries = 4
    let retryCount = 0
    let shouldScheduleNextRun = true

    while (retryCount < maxRetries) {
      try {
        logger.verbose(`${logPrefix} Starting automatic backup... (attempt ${retryCount + 1}/${maxRetries})`)
        setAutoBackupState(backupType, { syncing: true, lastSyncError: null })

        if (backupType === 'webdav') {
          await backupToWebdav({ autoBackupProcess: true })
        } else if (backupType === 's3') {
          await backupToS3({ autoBackupProcess: true })
        } else {
          await backupToLocal({ autoBackupProcess: true })
        }

        setAutoBackupState(backupType, {
          lastSyncError: null,
          lastSyncTime: Date.now(),
          syncing: false
        })
        logger.info(`${logPrefix} Automatic backup completed`)
        break
      } catch (error: any) {
        retryCount++
        if (retryCount === maxRetries) {
          logger.error(`${logPrefix} Automatic backup failed after all retries:`, error as Error)

          setAutoBackupState(backupType, {
            lastSyncError: i18n.t('settings.data.auto_sync.messages.failed'),
            lastSyncTime: Date.now(),
            syncing: false
          })

          await window.modal.error({
            title: i18n.t('message.backup.failed'),
            content: `${logPrefix} ${new Date().toLocaleString()} ` + error.message
          })
        } else {
          const backoffDelay = Math.pow(2, retryCount - 1) * 10000 - 3000
          logger.warn(`${logPrefix} Failed, retry ${retryCount}/${maxRetries} after ${backoffDelay / 1000}s`)

          await new Promise((resolve) => setTimeout(resolve, backoffDelay))

          // 检查是否被用户停止
          let currentRunning: boolean
          if (backupType === 'webdav') {
            currentRunning = isWebdavAutoSyncRunning
          } else if (backupType === 's3') {
            currentRunning = isS3AutoSyncRunning
          } else {
            currentRunning = isLocalAutoSyncRunning
          }

          if (!currentRunning) {
            logger.info(`${logPrefix} retry cancelled by user, exit`)
            shouldScheduleNextRun = false
            break
          }
        }
      }
    }

    setAutoBackupRunning(backupType, false)

    if (shouldScheduleNextRun) {
      scheduleNextBackup('fromNow', backupType)
    }
  }
}

export function stopAutoBackup(type?: BackupType) {
  if (!type) {
    stopAutoBackup('webdav')
    stopAutoBackup('s3')
    stopAutoBackup('local')
    return
  }

  if (type === 'webdav') {
    if (webdavSyncTimeout) {
      logger.info('[WebdavAutoBackup] Stopping automatic backup')
      clearTimeout(webdavSyncTimeout)
      webdavSyncTimeout = null
    }
    isWebdavAutoSyncRunning = false
  } else if (type === 's3') {
    if (s3SyncTimeout) {
      logger.info('[S3AutoBackup] Stopping automatic backup')
      clearTimeout(s3SyncTimeout)
      s3SyncTimeout = null
    }
    isS3AutoSyncRunning = false
  } else if (type === 'local') {
    if (localSyncTimeout) {
      logger.info('[LocalAutoBackup] Stopping automatic backup')
      clearTimeout(localSyncTimeout)
      localSyncTimeout = null
    }
    isLocalAutoSyncRunning = false
  }
}

function getAutoBackupLogPrefix(backupType: BackupType) {
  if (backupType === 'webdav') {
    return '[WebdavAutoBackup]'
  }

  if (backupType === 's3') {
    return '[S3AutoBackup]'
  }

  return '[LocalAutoBackup]'
}

function setAutoBackupTimeout(backupType: BackupType, timeout: NodeJS.Timeout) {
  if (backupType === 'webdav') {
    webdavSyncTimeout = timeout
  } else if (backupType === 's3') {
    s3SyncTimeout = timeout
  } else {
    localSyncTimeout = timeout
  }
}

function isAutoBackupRunning(backupType: BackupType) {
  if (backupType === 'webdav') {
    return isWebdavAutoSyncRunning
  }

  if (backupType === 's3') {
    return isS3AutoSyncRunning
  }

  return isLocalAutoSyncRunning
}

function setAutoBackupRunning(backupType: BackupType, running: boolean) {
  if (backupType === 'webdav') {
    isWebdavAutoSyncRunning = running
  } else if (backupType === 's3') {
    isS3AutoSyncRunning = running
  } else {
    isLocalAutoSyncRunning = running
  }
}

function setAutoBackupState(
  backupType: BackupType,
  payload: {
    lastSyncTime?: number | null
    syncing?: boolean
    lastSyncError?: string | null
  }
) {
  if (backupType === 'webdav') {
    store.dispatch(setWebDAVSyncState(payload))
  } else if (backupType === 's3') {
    store.dispatch(setS3SyncState(payload))
  } else {
    store.dispatch(setLocalBackupSyncState(payload))
  }
}

function isStreamingInProgress() {
  const loadingByTopic = store.getState().messages.loadingByTopic || {}
  return Object.values(loadingByTopic).some((loading) => loading === true)
}

export async function getBackupData() {
  return JSON.stringify({
    time: new Date().getTime(),
    version: BACKUP_LOCAL_STORAGE_VERSION,
    localStorage: createBackupLocalStorageSnapshot(),
    indexedDB: await backupDatabase()
  })
}

/************************************* Backup Utils ************************************** */
export async function handleData(data: Record<string, any>) {
  if (data.version === 1) {
    await clearDatabase()

    for (const { key, value } of data.indexedDB) {
      if (key.startsWith('topic:')) {
        await db.table('topics').add({ id: value.id, messages: value.messages })
      }
      if (key === 'image://avatar') {
        await db.table('settings').add({ id: key, value })
      }
    }

    restoreBackupLocalStorageSnapshot(data.localStorage)
    window.toast.success(i18n.t('message.restore.success'))
    setTimeout(() => window.api.relaunchApp(), 1000)
    return
  }

  if (data.version >= 2) {
    restoreBackupLocalStorageSnapshot(data.localStorage, {
      removeMissingPortableKeys: data.version >= BACKUP_LOCAL_STORAGE_VERSION
    })

    // remove notes_tree from indexedDB
    if (data.indexedDB['notes_tree']) {
      delete data.indexedDB['notes_tree']
    }

    await restoreDatabase(data.indexedDB)

    if (data.version === 3) {
      await db.transaction('rw', db.tables, async (tx) => {
        await db.table('message_blocks').clear()
        await upgradeToV7(tx)
      })
    }

    if (data.version === 4) {
      await db.transaction('rw', db.tables, async (tx) => {
        await upgradeToV8(tx)
      })
    }

    window.toast.success(i18n.t('message.restore.success'))
    setTimeout(() => window.api.relaunchApp(), 1000)
    return
  }

  window.toast.error(i18n.t('error.backup.file_format'))
}

async function backupDatabase() {
  const tables = db.tables
  const backup = {}

  for (const table of tables) {
    backup[table.name] = await table.toArray()
  }

  return backup
}

async function restoreDatabase(backup: Record<string, any>) {
  await db.transaction('rw', db.tables, async () => {
    for (const tableName in backup) {
      await db.table(tableName).clear()
      await db.table(tableName).bulkAdd(backup[tableName])
    }
  })
}

async function clearDatabase() {
  const storeNames = db.tables.map((table) => table.name)

  await db.transaction('rw', db.tables, async () => {
    for (const storeName of storeNames) {
      await db[storeName].clear()
    }
  })
}

/**
 * Backup to local directory
 */
export async function backupToLocal({
  showMessage = false,
  customFileName = '',
  autoBackupProcess = false
}: {
  showMessage?: boolean
  customFileName?: string
  autoBackupProcess?: boolean
} = {}) {
  const notificationService = NotificationService.getInstance()
  if (isManualBackupRunning) {
    logger.verbose('Manual backup already in progress')
    return
  }
  // force set showMessage to false when auto backup process
  if (autoBackupProcess) {
    showMessage = false
  }

  isManualBackupRunning = true

  store.dispatch(setLocalBackupSyncState({ syncing: true, lastSyncError: null }))

  const {
    localBackupDir: localBackupDirSetting,
    localBackupMaxBackups,
    localBackupSkipBackupFile
  } = store.getState().settings
  const localBackupDir = await window.api.resolvePath(localBackupDirSetting)
  let deviceType = 'unknown'
  let hostname = 'unknown'
  try {
    deviceType = (await window.api.system.getDeviceType()) || 'unknown'
    hostname = (await window.api.system.getHostname()) || 'unknown'
  } catch (error) {
    logger.error('Failed to get device type or hostname:', error as Error)
  }
  const timestamp = dayjs().format('YYYYMMDDHHmmss')
  const backupFileName = customFileName || `cherry-studio.${timestamp}.${hostname}.${deviceType}.zip`
  const finalFileName = backupFileName.endsWith('.zip') ? backupFileName : `${backupFileName}.zip`

  try {
    // Use direct backup method (copy IndexedDB/LocalStorage directories)
    const result = await window.api.backup.backupToLocalDir(finalFileName, {
      localBackupDir,
      skipBackupFile: localBackupSkipBackupFile
    })

    if (result) {
      store.dispatch(
        setLocalBackupSyncState({
          lastSyncError: null
        })
      )

      if (showMessage) {
        notificationService.send({
          id: uuid(),
          type: 'success',
          title: i18n.t('common.success'),
          message: i18n.t('message.backup.success'),
          silent: false,
          timestamp: Date.now(),
          source: 'backup',
          channel: 'system'
        })
      }

      // Clean up old backups if maxBackups is set
      if (localBackupMaxBackups > 0) {
        try {
          // Get all backup files
          const files = await window.api.backup.listLocalBackupFiles(localBackupDir)

          // Filter backups for current device
          const currentDeviceFiles = files.filter((file) => {
            return file.fileName.includes(deviceType) && file.fileName.includes(hostname)
          })

          if (currentDeviceFiles.length > localBackupMaxBackups) {
            // Sort by modified time (oldest first)
            const filesToDelete = currentDeviceFiles
              .sort((a, b) => new Date(a.modifiedTime).getTime() - new Date(b.modifiedTime).getTime())
              .slice(0, currentDeviceFiles.length - localBackupMaxBackups)

            // Delete older backups
            for (const file of filesToDelete) {
              logger.verbose(`[LocalBackup] Deleting old backup: ${file.fileName}`)
              await window.api.backup.deleteLocalBackupFile(file.fileName, localBackupDir)
            }
          }
        } catch (error) {
          logger.error('[LocalBackup] Failed to clean up old backups:', error as Error)
        }
      }
    } else {
      if (autoBackupProcess) {
        throw new Error(i18n.t('message.backup.failed'))
      }

      store.dispatch(
        setLocalBackupSyncState({
          lastSyncError: 'Backup failed'
        })
      )

      if (showMessage) {
        window.modal.error({
          title: i18n.t('message.backup.failed'),
          content: 'Backup failed'
        })
      }
    }

    return result
  } catch (error: any) {
    if (autoBackupProcess) {
      throw error
    }

    logger.error('[LocalBackup] Backup failed:', error)

    store.dispatch(
      setLocalBackupSyncState({
        lastSyncError: error.message || 'Unknown error'
      })
    )

    if (showMessage) {
      window.modal.error({
        title: i18n.t('message.backup.failed'),
        content: error.message || 'Unknown error'
      })
    }

    throw error
  } finally {
    if (!autoBackupProcess) {
      store.dispatch(
        setLocalBackupSyncState({
          lastSyncTime: Date.now(),
          syncing: false
        })
      )
    }
    isManualBackupRunning = false
  }
}

export async function backupMigrationToLocal({
  showMessage = false,
  customFileName = ''
}: {
  showMessage?: boolean
  customFileName?: string
} = {}) {
  // Local backup settings expose both quick same-platform snapshots and portable
  // migration archives. This method is the portable variant used for cross-platform restore.
  const notificationService = NotificationService.getInstance()
  if (isManualBackupRunning) {
    logger.verbose('Manual backup already in progress')
    return
  }

  isManualBackupRunning = true
  store.dispatch(setLocalBackupSyncState({ syncing: true, lastSyncError: null }))

  const { localBackupDir: localBackupDirSetting, localBackupSkipBackupFile } = store.getState().settings
  const localBackupDir = await window.api.resolvePath(localBackupDirSetting)

  const backupFileName = customFileName || (await buildBackupArtifactFileName('pc'))
  const finalFileName = backupFileName.endsWith('.zip') ? backupFileName : `${backupFileName}.zip`

  try {
    const result = await window.api.backup.backupMigrationToLocalDir(finalFileName, await getBackupData(), {
      localBackupDir,
      skipBackupFile: localBackupSkipBackupFile
    })

    if (result && showMessage) {
      notificationService.send({
        id: uuid(),
        type: 'success',
        title: i18n.t('common.success'),
        message: i18n.t('message.backup.success'),
        silent: false,
        timestamp: Date.now(),
        source: 'backup',
        channel: 'system'
      })
    }

    return result
  } catch (error: any) {
    logger.error('[LocalMigrationBackup] Backup failed:', error)
    store.dispatch(setLocalBackupSyncState({ lastSyncError: error.message || 'Unknown error' }))
    if (showMessage) {
      window.modal.error({
        title: i18n.t('message.backup.failed'),
        content: error.message || 'Unknown error'
      })
    }
    throw error
  } finally {
    store.dispatch(setLocalBackupSyncState({ lastSyncTime: Date.now(), syncing: false }))
    isManualBackupRunning = false
  }
}

export async function restoreMigrationFromLocal(fileName: string) {
  return restoreFromLocal(fileName)
}

export async function restoreFromLocal(fileName: string) {
  try {
    const { localBackupDir: localBackupDirSetting } = store.getState().settings
    const localBackupDir = await window.api.resolvePath(localBackupDirSetting)
    const restoreData = await window.api.backup.restoreFromLocalBackup(fileName, localBackupDir)

    // Direct backup format (version 6+) returns undefined - app needs to relaunch
    if (!restoreData) {
      logger.info('[LocalBackup] Direct backup restored, app will restart')
      return true
    }

    // Legacy backup format (version <= 5) returns JSON string
    const data = JSON.parse(restoreData)
    await handleData(data)

    return true
  } catch (error) {
    logger.error('[LocalBackup] Restore failed:', error as Error)
    window.toast.error(i18n.t('error.backup.file_format'))
    throw error
  }
}
