import { loggerService } from '@logger'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import type { S3Config, WebDavConfig } from '@renderer/types'
import { NUTSTORE_HOST } from '@shared/config/nutstore'

import { AUTO_SYNC_FILE_NAME } from './AutoSyncService'
import {
  backupToLocal,
  backupToS3,
  backupToWebdav,
  restoreFromLocal,
  restoreFromS3,
  restoreFromWebdav
} from './BackupService'
import { backupToNutstore, restoreFromNutstore } from './NutstoreService'

const logger = loggerService.withContext('ManualSyncScheduleService')

const MANUAL_SYNC_SCHEDULE_STORAGE_KEY = 'cherry-studio:manual-sync:schedules:v1'

export type ManualSyncProvider = 'webdav' | 's3' | 'local' | 'nutstore'
export type ManualSyncAction = 'upload' | 'restore'

export interface ManualSyncScheduleConfig {
  uploadTimes: string[]
  restoreTimes: string[]
  confirmBeforeRestore: boolean
}

type ManualSyncScheduleMap = Record<ManualSyncProvider, ManualSyncScheduleConfig>

type BackupFile = {
  fileName: string
  modifiedTime: string
  size: number
}

const PROVIDERS: ManualSyncProvider[] = ['webdav', 's3', 'local', 'nutstore']

const DEFAULT_MANUAL_SYNC_SCHEDULE_CONFIG: ManualSyncScheduleConfig = {
  uploadTimes: [],
  restoreTimes: [],
  confirmBeforeRestore: true
}

const DEFAULT_MANUAL_SYNC_SCHEDULES: ManualSyncScheduleMap = {
  webdav: DEFAULT_MANUAL_SYNC_SCHEDULE_CONFIG,
  s3: DEFAULT_MANUAL_SYNC_SCHEDULE_CONFIG,
  local: DEFAULT_MANUAL_SYNC_SCHEDULE_CONFIG,
  nutstore: DEFAULT_MANUAL_SYNC_SCHEDULE_CONFIG
}

const scheduleTimers = new Map<string, ReturnType<typeof setTimeout>>()
let schedulerStarted = false
let taskQueue = Promise.resolve()

export function loadManualSyncSchedule(provider: ManualSyncProvider): ManualSyncScheduleConfig {
  return loadManualSyncSchedules()[provider]
}

export function saveManualSyncSchedule(provider: ManualSyncProvider, config: ManualSyncScheduleConfig) {
  const scheduleMap = loadManualSyncSchedules()
  scheduleMap[provider] = normalizeManualSyncScheduleConfig(config)
  localStorage.setItem(MANUAL_SYNC_SCHEDULE_STORAGE_KEY, JSON.stringify(scheduleMap))
}

export function loadManualSyncSchedules(): ManualSyncScheduleMap {
  const storedValue = localStorage.getItem(MANUAL_SYNC_SCHEDULE_STORAGE_KEY)

  if (!storedValue) {
    return { ...DEFAULT_MANUAL_SYNC_SCHEDULES }
  }

  try {
    const parsed = JSON.parse(storedValue)

    return PROVIDERS.reduce<ManualSyncScheduleMap>(
      (result, provider) => {
        result[provider] = normalizeManualSyncScheduleConfig(parsed?.[provider])
        return result
      },
      { ...DEFAULT_MANUAL_SYNC_SCHEDULES }
    )
  } catch (error) {
    logger.warn('Failed to parse manual sync schedules, resetting them', error as Error)
    return { ...DEFAULT_MANUAL_SYNC_SCHEDULES }
  }
}

export function normalizeManualSyncScheduleConfig(
  config?: Partial<ManualSyncScheduleConfig> | null
): ManualSyncScheduleConfig {
  return {
    uploadTimes: sortManualSyncTimes(config?.uploadTimes ?? []),
    restoreTimes: sortManualSyncTimes(config?.restoreTimes ?? []),
    confirmBeforeRestore: config?.confirmBeforeRestore ?? DEFAULT_MANUAL_SYNC_SCHEDULE_CONFIG.confirmBeforeRestore
  }
}

