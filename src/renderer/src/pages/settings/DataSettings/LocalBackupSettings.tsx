import { DeleteOutlined, FolderOpenOutlined, SaveOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import BackupTypeModal, { type BackupArtifactType } from '@renderer/components/BackupTypeModal'
import { HStack } from '@renderer/components/Layout'
import { LocalBackupManager } from '@renderer/components/LocalBackupManager'
import { LocalBackupModal, useLocalBackupModal } from '@renderer/components/LocalBackupModals'
import Selector from '@renderer/components/Selector'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { buildBackupArtifactFileName } from '@renderer/services/BackupArtifactService'
import {
  backupMigrationToLocal,
  isMigrationBackupFile,
  restoreMigrationFromLocal,
  startAutoBackup,
  stopAutoBackup
} from '@renderer/services/BackupService'
import {
  backupMobileSyncToLocal,
  isMobileSyncRemoteFile,
  restoreMobileSyncFromLocal
} from '@renderer/services/MobileSyncService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  setLocalBackupAutoSync,
  setLocalBackupDir as _setLocalBackupDir,
  setLocalBackupMaxBackups as _setLocalBackupMaxBackups,
  setLocalBackupSkipBackupFile as _setLocalBackupSkipBackupFile,
  setLocalBackupSyncInterval as _setLocalBackupSyncInterval
} from '@renderer/store/settings'
import type { AppInfo } from '@renderer/types'
import { Button, Input, Switch } from 'antd'
import { useEffect, useState } from 'react'
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

const logger = loggerService.withContext('LocalBackupSettings')

