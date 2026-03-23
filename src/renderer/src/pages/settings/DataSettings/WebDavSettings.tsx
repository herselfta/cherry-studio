import { FolderOpenOutlined, SaveOutlined } from '@ant-design/icons'
import BackupTypeModal, { type BackupArtifactType } from '@renderer/components/BackupTypeModal'
import { HStack } from '@renderer/components/Layout'
import Selector from '@renderer/components/Selector'
import { WebdavBackupManager } from '@renderer/components/WebdavBackupManager'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { backupToWebdavWithConfig, restoreFromWebdavWithConfig, startAutoBackup, stopAutoBackup } from '@renderer/services/BackupService'
import { buildBackupArtifactFileName } from '@renderer/services/BackupArtifactService'
import {
  importMobileSyncFromWebdav,
  isMobileSyncRemoteFile,
  uploadMobileSyncToWebdav
} from '@renderer/services/MobileSyncService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  setWebdavAutoSync,
  setWebdavDisableStream as _setWebdavDisableStream,
  setWebdavHost as _setWebdavHost,
  setWebdavMaxBackups as _setWebdavMaxBackups,
  setWebdavPass as _setWebdavPass,
  setWebdavPath as _setWebdavPath,
  setWebdavSkipBackupFile as _setWebdavSkipBackupFile,
  setWebdavSyncInterval as _setWebdavSyncInterval,
  setWebdavUser as _setWebdavUser
} from '@renderer/store/settings'
import type { WebDavConfig } from '@renderer/types'
import { Button, Input, Switch } from 'antd'
import type { FC } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'
import {
  AutoSyncDescription,
  AutoSyncStatusValue,
  DEFAULT_AUTO_SYNC_INTERVAL,
  getAutoSyncIntervalOptions,
  getAutoSyncIntervalValue
} from './AutoSyncSettings'
import ManualSyncScheduleSettings from './ManualSyncScheduleSettings'