export function normalizeManualSyncTime(time: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!match) {
    return null
  }

  const hour = Number(match[1])
  const minute = Number(match[2])

  if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function sortManualSyncTimes(times: string[]): string[] {
  const normalized = times.map((time) => normalizeManualSyncTime(time)).filter((time): time is string => Boolean(time))

  return Array.from(new Set(normalized)).sort((left, right) => left.localeCompare(right))
}

export function getNextManualSyncOccurrence(now: Date, times: string[]): Date | null {
  const normalizedTimes = sortManualSyncTimes(times)
  if (normalizedTimes.length === 0) {
    return null
  }

  let nextDate: Date | null = null

  for (const time of normalizedTimes) {
    const [hour, minute] = time.split(':').map(Number)
    const candidate = new Date(now)
    candidate.setSeconds(0, 0)
    candidate.setHours(hour, minute, 0, 0)

    if (candidate.getTime() <= now.getTime()) {
      candidate.setDate(candidate.getDate() + 1)
    }

    if (!nextDate || candidate.getTime() < nextDate.getTime()) {
      nextDate = candidate
    }
  }

  return nextDate
}

export function pickLatestManualBackup(files: BackupFile[]): BackupFile | null {
  return files.find((file) => file.fileName !== AUTO_SYNC_FILE_NAME) ?? null
}

export function startManualSyncSchedules() {
  schedulerStarted = true
  scheduleAllManualSyncTasks()
}

export function stopManualSyncSchedules() {
  schedulerStarted = false
  clearManualSyncTimers()
}

export function refreshManualSyncSchedules() {
  if (!schedulerStarted) {
    return
  }

  scheduleAllManualSyncTasks()
}

function clearManualSyncTimers() {
  for (const timer of scheduleTimers.values()) {
    clearTimeout(timer)
  }

  scheduleTimers.clear()
}

function scheduleAllManualSyncTasks() {
  clearManualSyncTimers()

  const scheduleMap = loadManualSyncSchedules()

  for (const provider of PROVIDERS) {
    scheduleManualSyncTask(provider, 'upload', scheduleMap[provider].uploadTimes)
    scheduleManualSyncTask(provider, 'restore', scheduleMap[provider].restoreTimes)
  }
}

function scheduleManualSyncTask(provider: ManualSyncProvider, action: ManualSyncAction, times: string[]) {
  const nextRunAt = getNextManualSyncOccurrence(new Date(), times)
  if (!nextRunAt) {
    return
  }

  const timerKey = `${provider}:${action}`
  const delay = Math.max(nextRunAt.getTime() - Date.now(), 0)

  logger.debug(`[ManualSync] Scheduling ${action} for ${provider} at ${nextRunAt.toLocaleString()}`)

  const timer = setTimeout(() => {
    void enqueueManualSyncTask(async () => {
      await runManualSyncTask(provider, action)
    }).finally(() => {
      if (schedulerStarted) {
        scheduleManualSyncTask(
          provider,
          action,
          loadManualSyncSchedule(provider)[`${action}Times` as 'uploadTimes' | 'restoreTimes']
        )
      }
    })
  }, delay)

  scheduleTimers.set(timerKey, timer)
}

function enqueueManualSyncTask(task: () => Promise<void>) {
  const nextTask = taskQueue.catch(() => {}).then(task)
  taskQueue = nextTask.catch(() => {})
  return nextTask
}

async function runManualSyncTask(provider: ManualSyncProvider, action: ManualSyncAction) {
  if (!isProviderConfigured(provider)) {
    logger.warn(`[ManualSync] Skip ${action} for ${provider}: provider is not configured`)
    return
  }

  logger.info(`[ManualSync] Running scheduled ${action} for ${provider}`)

  if (action === 'upload') {
    await runScheduledUpload(provider)
    return
  }

  await runScheduledRestore(provider)
}

function isProviderConfigured(provider: ManualSyncProvider) {
  const state = store.getState()

  if (provider === 'webdav') {
    return Boolean(state.settings.webdavHost)
  }

  if (provider === 'local') {
    return Boolean(state.settings.localBackupDir)
  }

  if (provider === 'nutstore') {
    return Boolean(state.nutstore.nutstoreToken && state.nutstore.nutstorePath)
  }

  const s3 = state.settings.s3
  return Boolean(s3?.endpoint && s3?.region && s3?.bucket && s3?.accessKeyId && s3?.secretAccessKey)
}