const LocalBackupSettings: React.FC = () => {
  const dispatch = useAppDispatch()

  const {
    localBackupDir: localBackupDirSetting,
    localBackupAutoSync: localBackupAutoSyncSetting,
    localBackupSyncInterval: localBackupSyncIntervalSetting,
    localBackupMaxBackups: localBackupMaxBackupsSetting,
    localBackupSkipBackupFile: localBackupSkipBackupFileSetting
  } = useSettings()

  const [localBackupDir, setLocalBackupDir] = useState<string | undefined>(localBackupDirSetting)
  const [resolvedLocalBackupDir, setResolvedLocalBackupDir] = useState<string | undefined>(undefined)
  const [localBackupSkipBackupFile, setLocalBackupSkipBackupFile] = useState<boolean>(localBackupSkipBackupFileSetting)
  const [backupManagerVisible, setBackupManagerVisible] = useState(false)
  const [crossDeviceBackupModalVisible, setCrossDeviceBackupModalVisible] = useState(false)
  const [crossDeviceBackuping, setCrossDeviceBackuping] = useState(false)
  const [crossDeviceBackupType, setCrossDeviceBackupType] = useState<BackupArtifactType>('pc')
  const [crossDeviceManagerType, setCrossDeviceManagerType] = useState<BackupArtifactType | null>(null)
  const [crossDeviceFileName, setCrossDeviceFileName] = useState('')

  const [syncInterval, setSyncInterval] = useState<number>(localBackupSyncIntervalSetting)
  const [maxBackups, setMaxBackups] = useState<number>(localBackupMaxBackupsSetting)

  const [appInfo, setAppInfo] = useState<AppInfo>()

  useEffect(() => {
    window.api.getAppInfo().then(setAppInfo)
  }, [])

  useEffect(() => {
    if (localBackupDirSetting) {
      window.api.resolvePath(localBackupDirSetting).then(setResolvedLocalBackupDir)
    }
  }, [localBackupDirSetting])

  const { theme } = useTheme()
  const { t } = useTranslation()
  const { localBackupSync } = useAppSelector((state) => state.backup)

  const onSyncIntervalChange = (value: number) => {
    setSyncInterval(value)
    dispatch(_setLocalBackupSyncInterval(value))
    if (localBackupAutoSyncSetting) {
      startAutoBackup(false, 'local')
    }
  }

  const onAutoSyncToggle = (checked: boolean) => {
    if (!checked) {
      dispatch(setLocalBackupAutoSync(false))
      stopAutoBackup('local')
      return
    }

    const nextInterval = syncInterval > 0 ? syncInterval : DEFAULT_AUTO_SYNC_INTERVAL
    setSyncInterval(nextInterval)
    dispatch(_setLocalBackupSyncInterval(nextInterval))
    dispatch(setLocalBackupAutoSync(true))
    startAutoBackup(false, 'local')
  }

  const checkLocalBackupDirValid = async (dir: string) => {
    if (dir === '') {
      return false
    }

    const resolvedDir = await window.api.resolvePath(dir)

    if (await window.api.isPathInside(resolvedDir, appInfo!.appDataPath)) {
      window.toast.error(t('settings.data.local.directory.select_error_app_data_path'))
      return false
    }

    if (await window.api.isPathInside(resolvedDir, appInfo!.installPath)) {
      window.toast.error(t('settings.data.local.directory.select_error_in_app_install_path'))
      return false
    }

    const hasWritePermission = await window.api.hasWritePermission(resolvedDir)
    if (!hasWritePermission) {
      window.toast.error(t('settings.data.local.directory.select_error_write_permission'))
      return false
    }

    return true
  }

  const handleLocalBackupDirChange = async (value: string) => {
    if (value === localBackupDirSetting) {
      return
    }

    if (value === '') {
      handleClearDirectory()
      return
    }

    if (await checkLocalBackupDirValid(value)) {
      setLocalBackupDir(value)
      dispatch(_setLocalBackupDir(value))
      setResolvedLocalBackupDir(await window.api.resolvePath(value))

      if (localBackupAutoSyncSetting) {
        startAutoBackup(true, 'local')
      }
      return
    }

    if (localBackupDirSetting) {
      setLocalBackupDir(localBackupDirSetting)
    }
  }

  const onMaxBackupsChange = (value: number) => {
    setMaxBackups(value)
    dispatch(_setLocalBackupMaxBackups(value))
  }

  const onSkipBackupFilesChange = (value: boolean) => {
    setLocalBackupSkipBackupFile(value)
    dispatch(_setLocalBackupSkipBackupFile(value))
  }

  const handleBrowseDirectory = async () => {
    try {
      const newLocalBackupDir = await window.api.select({
        properties: ['openDirectory', 'createDirectory'],
        title: t('settings.data.local.directory.select_title')
      })

      if (!newLocalBackupDir) {
        return
      }

      await handleLocalBackupDirChange(newLocalBackupDir)
    } catch (error) {
      logger.error('Failed to select directory:', error as Error)
    }
  }

  const handleClearDirectory = () => {
    setLocalBackupDir('')
    dispatch(_setLocalBackupDir(''))
    dispatch(setLocalBackupAutoSync(false))
    stopAutoBackup('local')
  }

  const { isModalVisible, handleBackup, handleCancel, backuping, customFileName, setCustomFileName, showBackupModal } =
    useLocalBackupModal(resolvedLocalBackupDir)

  const showBackupManager = () => {
    setBackupManagerVisible(true)
  }

  const closeBackupManager = () => {
    setBackupManagerVisible(false)
  }

  const closeCrossDeviceManager = () => {
    setCrossDeviceManagerType(null)
  }

  const isSyncConfigured = Boolean(localBackupDir)
  const isAutoSyncEnabled = Boolean(localBackupAutoSyncSetting && syncInterval > 0)

  const openCrossDeviceBackupModal = async () => {
    setCrossDeviceBackupType('pc')
    setCrossDeviceFileName(await buildBackupArtifactFileName('pc'))
    setCrossDeviceBackupModalVisible(true)
  }

  const handleCrossDeviceBackupTypeChange = async (value: BackupArtifactType) => {
    setCrossDeviceBackupType(value)
    setCrossDeviceFileName(await buildBackupArtifactFileName(value))
  }

  const handleCrossDeviceBackup = async () => {
    setCrossDeviceBackuping(true)
    try {
      if (crossDeviceBackupType === 'app') {
        await backupMobileSyncToLocal({
          showMessage: true,
          customFileName: crossDeviceFileName
        })
      } else {
        await backupMigrationToLocal({
          showMessage: true,
          customFileName: crossDeviceFileName
        })
      }

      setCrossDeviceBackupModalVisible(false)
    } catch (error) {
      logger.error('Failed to run cross-device local backup:', error as Error)
      window.toast.error((error as Error).message)
    } finally {
      setCrossDeviceBackuping(false)
    }
  }

  const openCrossDeviceRestoreManager = () => {
    setCrossDeviceManagerType('pc')
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.local.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.local.directory.label')}</SettingRowTitle>
        <HStack gap="5px">
          <Input
            value={localBackupDir}
            onChange={(e) => setLocalBackupDir(e.target.value)}
            onBlur={(e) => void handleLocalBackupDirChange(e.target.value)}
            placeholder={t('settings.data.local.directory.placeholder')}
            style={{ minWidth: 200, maxWidth: 400, flex: 1 }}
          />
          <Button icon={<FolderOpenOutlined />} onClick={handleBrowseDirectory}>
            {t('common.browse')}
          </Button>
          <Button icon={<DeleteOutlined />} onClick={handleClearDirectory} disabled={!localBackupDir} danger>
            {t('common.clear')}
          </Button>
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.auto_sync.manual.label')}</SettingRowTitle>
        <HStack gap="5px" justifyContent="space-between">
          <Button onClick={showBackupModal} icon={<SaveOutlined />} loading={backuping} disabled={!localBackupDir}>
            {t('settings.data.local.backup.button')}
          </Button>
          <Button onClick={showBackupManager} icon={<FolderOpenOutlined />} disabled={!localBackupDir}>
            {t('settings.data.local.restore.button')}
          </Button>
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.artifact_type.cross_device_title')}</SettingRowTitle>
        <HStack gap="5px" justifyContent="space-between">
          {/* Cross-device backup keeps one UX entry on desktop, but the modal still
              splits into a full PC migration package and an APP shared-data sync package. */}
          <Button onClick={() => void openCrossDeviceBackupModal()} icon={<SaveOutlined />} disabled={!localBackupDir}>
            {t('settings.data.local.backup.button')}
          </Button>
          <Button onClick={openCrossDeviceRestoreManager} icon={<FolderOpenOutlined />} disabled={!localBackupDir}>
            {t('settings.data.local.restore.button')}
          </Button>
        </HStack>
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.artifact_type.cross_device_help')}</SettingHelpText>
      </SettingRow>
      <SettingDivider />
      <ManualSyncScheduleSettings provider="local" isConfigured={isSyncConfigured} />
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
        <SettingRowTitle>{t('settings.data.local.maxBackups.label')}</SettingRowTitle>
        <Selector
          size={14}
          value={maxBackups}
          onChange={onMaxBackupsChange}
          disabled={!localBackupDir}
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
        <Switch checked={localBackupSkipBackupFile} onChange={onSkipBackupFilesChange} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.backup.skip_file_data_help')}</SettingHelpText>
      </SettingRow>
      {isAutoSyncEnabled && (
        <>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.data.auto_sync.status.label')}</SettingRowTitle>
            <AutoSyncStatusValue isConfigured={isSyncConfigured} syncState={localBackupSync} />
          </SettingRow>
        </>
      )}
      <>
        <LocalBackupModal
          isModalVisible={isModalVisible}
          handleBackup={handleBackup}
          handleCancel={handleCancel}
          backuping={backuping}
          customFileName={customFileName}
          setCustomFileName={setCustomFileName}
        />

        <LocalBackupManager
          visible={backupManagerVisible}
          onClose={closeBackupManager}
          localBackupDir={resolvedLocalBackupDir}
          fileFilter={(fileName) => !isMigrationBackupFile(fileName) && !isMobileSyncRemoteFile(fileName)}
        />
        <LocalBackupManager
          visible={crossDeviceManagerType !== null}
          onClose={closeCrossDeviceManager}
          localBackupDir={resolvedLocalBackupDir}
          restoreMethod={crossDeviceManagerType === 'app' ? restoreMobileSyncFromLocal : restoreMigrationFromLocal}
          fileFilter={(fileName) =>
            crossDeviceManagerType === 'app' ? isMobileSyncRemoteFile(fileName) : isMigrationBackupFile(fileName)
          }
          artifactType={crossDeviceManagerType || 'pc'}
          onArtifactTypeChange={(value) => setCrossDeviceManagerType(value)}
          customLabels={{
            title: t('settings.data.artifact_type.cross_device_title')
          }}
        />

        <BackupTypeModal
          open={crossDeviceBackupModalVisible}
          mode="backup"
          artifactType={crossDeviceBackupType}
          onArtifactTypeChange={(value) => void handleCrossDeviceBackupTypeChange(value)}
          onConfirm={() => void handleCrossDeviceBackup()}
          onCancel={() => setCrossDeviceBackupModalVisible(false)}
          loading={crossDeviceBackuping}
          fileName={crossDeviceFileName}
          onFileNameChange={setCrossDeviceFileName}
        />
      </>
    </SettingGroup>
  )
}

export default LocalBackupSettings
