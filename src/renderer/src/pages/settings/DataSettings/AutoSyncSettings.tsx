import { CheckCircleFilled, SyncOutlined, WarningOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import type { RemoteSyncState } from '@renderer/store/backup'
import { Tooltip } from 'antd'
import dayjs from 'dayjs'
import type { TFunction } from 'i18next'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpText } from '..'

export const DEFAULT_AUTO_SYNC_INTERVAL = 15

const AUTO_SYNC_INTERVAL_VALUES = [1, 5, 15, 30, 60, 120, 360, 720, 1440] as const

export function getAutoSyncIntervalOptions(t: TFunction<'translation'>) {
  return AUTO_SYNC_INTERVAL_VALUES.map((value) => ({
    label:
      value < 60
        ? t('settings.data.auto_sync.interval.minute', { count: value })
        : t('settings.data.auto_sync.interval.hour', { count: value / 60 }),
    value
  }))
}

export function getAutoSyncIntervalValue(syncInterval: number): number | undefined {
  return syncInterval > 0 ? syncInterval : undefined
}

export const AutoSyncDescription: FC<{ isConfigured: boolean }> = ({ isConfigured }) => {
  const { t } = useTranslation()

  return (
    <SettingHelpText>
      {t(isConfigured ? 'settings.data.auto_sync.help' : 'settings.data.auto_sync.requiresSetup')}
    </SettingHelpText>
  )
}

export const AutoSyncStatusValue: FC<{
  isConfigured: boolean
  syncState: RemoteSyncState
}> = ({ isConfigured, syncState }) => {
  const { t } = useTranslation()

  if (!isConfigured) {
    return (
      <span style={{ color: 'var(--color-text-secondary)' }}>{t('settings.data.auto_sync.status.unavailable')}</span>
    )
  }

  if (syncState.syncing) {
    return (
      <HStack gap="5px" alignItems="center">
        <SyncOutlined spin />
        <span style={{ color: 'var(--color-text-secondary)' }}>{t('settings.data.auto_sync.status.syncing')}</span>
      </HStack>
    )
  }

  if (syncState.lastSyncError) {
    return (
      <HStack gap="5px" alignItems="center">
        <Tooltip title={syncState.lastSyncError}>
          <WarningOutlined style={{ color: 'var(--color-error)' }} />
        </Tooltip>
        <span style={{ color: 'var(--color-text-secondary)' }}>{t('settings.data.auto_sync.status.error')}</span>
      </HStack>
    )
  }

  if (syncState.lastSyncTime) {
    return (
      <HStack gap="5px" alignItems="center">
        <CheckCircleFilled style={{ color: 'var(--color-primary, #52c41a)' }} />
        <span style={{ color: 'var(--color-text-secondary)' }}>
          {t('settings.data.auto_sync.status.lastSync', {
            time: dayjs(syncState.lastSyncTime).format('HH:mm:ss')
          })}
        </span>
      </HStack>
    )
  }

  return <span style={{ color: 'var(--color-text-secondary)' }}>{t('settings.data.auto_sync.status.pending')}</span>
}