async function runScheduledUpload(provider: ManualSyncProvider) {
  if (provider === 'webdav') {
    await backupToWebdav()
    return
  }

  if (provider === 'local') {
    await backupToLocal()
    return
  }

  if (provider === 'nutstore') {
    await backupToNutstore()
    return
  }

  await backupToS3()
}

async function runScheduledRestore(provider: ManualSyncProvider) {
  const latestBackup = await getLatestManualBackup(provider)
  if (!latestBackup) {
    logger.warn(`[ManualSync] Skip restore for ${provider}: no manual backup file found`)
    return
  }

  const { confirmBeforeRestore } = loadManualSyncSchedule(provider)
  if (confirmBeforeRestore) {
    const confirmed = await confirmScheduledRestore(provider, latestBackup)
    if (!confirmed) {
      logger.info(`[ManualSync] Scheduled restore for ${provider} was cancelled by user`)
      return
    }
  }

  if (provider === 'webdav') {
    await restoreFromWebdav(latestBackup.fileName)
    return
  }

  if (provider === 'local') {
    await restoreFromLocal(latestBackup.fileName)
    return
  }

  if (provider === 'nutstore') {
    await restoreFromNutstore(latestBackup.fileName)
    return
  }

  await restoreFromS3(latestBackup.fileName)
}

async function getLatestManualBackup(provider: ManualSyncProvider): Promise<BackupFile | null> {
  if (provider === 'webdav') {
    const { webdavHost, webdavUser, webdavPass, webdavPath } = store.getState().settings
    const files = await window.api.backup.listWebdavFiles({
      webdavHost,
      webdavUser,
      webdavPass,
      webdavPath
    } as WebDavConfig)
    return pickLatestManualBackup(files)
  }

  if (provider === 'local') {
    const localBackupDir = await window.api.resolvePath(store.getState().settings.localBackupDir)
    const files = await window.api.backup.listLocalBackupFiles(localBackupDir)
    return pickLatestManualBackup(files)
  }

  if (provider === 'nutstore') {
    const config = await getNutstoreWebDavConfig()
    if (!config) {
      return null
    }

    const files = await window.api.backup.listWebdavFiles(config)
    return pickLatestManualBackup(files)
  }

  const s3Config = store.getState().settings.s3
  const files = await window.api.backup.listS3Files(s3Config)
  return pickLatestManualBackup(files)
}

async function confirmScheduledRestore(provider: ManualSyncProvider, file: BackupFile) {
  const providerLabel = i18n.t(`settings.data.manual_schedule.providers.${provider}`)
  const modifiedTime = new Date(file.modifiedTime).toLocaleString()

  return await new Promise<boolean>((resolve) => {
    window.modal.confirm({
      title: i18n.t('settings.data.manual_schedule.restore_confirm.title'),
      content: i18n.t('settings.data.manual_schedule.restore_confirm.content', {
        provider: providerLabel,
        fileName: file.fileName,
        modifiedTime,
        size: file.size
      }),
      okText: i18n.t('settings.data.manual_schedule.restore_confirm.confirm'),
      cancelText: i18n.t('common.cancel'),
      centered: true,
      onOk: () => resolve(true),
      onCancel: () => resolve(false)
    })
  })
}

async function getNutstoreWebDavConfig(): Promise<WebDavConfig | null> {
  const nutstoreToken = store.getState().nutstore.nutstoreToken
  if (!nutstoreToken) {
    return null
  }

  const decryptedToken = await window.api.nutstore.decryptToken(nutstoreToken)
  if (!decryptedToken) {
    logger.warn('Failed to decrypt nutstore token for manual sync scheduling')
    return null
  }

  return {
    webdavHost: NUTSTORE_HOST,
    webdavUser: decryptedToken.username,
    webdavPass: decryptedToken.access_token,
    webdavPath: store.getState().nutstore.nutstorePath
  }
}

export default {
  getNextManualSyncOccurrence,
  loadManualSyncSchedule,
  normalizeManualSyncScheduleConfig,
  normalizeManualSyncTime,
  pickLatestManualBackup,
  refreshManualSyncSchedules,
  saveManualSyncSchedule,
  startManualSyncSchedules,
  stopManualSyncSchedules
}
