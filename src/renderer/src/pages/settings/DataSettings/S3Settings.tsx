import { FolderOpenOutlined, InfoCircleOutlined, SaveOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { S3BackupManager } from '@renderer/components/S3BackupManager'
import { S3BackupModal, useS3BackupModal } from '@renderer/components/S3Modals'
import Selector from '@renderer/components/Selector'
import { AppLogo } from '@renderer/config/env'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useSettings } from '@renderer/hooks/useSettings'
import { startAutoSync, stopAutoSync } from '@renderer/services/BackupService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setS3Partial } from '@renderer/store/settings'
import type { S3Config } from '@renderer/types'
import { Button, Input, Switch, Tooltip } from 'antd'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'
import {
  AutoSyncDescription,
  AutoSyncStatusValue,
  DEFAULT_AUTO_SYNC_INTERVAL,
  getAutoSyncIntervalOptions,
  getAutoSyncIntervalValue
} from './AutoSyncSettings'

const S3Settings: FC = () => {
  const { s3 = {} as S3Config } = useSettings()

  const {
    endpoint: s3EndpointInit = '',
    region: s3RegionInit = '',
    bucket: s3BucketInit = '',
    accessKeyId: s3AccessKeyIdInit = '',
    secretAccessKey: s3SecretAccessKeyInit = '',
    root: s3RootInit = '',
    autoSync: s3AutoSyncInit = false,
    syncInterval: s3SyncIntervalInit = 0,
    maxBackups: s3MaxBackupsInit = 5,
    skipBackupFile: s3SkipBackupFileInit = false
  } = s3

  const [endpoint, setEndpoint] = useState<string | undefined>(s3EndpointInit)
  const [region, setRegion] = useState<string | undefined>(s3RegionInit)
  const [bucket, setBucket] = useState<string | undefined>(s3BucketInit)
  const [accessKeyId, setAccessKeyId] = useState<string | undefined>(s3AccessKeyIdInit)
  const [secretAccessKey, setSecretAccessKey] = useState<string | undefined>(s3SecretAccessKeyInit)
  const [root, setRoot] = useState<string | undefined>(s3RootInit)
  const [skipBackupFile, setSkipBackupFile] = useState<boolean>(s3SkipBackupFileInit)
  const [backupManagerVisible, setBackupManagerVisible] = useState(false)

  const [syncInterval, setSyncInterval] = useState<number>(s3SyncIntervalInit)
  const [maxBackups, setMaxBackups] = useState<number>(s3MaxBackupsInit)

  const dispatch = useAppDispatch()
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { openSmartMinapp } = useMinappPopup()

  const { s3Sync } = useAppSelector((state) => state.backup)

  const onSyncIntervalChange = (value: number) => {
    setSyncInterval(value)
    dispatch(setS3Partial({ syncInterval: value }))
    if (s3AutoSyncInit) {
      startAutoSync(false, 's3')
    }
  }

  const onAutoSyncToggle = (checked: boolean) => {
    if (!checked) {
      dispatch(setS3Partial({ autoSync: false }))
      stopAutoSync('s3')
      return
    }

    const nextInterval = syncInterval > 0 ? syncInterval : DEFAULT_AUTO_SYNC_INTERVAL
    setSyncInterval(nextInterval)
    dispatch(setS3Partial({ autoSync: true, syncInterval: nextInterval }))
    startAutoSync(false, 's3')
  }

  const handleTitleClick = () => {
    openSmartMinapp({
      id: 's3-help',
      name: 'S3 Compatible Storage Help',
      url: 'https://docs.cherry-ai.com/data-settings/s3-compatible',
      logo: AppLogo
    })
  }

  const onMaxBackupsChange = (value: number) => {
    setMaxBackups(value)
    dispatch(setS3Partial({ maxBackups: value }))
  }

  const onSkipBackupFilesChange = (value: boolean) => {
    setSkipBackupFile(value)
    dispatch(setS3Partial({ skipBackupFile: value }))
  }

  const { isModalVisible, handleBackup, handleCancel, backuping, customFileName, setCustomFileName, showBackupModal } =
    useS3BackupModal()

  const showBackupManager = () => {
    setBackupManagerVisible(true)
  }

  const closeBackupManager = () => {
    setBackupManagerVisible(false)
  }

  const isSyncConfigured = Boolean(endpoint && region && bucket && accessKeyId && secretAccessKey)
  const isAutoSyncEnabled = Boolean(s3AutoSyncInit && syncInterval > 0)

  return (
    <SettingGroup theme={theme}>
      <SettingTitle style={{ justifyContent: 'flex-start', gap: 10 }}>
        {t('settings.data.s3.title.label')}
        <Tooltip title={t('settings.data.s3.title.tooltip')} placement="right">
          <InfoCircleOutlined style={{ color: 'var(--color-text-2)', cursor: 'pointer' }} onClick={handleTitleClick} />
        </Tooltip>
      </SettingTitle>
      <SettingHelpText>{t('settings.data.s3.title.help')}</SettingHelpText>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.endpoint.label')}</SettingRowTitle>
        <Input
          placeholder={t('settings.data.s3.endpoint.placeholder')}
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          style={{ width: 250 }}
          type="url"
          onBlur={() => dispatch(setS3Partial({ endpoint: endpoint || '' }))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.region.label')}</SettingRowTitle>
        <Input
          placeholder={t('settings.data.s3.region.placeholder')}
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          style={{ width: 250 }}
          onBlur={() => dispatch(setS3Partial({ region: region || '' }))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.bucket.label')}</SettingRowTitle>
        <Input
          placeholder={t('settings.data.s3.bucket.placeholder')}
          value={bucket}
          onChange={(e) => setBucket(e.target.value)}
          style={{ width: 250 }}
          onBlur={() => dispatch(setS3Partial({ bucket: bucket || '' }))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.accessKeyId.label')}</SettingRowTitle>
        <Input
          placeholder={t('settings.data.s3.accessKeyId.placeholder')}
          value={accessKeyId}
          onChange={(e) => setAccessKeyId(e.target.value)}
          style={{ width: 250 }}
          onBlur={() => dispatch(setS3Partial({ accessKeyId: accessKeyId || '' }))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.secretAccessKey.label')}</SettingRowTitle>
        <Input.Password
          placeholder={t('settings.data.s3.secretAccessKey.placeholder')}
          value={secretAccessKey}
          onChange={(e) => setSecretAccessKey(e.target.value)}
          style={{ width: 250 }}
          onBlur={() => dispatch(setS3Partial({ secretAccessKey: secretAccessKey || '' }))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.root.label')}</SettingRowTitle>
        <Input
          placeholder={t('settings.data.s3.root.placeholder')}
          value={root}
          onChange={(e) => setRoot(e.target.value)}
          style={{ width: 250 }}
          onBlur={() => dispatch(setS3Partial({ root: root || '' }))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.auto_sync.manual.label')}</SettingRowTitle>
        <HStack gap="5px" justifyContent="space-between">
          <Button
            onClick={showBackupModal}
            icon={<SaveOutlined />}
            loading={backuping}
            disabled={!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey}>
            {t('settings.data.s3.backup.button')}
          </Button>
          <Button
            onClick={showBackupManager}
            icon={<FolderOpenOutlined />}
            disabled={!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey}>
            {t('settings.data.s3.backup.manager.button')}
          </Button>
        </HStack>
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.auto_sync.manual.help')}</SettingHelpText>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.auto_sync.label')}</SettingRowTitle>
        <Switch checked={isAutoSyncEnabled} onChange={onAutoSyncToggle} disabled={!isSyncConfigured} />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.auto_sync.interval.label')}</SettingRowTitle>
        <Selector
          size={14}
          value={getAutoSyncIntervalValue(syncInterval)}
          onChange={onSyncIntervalChange}
          placeholder={t('settings.data.auto_sync.interval.placeholder')}
          disabled={!isSyncConfigured}
          options={getAutoSyncIntervalOptions(t)}
        />
      </SettingRow>
      <SettingRow>
        <AutoSyncDescription isConfigured={isSyncConfigured} />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.maxBackups.label')}</SettingRowTitle>
        <Selector
          size={14}
          value={maxBackups}
          onChange={onMaxBackupsChange}
          disabled={!endpoint || !accessKeyId || !secretAccessKey}
          options={[
            { label: t('settings.data.s3.maxBackups.unlimited'), value: 0 },
            { label: '1', value: 1 },
            { label: '3', value: 3 },
            { label: '5', value: 5 },
            { label: '10', value: 10 },
            { label: '20', value: 20 },
            { label: '50', value: 50 }
          ]}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.skipBackupFile.label')}</SettingRowTitle>
        <Switch checked={skipBackupFile} onChange={onSkipBackupFilesChange} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.s3.skipBackupFile.help')}</SettingHelpText>
      </SettingRow>
      {isAutoSyncEnabled && (
        <>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.data.auto_sync.status.label')}</SettingRowTitle>
            <AutoSyncStatusValue isConfigured={isSyncConfigured} syncState={s3Sync} />
          </SettingRow>
        </>
      )}
      <>
        <S3BackupModal
          isModalVisible={isModalVisible}
          handleBackup={handleBackup}
          handleCancel={handleCancel}
          backuping={backuping}
          customFileName={customFileName}
          setCustomFileName={setCustomFileName}
        />

        <S3BackupManager
          visible={backupManagerVisible}
          onClose={closeBackupManager}
          s3Config={{
            endpoint,
            region,
            bucket,
            accessKeyId,
            secretAccessKey,
            root
          }}
        />
      </>
    </SettingGroup>
  )
}

export default S3Settings