const WebDavSettings: FC = () => {
  const {
    webdavHost: webDAVHost,
    webdavUser: webDAVUser,
    webdavPass: webDAVPass,
    webdavPath: webDAVPath,
    webdavAutoSync,
    webdavSyncInterval: webDAVSyncInterval,
    webdavMaxBackups: webDAVMaxBackups,
    webdavSkipBackupFile: webdDAVSkipBackupFile,
    webdavDisableStream: webDAVDisableStream
  } = useSettings()

  const [webdavHost, setWebdavHost] = useState<string | undefined>(webDAVHost)
  const [webdavUser, setWebdavUser] = useState<string | undefined>(webDAVUser)
  const [webdavPass, setWebdavPass] = useState<string | undefined>(webDAVPass)
  const [webdavPath, setWebdavPath] = useState<string | undefined>(webDAVPath)
  const [webdavSkipBackupFile, setWebdavSkipBackupFile] = useState<boolean>(webdDAVSkipBackupFile)
  const [webdavDisableStream, setWebdavDisableStream] = useState<boolean>(webDAVDisableStream)
  const [managerType, setManagerType] = useState<BackupArtifactType | null>(null)
  const [backupModalVisible, setBackupModalVisible] = useState(false)
  const [backupType, setBackupType] = useState<BackupArtifactType>('pc')
  const [backupFileName, setBackupFileName] = useState('')
  const [backuping, setBackuping] = useState(false)

  const [syncInterval, setSyncInterval] = useState<number>(webDAVSyncInterval)
  const [maxBackups, setMaxBackups] = useState<number>(webDAVMaxBackups)

  const dispatch = useAppDispatch()
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { webdavSync } = useAppSelector((state) => state.backup)

  const onSyncIntervalChange = (value: number) => {
    setSyncInterval(value)
    dispatch(_setWebdavSyncInterval(value))
    if (webdavAutoSync) {
      startAutoBackup(false, 'webdav')
    }
  }

  const onAutoSyncToggle = (checked: boolean) => {
    if (!checked) {
      dispatch(setWebdavAutoSync(false))
      stopAutoBackup('webdav')
      return
    }

    const nextInterval = syncInterval > 0 ? syncInterval : DEFAULT_AUTO_SYNC_INTERVAL
    setSyncInterval(nextInterval)
    dispatch(_setWebdavSyncInterval(nextInterval))
    dispatch(setWebdavAutoSync(true))
    startAutoBackup(false, 'webdav')
  }

  const onMaxBackupsChange = (value: number) => {
    setMaxBackups(value)
    dispatch(_setWebdavMaxBackups(value))
  }

  const onSkipBackupFilesChange = (value: boolean) => {
    setWebdavSkipBackupFile(value)
    dispatch(_setWebdavSkipBackupFile(value))
  }

  const onDisableStreamChange = (value: boolean) => {
    setWebdavDisableStream(value)
    dispatch(_setWebdavDisableStream(value))
  }

  const commitCurrentSettings = useCallback(() => {
    dispatch(_setWebdavHost(webdavHost || ''))
    dispatch(_setWebdavUser(webdavUser || ''))
    dispatch(_setWebdavPass(webdavPass || ''))
    dispatch(_setWebdavPath(webdavPath || ''))
  }, [dispatch, webdavHost, webdavPass, webdavPath, webdavUser])

  const getCommittedWebdavConfig = (): WebDavConfig | null => {
    if (!webdavHost) {
      window.toast.error(t('message.error.invalid.webdav'))
      return null
    }

    return {
      webdavHost,
      webdavUser,
      webdavPass,
      webdavPath,
      skipBackupFile: webdavSkipBackupFile,
      disableStream: webdavDisableStream
    }
  }

  const isSyncConfigured = Boolean(webdavHost)
  const isAutoSyncEnabled = Boolean(webdavAutoSync && syncInterval > 0)

  const openBackupModal = async () => {
    commitCurrentSettings()
    setBackupType('pc')
    setBackupFileName(await buildBackupArtifactFileName('pc'))
    setBackupModalVisible(true)
  }

  const handleBackupTypeChange = async (value: BackupArtifactType) => {
    setBackupType(value)
    setBackupFileName(await buildBackupArtifactFileName(value))
  }

  const handleBackup = async () => {
    commitCurrentSettings()
    const committedWebdavConfig = getCommittedWebdavConfig()
    if (!committedWebdavConfig) {
      return
    }

    setBackuping(true)
    try {
      if (backupType === 'app') {
        const fileName = await uploadMobileSyncToWebdav(committedWebdavConfig, backupFileName)
        window.toast.success(t('settings.data.webdav.mobile_sync.upload.success', { fileName }))
      } else {
        await backupToWebdavWithConfig(committedWebdavConfig, {
          showMessage: true,
          customFileName: backupFileName
        })
      }
      setBackupModalVisible(false)
    } catch (error) {
      window.toast.error((error as Error).message)
    } finally {
      setBackuping(false)
    }
  }

  const openRestoreManager = () => {
    commitCurrentSettings()
    setManagerType('pc')
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.webdav.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.webdav.host.label')}</SettingRowTitle>
        <Input
          placeholder={t('settings.data.webdav.host.placeholder')}
          value={webdavHost}
          onChange={(e) => setWebdavHost(e.target.value)}
          style={{ width: 250 }}
          type="url"
          onBlur={() => dispatch(_setWebdavHost(webdavHost || ''))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.webdav.user')}</SettingRowTitle>
        <Input
          placeholder={t('settings.data.webdav.user')}
          value={webdavUser}
          onChange={(e) => setWebdavUser(e.target.value)}
          style={{ width: 250 }}
          onBlur={() => dispatch(_setWebdavUser(webdavUser || ''))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.webdav.password')}</SettingRowTitle>
        <Input.Password
          placeholder={t('settings.data.webdav.password')}
          value={webdavPass}
          onChange={(e) => setWebdavPass(e.target.value)}
          style={{ width: 250 }}
          onBlur={() => dispatch(_setWebdavPass(webdavPass || ''))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.webdav.path.label')}</SettingRowTitle>
        <Input
          placeholder={t('settings.data.webdav.path.placeholder')}
          value={webdavPath}
          onChange={(e) => setWebdavPath(e.target.value)}
          style={{ width: 250 }}
          onBlur={() => dispatch(_setWebdavPath(webdavPath || ''))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.artifact_type.cross_device_title')}</SettingRowTitle>
        <HStack gap="5px" justifyContent="space-between">
          {/* WebDAV exposes the same PC / APP choice as local backup, but APP still
              uploads a shared-data JSON instead of a migration ZIP so cloud sync stays portable. */}
          <Button onClick={() => void openBackupModal()} icon={<SaveOutlined />} loading={backuping}>
            {t('settings.data.webdav.backup.button')}
          </Button>
          <Button onClick={openRestoreManager} icon={<FolderOpenOutlined />} disabled={!webdavHost}>
            {t('settings.data.webdav.restore.button')}
          </Button>
        </HStack>
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.artifact_type.cross_device_help')}</SettingHelpText>
      </SettingRow>
      <SettingDivider />
      <ManualSyncScheduleSettings provider="webdav" isConfigured={isSyncConfigured} />
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
        <SettingRowTitle>{t('settings.data.webdav.maxBackups')}</SettingRowTitle>
        <Selector
          size={14}
          value={maxBackups}
          onChange={onMaxBackupsChange}
          disabled={!webdavHost}
          options={[
            { label: t('settings.data.local.maxBackups.unlimited'), value: 0 },
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
        <SettingRowTitle>{t('settings.data.backup.skip_file_data_title')}</SettingRowTitle>
        <Switch checked={webdavSkipBackupFile} onChange={onSkipBackupFilesChange} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.backup.skip_file_data_help')}</SettingHelpText>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.webdav.disableStream.title')}</SettingRowTitle>
        <Switch checked={webdavDisableStream} onChange={onDisableStreamChange} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.webdav.disableStream.help')}</SettingHelpText>
      </SettingRow>
      {isAutoSyncEnabled && (
        <>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.data.auto_sync.status.label')}</SettingRowTitle>
            <AutoSyncStatusValue isConfigured={isSyncConfigured} syncState={webdavSync} />
          </SettingRow>
        </>
      )}
      <>
        <WebdavBackupManager
          visible={managerType !== null}
          onClose={() => setManagerType(null)}
          webdavConfig={{
            webdavHost,
            webdavUser,
            webdavPass,
            webdavPath,
            webdavDisableStream
          }}
          fileFilter={managerType === 'app' ? (file) => isMobileSyncRemoteFile(file.fileName) : undefined}
          restoreMethod={(fileName) =>
            (() => {
              const committedWebdavConfig = getCommittedWebdavConfig()
              if (!committedWebdavConfig) {
                throw new Error(t('message.error.invalid.webdav'))
              }

              return managerType === 'app'
                ? importMobileSyncFromWebdav(committedWebdavConfig, fileName)
                : restoreFromWebdavWithConfig(committedWebdavConfig, fileName)
            })()
          }
          artifactType={managerType || 'pc'}
          onArtifactTypeChange={(value) => setManagerType(value)}
          customLabels={{
            managerTitle: t('settings.data.artifact_type.cross_device_title'),
            managerEmptyText: managerType === 'app' ? t('settings.data.webdav.mobile_sync.manager.empty') : undefined,
            restoreConfirmTitle:
              managerType === 'app' ? t('settings.data.webdav.mobile_sync.restore.confirm.title') : undefined,
            restoreConfirmContent:
              managerType === 'app' ? t('settings.data.webdav.mobile_sync.restore.confirm.content') : undefined,
            restoreSuccessMessage:
              managerType === 'app' ? t('settings.data.webdav.mobile_sync.restore.success') : undefined
          }}
        />

        <BackupTypeModal
          open={backupModalVisible}
          mode="backup"
          artifactType={backupType}
          onArtifactTypeChange={(value) => void handleBackupTypeChange(value)}
          onConfirm={() => void handleBackup()}
          onCancel={() => setBackupModalVisible(false)}
          loading={backuping}
          fileName={backupFileName}
          onFileNameChange={setBackupFileName}
        />
      </>
    </SettingGroup>
  )
}

export default WebDavSettings
