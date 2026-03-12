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
  AUTO_SYNC_FILE_NAME,
  decideAutoSyncAction,
  findAutoSyncSnapshot,
  getAutoSyncScopeKey,
  getNormalizedBackupData,
  getRemoteRevision,
  hasMeaningfulLocalData,
  loadAutoSyncMetadata,
  saveAutoSyncMetadata,
  type SyncFileEntry
} from './AutoSyncService'
import { NotificationService } from './NotificationService'

const logger = loggerService.withContext('BackupService')

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
  const fileContnet = await getBackupData()
  const selectFolder = await window.api.file.selectFolder()
  if (selectFolder) {
    await window.api.backup.backup(filename, fileContnet, selectFolder, skipBackupFile)
    window.toast.success(i18n.t('message.backup.success'))
  }
}

export async function restore() {
  const notificationService = NotificationService.getInstance()
  const file = await window.api.file.open({ filters: [{ name: '备份文件', extensions: ['bak', 'zip'] }] })

  if (file) {
    try {
      let data: Record<string, any> = {}

      // zip backup file
      if (file?.fileName.endsWith('.zip')) {
        const restoreData = await window.api.backup.restore(file.filePath)
        data = JSON.parse(restoreData)
      } else {
        data = JSON.parse(await window.api.zip.decompress(file.content))
      }

      await handleData(data)

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
      window.toast.error(i18n.t('error.backup.file_format'))
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
          await localStorage.clear()
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
  autoBackupProcess = false,
  backupData
}: {
  showMessage?: boolean
  customFileName?: string
  autoBackupProcess?: boolean
  backupData?: string
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
  const timestamp = dayjs().format('YYYYMMDDHHmmss')
  const backupFileName = customFileName || `cherry-studio.${timestamp}.${hostname}.${deviceType}.zip`
  const finalFileName = backupFileName.endsWith('.zip') ? backupFileName : `${backupFileName}.zip`
  const finalBackupData = backupData || (await getBackupData())

  // 上传文件
  try {
    const success = await window.api.backup.backupToWebdav(finalBackupData, {
      webdavHost,
      webdavUser,
      webdavPass,
      webdavPath,
      fileName: finalFileName,
      skipBackupFile: webdavSkipBackupFile,
      disableStream: webdavDisableStream
    })
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
          const currentDeviceFiles = files.filter((file) => {
            // 检查文件名是否包含当前设备的标识信息
            return file.fileName.includes(deviceType) && file.fileName.includes(hostname)
          })

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

// 从 webdav 恢复
export async function restoreFromWebdav(fileName?: string) {
  const { webdavHost, webdavUser, webdavPass, webdavPath } = store.getState().settings
  let data = ''

  try {
    data = await window.api.backup.restoreFromWebdav({ webdavHost, webdavUser, webdavPass, webdavPath, fileName })
  } catch (error: any) {
    logger.error('[Backup] restoreFromWebdav: Error downloading file from WebDAV:', error)
    window.modal.error({
      title: i18n.t('message.restore.failed'),
      content: error.message
    })
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
  autoBackupProcess = false,
  backupData
}: {
  showMessage?: boolean
  customFileName?: string
  autoBackupProcess?: boolean
  backupData?: string
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
  const timestamp = dayjs().format('YYYYMMDDHHmmss')
  const backupFileName = customFileName || `cherry-studio.${timestamp}.${hostname}.${deviceType}.zip`
  const finalFileName = backupFileName.endsWith('.zip') ? backupFileName : `${backupFileName}.zip`
  const finalBackupData = backupData || (await getBackupData())

  try {
    const success = await window.api.backup.backupToS3(finalBackupData, {
      ...s3Config,
      fileName: finalFileName
    })

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
            return file.fileName.includes(deviceType) && file.fileName.includes(hostname)
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

export function startAutoSync(immediate = false, type?: BackupType) {
  if (!type) {
    const settings = store.getState().settings
    const { webdavAutoSync, webdavHost, localBackupAutoSync, localBackupDir } = settings
    const s3Settings = settings.s3

    if (webdavAutoSync && webdavHost) {
      startAutoSync(immediate, 'webdav')
    }
    if (s3Settings?.autoSync && s3Settings?.endpoint) {
      startAutoSync(immediate, 's3')
    }
    if (localBackupAutoSync && localBackupDir) {
      startAutoSync(immediate, 'local')
    }
    return
  }

  stopAutoSync(type)

  if (type === 'webdav') {
    const settings = store.getState().settings
    const { webdavAutoSync, webdavHost } = settings

    if (!webdavAutoSync || !webdavHost) {
      logger.info('[WebdavAutoSync] Invalid sync settings, auto sync disabled')
      return
    }

    scheduleNextSync(immediate ? 'immediate' : 'fromLastSyncTime', 'webdav')
  } else if (type === 's3') {
    const settings = store.getState().settings
    const s3Settings = settings.s3

    if (!s3Settings?.autoSync || !s3Settings?.endpoint) {
      logger.verbose('Invalid sync settings, auto sync disabled')
      return
    }

    scheduleNextSync(immediate ? 'immediate' : 'fromLastSyncTime', 's3')
  } else if (type === 'local') {
    const settings = store.getState().settings
    const { localBackupAutoSync, localBackupDir } = settings

    if (!localBackupAutoSync || !localBackupDir) {
      logger.verbose('Invalid sync settings, auto sync disabled')
      return
    }

    scheduleNextSync(immediate ? 'immediate' : 'fromLastSyncTime', 'local')
  }

  function scheduleNextSync(scheduleType: 'immediate' | 'fromLastSyncTime' | 'fromNow', backupType: BackupType) {
    let syncInterval: number
    let lastSyncTime: number | undefined
    const settings = store.getState().settings
    const backup = store.getState().backup
    const logPrefix = getAutoSyncLogPrefix(backupType)

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
      logger.verbose(`${logPrefix} Invalid sync interval, auto sync disabled`)
      stopAutoSync(backupType)
      return
    }

    const requiredInterval = syncInterval * 60 * 1000
    let timeUntilNextSync = 1000

    switch (scheduleType) {
      case 'fromLastSyncTime':
        timeUntilNextSync = Math.max(1000, (lastSyncTime || 0) + requiredInterval - Date.now())
        break
      case 'fromNow':
        timeUntilNextSync = requiredInterval
        break
    }

    setAutoSyncTimeout(
      backupType,
      setTimeout(() => performAutoSync(backupType), timeUntilNextSync)
    )

    logger.verbose(
      `${logPrefix} Next sync scheduled in ${Math.floor(timeUntilNextSync / 1000 / 60)} minutes ${Math.floor(
        (timeUntilNextSync / 1000) % 60
      )} seconds`
    )
  }

  async function performAutoSync(backupType: BackupType) {
    const logPrefix = getAutoSyncLogPrefix(backupType)

    if (isAutoSyncRunning(backupType) || isManualBackupRunning) {
      logger.verbose(`${logPrefix} Sync already in progress, rescheduling`)
      scheduleNextSync('fromNow', backupType)
      return
    }

    if (isStreamingInProgress()) {
      logger.info(`${logPrefix} Streaming in progress, deferring sync`)
      scheduleNextSync('fromNow', backupType)
      return
    }

    setAutoSyncRunning(backupType, true)

    const maxRetries = 4
    let retryCount = 0

    while (retryCount < maxRetries) {
      try {
        logger.verbose(`${logPrefix} Starting auto sync... (attempt ${retryCount + 1}/${maxRetries})`)
        setAutoSyncState(backupType, { syncing: true, lastSyncError: null })

        const syncContext = await buildAutoSyncContext(backupType)
        const metadata = loadAutoSyncMetadata(syncContext.scopeKey)
        const remoteSnapshot = await listAutoSyncSnapshot(backupType, syncContext.localBackupDir)
        const remoteRevision = getRemoteRevision(remoteSnapshot)
        const action = decideAutoSyncAction({
          metadata,
          currentFingerprint: syncContext.currentFingerprint,
          remoteRevision,
          hasMeaningfulLocalState: syncContext.hasMeaningfulLocalState
        })

        if (action === 'push') {
          const pushedSnapshot = await pushAutoSyncSnapshot(backupType, syncContext.backupData)
          const pushedRevision = getRemoteRevision(pushedSnapshot)

          if (!pushedRevision) {
            throw new Error('Remote sync snapshot revision is missing after push')
          }

          saveAutoSyncMetadata(syncContext.scopeKey, {
            lastSyncedFingerprint: syncContext.currentFingerprint,
            lastRemoteRevision: pushedRevision
          })
          setAutoSyncState(backupType, {
            lastSyncError: null,
            lastSyncTime: Date.now(),
            syncing: false
          })
          logger.info(`${logPrefix} Pushed local changes to remote sync snapshot`)
        } else if (action === 'pull') {
          const remoteBackupData = await pullAutoSyncSnapshot(backupType, syncContext.localBackupDir)
          const pulledFingerprint = await window.api.backup.calculateSyncFingerprint(
            getNormalizedBackupData(remoteBackupData),
            syncContext.skipBackupFile
          )
          const refreshedRemoteSnapshot = await listAutoSyncSnapshot(backupType, syncContext.localBackupDir)
          const refreshedRemoteRevision = getRemoteRevision(refreshedRemoteSnapshot) || remoteRevision

          saveAutoSyncMetadata(syncContext.scopeKey, {
            lastSyncedFingerprint: pulledFingerprint,
            lastRemoteRevision: refreshedRemoteRevision
          })
          setAutoSyncState(backupType, {
            lastSyncError: null,
            lastSyncTime: Date.now(),
            syncing: false
          })
          logger.info(`${logPrefix} Pulled remote changes and restored local data`)
        } else if (action === 'conflict') {
          const conflictMessage = 'Sync conflict detected. Resolve local or remote changes manually before retrying.'

          setAutoSyncState(backupType, {
            lastSyncError: conflictMessage,
            syncing: false
          })
          logger.warn(`${logPrefix} ${conflictMessage}`)
        } else {
          saveAutoSyncMetadata(syncContext.scopeKey, {
            lastSyncedFingerprint: syncContext.currentFingerprint,
            lastRemoteRevision: remoteRevision
          })
          setAutoSyncState(backupType, {
            lastSyncError: null,
            lastSyncTime: Date.now(),
            syncing: false
          })
          logger.verbose(`${logPrefix} Local and remote snapshots are already in sync`)
        }

        setAutoSyncRunning(backupType, false)
        scheduleNextSync('fromNow', backupType)
        break
      } catch (error: any) {
        retryCount++
        if (retryCount === maxRetries) {
          logger.error(`${logPrefix} Auto sync failed after all retries:`, error)

          setAutoSyncState(backupType, {
            lastSyncError: 'Auto sync failed',
            lastSyncTime: Date.now(),
            syncing: false
          })

          await window.modal.error({
            title: i18n.t('message.backup.failed'),
            content: `${logPrefix} ${new Date().toLocaleString()} ` + error.message
          })

          scheduleNextSync('fromNow', backupType)
          setAutoSyncRunning(backupType, false)
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
            break
          }
        }
      }
    }
  }
}

export function stopAutoSync(type?: BackupType) {
  if (!type) {
    stopAutoSync('webdav')
    stopAutoSync('s3')
    stopAutoSync('local')
    return
  }

  if (type === 'webdav') {
    if (webdavSyncTimeout) {
      logger.info('[WebdavAutoSync] Stopping auto sync')
      clearTimeout(webdavSyncTimeout)
      webdavSyncTimeout = null
    }
    isWebdavAutoSyncRunning = false
  } else if (type === 's3') {
    if (s3SyncTimeout) {
      logger.info('[S3AutoSync] Stopping auto sync')
      clearTimeout(s3SyncTimeout)
      s3SyncTimeout = null
    }
    isS3AutoSyncRunning = false
  } else if (type === 'local') {
    if (localSyncTimeout) {
      logger.info('[LocalAutoSync] Stopping auto sync')
      clearTimeout(localSyncTimeout)
      localSyncTimeout = null
    }
    isLocalAutoSyncRunning = false
  }
}

function getAutoSyncLogPrefix(backupType: BackupType) {
  if (backupType === 'webdav') {
    return '[WebdavAutoSync]'
  }

  if (backupType === 's3') {
    return '[S3AutoSync]'
  }

  return '[LocalAutoSync]'
}

function setAutoSyncTimeout(backupType: BackupType, timeout: NodeJS.Timeout) {
  if (backupType === 'webdav') {
    webdavSyncTimeout = timeout
  } else if (backupType === 's3') {
    s3SyncTimeout = timeout
  } else {
    localSyncTimeout = timeout
  }
}

function isAutoSyncRunning(backupType: BackupType) {
  if (backupType === 'webdav') {
    return isWebdavAutoSyncRunning
  }

  if (backupType === 's3') {
    return isS3AutoSyncRunning
  }

  return isLocalAutoSyncRunning
}

function setAutoSyncRunning(backupType: BackupType, running: boolean) {
  if (backupType === 'webdav') {
    isWebdavAutoSyncRunning = running
  } else if (backupType === 's3') {
    isS3AutoSyncRunning = running
  } else {
    isLocalAutoSyncRunning = running
  }
}

function setAutoSyncState(
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

async function buildAutoSyncContext(backupType: BackupType) {
  const backupData = await getBackupData()
  const normalizedBackupData = getNormalizedBackupData(backupData)

  if (backupType === 'webdav') {
    const { webdavHost, webdavUser, webdavPath, webdavSkipBackupFile } = store.getState().settings

    return {
      backupData,
      currentFingerprint: await window.api.backup.calculateSyncFingerprint(normalizedBackupData, webdavSkipBackupFile),
      hasMeaningfulLocalState: hasMeaningfulLocalData(backupData),
      localBackupDir: undefined,
      scopeKey: getAutoSyncScopeKey('webdav', {
        webdavHost,
        webdavUser,
        webdavPath,
        skipBackupFile: webdavSkipBackupFile
      }),
      skipBackupFile: webdavSkipBackupFile
    }
  }

  if (backupType === 's3') {
    const s3Config = store.getState().settings.s3

    return {
      backupData,
      currentFingerprint: await window.api.backup.calculateSyncFingerprint(
        normalizedBackupData,
        s3Config.skipBackupFile
      ),
      hasMeaningfulLocalState: hasMeaningfulLocalData(backupData),
      localBackupDir: undefined,
      scopeKey: getAutoSyncScopeKey('s3', {
        endpoint: s3Config.endpoint,
        region: s3Config.region,
        bucket: s3Config.bucket,
        root: s3Config.root,
        skipBackupFile: s3Config.skipBackupFile
      }),
      skipBackupFile: s3Config.skipBackupFile
    }
  }

  const { localBackupDir: localBackupDirSetting, localBackupSkipBackupFile } = store.getState().settings
  const localBackupDir = await window.api.resolvePath(localBackupDirSetting)

  return {
    backupData,
    currentFingerprint: await window.api.backup.calculateSyncFingerprint(
      normalizedBackupData,
      localBackupSkipBackupFile
    ),
    hasMeaningfulLocalState: hasMeaningfulLocalData(backupData),
    localBackupDir,
    scopeKey: getAutoSyncScopeKey('local', {
      localBackupDir,
      skipBackupFile: localBackupSkipBackupFile
    }),
    skipBackupFile: localBackupSkipBackupFile
  }
}

async function listAutoSyncSnapshot(backupType: BackupType, localBackupDir?: string): Promise<SyncFileEntry | null> {
  let files: SyncFileEntry[] = []

  if (backupType === 'webdav') {
    const { webdavHost, webdavUser, webdavPass, webdavPath } = store.getState().settings
    files = await window.api.backup.listWebdavFiles({
      webdavHost,
      webdavUser,
      webdavPass,
      webdavPath
    })
  } else if (backupType === 's3') {
    files = await window.api.backup.listS3Files(store.getState().settings.s3)
  } else if (localBackupDir) {
    files = await window.api.backup.listLocalBackupFiles(localBackupDir)
  }

  return findAutoSyncSnapshot(files)
}

async function pushAutoSyncSnapshot(backupType: BackupType, backupData: string) {
  if (backupType === 'webdav') {
    await backupToWebdav({
      autoBackupProcess: true,
      backupData,
      customFileName: AUTO_SYNC_FILE_NAME
    })
    return await listAutoSyncSnapshot('webdav')
  }

  if (backupType === 's3') {
    await backupToS3({
      autoBackupProcess: true,
      backupData,
      customFileName: AUTO_SYNC_FILE_NAME
    })
    return await listAutoSyncSnapshot('s3')
  }

  await backupToLocal({
    autoBackupProcess: true,
    backupData,
    customFileName: AUTO_SYNC_FILE_NAME
  })

  const localBackupDir = await window.api.resolvePath(store.getState().settings.localBackupDir)
  return await listAutoSyncSnapshot('local', localBackupDir)
}

async function pullAutoSyncSnapshot(backupType: BackupType, localBackupDir?: string) {
  if (backupType === 'webdav') {
    const { webdavHost, webdavUser, webdavPass, webdavPath } = store.getState().settings
    const restoreData = await window.api.backup.restoreFromWebdav({
      webdavHost,
      webdavUser,
      webdavPass,
      webdavPath,
      fileName: AUTO_SYNC_FILE_NAME
    })
    await handleData(JSON.parse(restoreData))
    return restoreData
  }

  if (backupType === 's3') {
    const restoreData = await window.api.backup.restoreFromS3({
      ...store.getState().settings.s3,
      fileName: AUTO_SYNC_FILE_NAME
    })
    await handleData(JSON.parse(restoreData))
    return restoreData
  }

  if (!localBackupDir) {
    throw new Error('Local backup directory is required for local auto sync restore')
  }

  const restoreData = await window.api.backup.restoreFromLocalBackup(AUTO_SYNC_FILE_NAME, localBackupDir)
  await handleData(JSON.parse(restoreData))
  return restoreData
}

export async function getBackupData() {
  return JSON.stringify({
    time: new Date().getTime(),
    version: 5,
    localStorage,
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

    await localStorage.setItem('persist:cherry-studio', data.localStorage['persist:cherry-studio'])
    window.toast.success(i18n.t('message.restore.success'))
    setTimeout(() => window.api.relaunchApp(), 1000)
    return
  }

  if (data.version >= 2) {
    localStorage.setItem('persist:cherry-studio', data.localStorage['persist:cherry-studio'])

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
  const storeNames = await db.tables.map((table) => table.name)

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
  autoBackupProcess = false,
  backupData
}: {
  showMessage?: boolean
  customFileName?: string
  autoBackupProcess?: boolean
  backupData?: string
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
  const finalBackupData = backupData || (await getBackupData())

  try {
    const result = await window.api.backup.backupToLocalDir(finalBackupData, finalFileName, {
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

export async function restoreFromLocal(fileName: string) {
  try {
    const { localBackupDir: localBackupDirSetting } = store.getState().settings
    const localBackupDir = await window.api.resolvePath(localBackupDirSetting)
    const restoreData = await window.api.backup.restoreFromLocalBackup(fileName, localBackupDir)
    const data = JSON.parse(restoreData)
    await handleData(data)

    return true
  } catch (error) {
    logger.error('[LocalBackup] Restore failed:', error as Error)
    window.toast.error(i18n.t('error.backup.file_format'))
    throw error
  }
}
