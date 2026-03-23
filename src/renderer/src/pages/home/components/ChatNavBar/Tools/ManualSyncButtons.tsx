import SidebarActionIcon from '@renderer/components/app/SidebarActionIcon'
import BackupTypeModal, { type BackupArtifactType } from '@renderer/components/BackupTypeModal'
import { HStack } from '@renderer/components/Layout'
import { LocalBackupManager } from '@renderer/components/LocalBackupManager'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { S3BackupManager } from '@renderer/components/S3BackupManager'
import { S3BackupModal, useS3BackupModal } from '@renderer/components/S3Modals'
import { WebdavBackupManager } from '@renderer/components/WebdavBackupManager'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import {
  backupMigrationToLocal,
  backupToWebdavWithConfig,
  isMigrationBackupFile,
  restoreFromWebdavWithConfig,
  restoreMigrationFromLocal
} from '@renderer/services/BackupService'
import { buildBackupArtifactFileName } from '@renderer/services/BackupArtifactService'
import {
  backupToNutstore,
  importMobileSyncFromNutstore,
  restoreFromNutstore,
  uploadMobileSyncToNutstore
} from '@renderer/services/NutstoreService'
import {
  backupMobileSyncToLocal,
  importMobileSyncFromWebdav,
  isMobileSyncRemoteFile,
  restoreMobileSyncFromLocal,
  uploadMobileSyncToWebdav
} from '@renderer/services/MobileSyncService'
import { useAppSelector } from '@renderer/store'
import { NUTSTORE_HOST } from '@shared/config/nutstore'
import { Dropdown, Tooltip } from 'antd'
import type { ItemType } from 'antd/es/menu/interface'
import { Download, Upload } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { styled } from 'styled-components'

interface ManualSyncButtonsProps {
  orientation?: 'horizontal' | 'vertical'
  className?: string
}

type QuickProvider = 'webdav' | 'local' | 'nutstore'
type BackupManagerType = 'webdav' | 'local' | 's3' | 'nutstore' | null

const ManualSyncButtons: FC<ManualSyncButtonsProps> = ({ orientation = 'horizontal', className }) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const settings = useSettings()
  const { nutstoreToken, nutstorePath } = useAppSelector((state) => state.nutstore)
  const isVertical = orientation === 'vertical'

  const [resolvedLocalBackupDir, setResolvedLocalBackupDir] = useState<string | undefined>(undefined)
  const [backupManagerType, setBackupManagerType] = useState<BackupManagerType>(null)
  const [nutstoreAuth, setNutstoreAuth] = useState<{ username: string; accessToken: string } | null>(null)
  const [quickModalVisible, setQuickModalVisible] = useState(false)
  const [quickProvider, setQuickProvider] = useState<QuickProvider>('webdav')
  const [quickArtifactType, setQuickArtifactType] = useState<BackupArtifactType>('pc')
  const [quickFileName, setQuickFileName] = useState('')
  const [quickLoading, setQuickLoading] = useState(false)
  const [webdavRestoreArtifactType, setWebdavRestoreArtifactType] = useState<BackupArtifactType>('pc')
  const [localRestoreArtifactType, setLocalRestoreArtifactType] = useState<BackupArtifactType>('pc')
  const [nutstoreRestoreArtifactType, setNutstoreRestoreArtifactType] = useState<BackupArtifactType>('pc')
  const {
    isModalVisible: isS3BackupModalVisible,
    handleBackup: handleS3Backup,
    handleCancel: handleCancelS3Backup,
    backuping: s3Backuping,
    customFileName: s3FileName,
    setCustomFileName: setS3FileName,
    showBackupModal: showS3BackupModal
  } = useS3BackupModal()

  useEffect(() => {
    if (!settings.localBackupDir) {
      setResolvedLocalBackupDir(undefined)
      return
    }

    void window.api.resolvePath(settings.localBackupDir).then(setResolvedLocalBackupDir)
  }, [settings.localBackupDir])

  useEffect(() => {
    if (!nutstoreToken) {
      setNutstoreAuth(null)
      return
    }

    void window.api.nutstore.decryptToken(nutstoreToken).then((result) => {
      if (!result) {
        setNutstoreAuth(null)
        return
      }

      setNutstoreAuth({
        username: result.username,
        accessToken: result.access_token
      })
    })
  }, [nutstoreToken])

  const isWebdavConfigured = Boolean(settings.webdavHost)
  const isLocalConfigured = Boolean(resolvedLocalBackupDir)
  const isS3Configured = Boolean(
    settings.s3?.endpoint &&
      settings.s3?.region &&
      settings.s3?.bucket &&
      settings.s3?.accessKeyId &&
      settings.s3?.secretAccessKey
  )
  const isNutstoreConfigured = Boolean(nutstoreToken && nutstorePath && nutstoreAuth)

  const currentWebdavConfig = {
    webdavHost: settings.webdavHost,
    webdavUser: settings.webdavUser,
    webdavPass: settings.webdavPass,
    webdavPath: settings.webdavPath,
    skipBackupFile: settings.webdavSkipBackupFile,
    disableStream: settings.webdavDisableStream
  }

  const openQuickModal = useCallback(async (provider: QuickProvider) => {
    setQuickProvider(provider)
    setQuickArtifactType('pc')
    setQuickFileName(await buildBackupArtifactFileName('pc'))
    setQuickModalVisible(true)
  }, [])

  const handleQuickArtifactTypeChange = async (value: BackupArtifactType) => {
    setQuickArtifactType(value)
    setQuickFileName(await buildBackupArtifactFileName(value))
  }

  const handleQuickConfirm = async () => {
    setQuickLoading(true)
    try {
      if (quickProvider === 'local') {
        if (quickArtifactType === 'app') {
          await backupMobileSyncToLocal({
            showMessage: true,
            customFileName: quickFileName
          })
        } else {
          await backupMigrationToLocal({
            showMessage: true,
            customFileName: quickFileName
          })
        }
      } else if (quickProvider === 'nutstore') {
        if (quickArtifactType === 'app') {
          const fileName = await uploadMobileSyncToNutstore({ customFileName: quickFileName })
          window.toast.success(t('settings.data.nutstore.mobile_sync.upload.success', { fileName }))
        } else {
          await backupToNutstore({
            showMessage: true,
            customFileName: quickFileName
          })
        }
      } else if (quickArtifactType === 'app') {
        const fileName = await uploadMobileSyncToWebdav(currentWebdavConfig, quickFileName)
        window.toast.success(t('settings.data.webdav.mobile_sync.upload.success', { fileName }))
      } else {
        await backupToWebdavWithConfig(currentWebdavConfig, {
          showMessage: true,
          customFileName: quickFileName
        })
      }

      setQuickModalVisible(false)
    } catch (error) {
      window.toast.error((error as Error).message)
    } finally {
      setQuickLoading(false)
    }
  }

  const uploadItems = useMemo<ItemType[]>(
    () => [
      {
        key: 'upload-webdav',
        label: t('settings.data.manual_schedule.providers.webdav'),
        disabled: !isWebdavConfigured,
        onClick: () => {
          void openQuickModal('webdav')
        }
      },
      {
        key: 'upload-local',
        label: t('settings.data.manual_schedule.providers.local'),
        disabled: !isLocalConfigured,
        onClick: () => {
          void openQuickModal('local')
        }
      },
      {
        key: 'upload-s3',
        label: t('settings.data.manual_schedule.providers.s3'),
        disabled: !isS3Configured,
        onClick: () => {
          void showS3BackupModal()
        }
      },
      {
        key: 'upload-nutstore',
        label: t('settings.data.manual_schedule.providers.nutstore'),
        disabled: !isNutstoreConfigured,
        onClick: () => {
          void openQuickModal('nutstore')
        }
      }
    ],
    [isLocalConfigured, isNutstoreConfigured, isS3Configured, isWebdavConfigured, openQuickModal, showS3BackupModal, t]
  )

  const restoreItems = useMemo<ItemType[]>(
    () => [
      {
        key: 'restore-webdav',
        label: t('settings.data.manual_schedule.providers.webdav'),
        disabled: !isWebdavConfigured,
        onClick: () => {
          setWebdavRestoreArtifactType('pc')
          setBackupManagerType('webdav')
        }
      },
      {
        key: 'restore-local',
        label: t('settings.data.manual_schedule.providers.local'),
        disabled: !isLocalConfigured,
        onClick: () => {
          setLocalRestoreArtifactType('pc')
          setBackupManagerType('local')
        }
      },
      {
        key: 'restore-s3',
        label: t('settings.data.manual_schedule.providers.s3'),
        disabled: !isS3Configured,
        onClick: () => setBackupManagerType('s3')
      },
      {
        key: 'restore-nutstore',
        label: t('settings.data.manual_schedule.providers.nutstore'),
        disabled: !isNutstoreConfigured,
        onClick: () => {
          setNutstoreRestoreArtifactType('pc')
          setBackupManagerType('nutstore')
        }
      }
    ],
    [isLocalConfigured, isNutstoreConfigured, isS3Configured, isWebdavConfigured, t]
  )

  const renderActionButton = (label: string, icon: ReactNode) => {
    if (isVertical) {
      return (
        <SidebarActionIcon $themeMode={theme} data-variant="sidebar" role="button" aria-label={label}>
          {icon}
        </SidebarActionIcon>
      )
    }

    return (
      <NavbarIcon role="button" aria-label={label}>
        {icon}
      </NavbarIcon>
    )
  }

  return (
    <>
      <HStack
        alignItems="center"
        gap={isVertical ? 5 : 8}
        className={className}
        aria-orientation={orientation}
        style={{ flexDirection: isVertical ? 'column' : 'row' }}>
        <Dropdown menu={{ items: uploadItems }} trigger={['click']} placement={isVertical ? 'topRight' : 'bottomRight'}>
          <DropdownTrigger>
            <Tooltip title={t('settings.data.manual_schedule.quick_actions.upload')} mouseEnterDelay={0.8}>
              {renderActionButton(t('settings.data.manual_schedule.quick_actions.upload'), <Upload size={18} />)}
            </Tooltip>
          </DropdownTrigger>
        </Dropdown>
        <Dropdown
          menu={{ items: restoreItems }}
          trigger={['click']}
          placement={isVertical ? 'topRight' : 'bottomRight'}>
          <DropdownTrigger>
            <Tooltip title={t('settings.data.manual_schedule.quick_actions.restore')} mouseEnterDelay={0.8}>
              {renderActionButton(t('settings.data.manual_schedule.quick_actions.restore'), <Download size={18} />)}
            </Tooltip>
          </DropdownTrigger>
        </Dropdown>
      </HStack>

      <S3BackupModal
        isModalVisible={isS3BackupModalVisible}
        handleBackup={handleS3Backup}
        handleCancel={handleCancelS3Backup}
        backuping={s3Backuping}
        customFileName={s3FileName}
        setCustomFileName={setS3FileName}
      />

      <WebdavBackupManager
        visible={backupManagerType === 'webdav'}
        onClose={() => setBackupManagerType(null)}
        webdavConfig={{
          webdavHost: settings.webdavHost,
          webdavUser: settings.webdavUser,
          webdavPass: settings.webdavPass,
          webdavPath: settings.webdavPath,
          webdavDisableStream: settings.webdavDisableStream
        }}
        fileFilter={webdavRestoreArtifactType === 'app' ? (file) => isMobileSyncRemoteFile(file.fileName) : undefined}
        restoreMethod={(fileName) =>
          webdavRestoreArtifactType === 'app'
            ? importMobileSyncFromWebdav(currentWebdavConfig, fileName)
            : restoreFromWebdavWithConfig(currentWebdavConfig, fileName)
        }
        artifactType={webdavRestoreArtifactType}
        onArtifactTypeChange={(value) => setWebdavRestoreArtifactType(value)}
        customLabels={{
          managerTitle: t('settings.data.artifact_type.cross_device_title'),
          managerEmptyText:
            webdavRestoreArtifactType === 'app' ? t('settings.data.webdav.mobile_sync.manager.empty') : undefined,
          restoreConfirmTitle:
            webdavRestoreArtifactType === 'app'
              ? t('settings.data.webdav.mobile_sync.restore.confirm.title')
              : undefined,
          restoreConfirmContent:
            webdavRestoreArtifactType === 'app'
              ? t('settings.data.webdav.mobile_sync.restore.confirm.content')
              : undefined,
          restoreSuccessMessage:
            webdavRestoreArtifactType === 'app' ? t('settings.data.webdav.mobile_sync.restore.success') : undefined
        }}
      />
      <LocalBackupManager
        visible={backupManagerType === 'local'}
        onClose={() => setBackupManagerType(null)}
        localBackupDir={resolvedLocalBackupDir}
        restoreMethod={localRestoreArtifactType === 'app' ? restoreMobileSyncFromLocal : restoreMigrationFromLocal}
        fileFilter={(fileName) =>
          localRestoreArtifactType === 'app' ? isMobileSyncRemoteFile(fileName) : isMigrationBackupFile(fileName)
        }
        artifactType={localRestoreArtifactType}
        onArtifactTypeChange={(value) => setLocalRestoreArtifactType(value)}
        customLabels={{
          title: t('settings.data.artifact_type.cross_device_title')
        }}
      />
      <S3BackupManager
        visible={backupManagerType === 's3'}
        onClose={() => setBackupManagerType(null)}
        s3Config={settings.s3}
      />
      <WebdavBackupManager
        visible={backupManagerType === 'nutstore'}
        onClose={() => setBackupManagerType(null)}
        webdavConfig={{
          webdavHost: NUTSTORE_HOST,
          webdavUser: nutstoreAuth?.username,
          webdavPass: nutstoreAuth?.accessToken,
          webdavPath: nutstorePath
        }}
        fileFilter={nutstoreRestoreArtifactType === 'app' ? (file) => isMobileSyncRemoteFile(file.fileName) : undefined}
        restoreMethod={(fileName) =>
          nutstoreRestoreArtifactType === 'app' ? importMobileSyncFromNutstore(fileName) : restoreFromNutstore(fileName)
        }
        artifactType={nutstoreRestoreArtifactType}
        onArtifactTypeChange={(value) => setNutstoreRestoreArtifactType(value)}
        customLabels={{
          managerTitle: t('settings.data.artifact_type.cross_device_title'),
          restoreConfirmTitle:
            nutstoreRestoreArtifactType === 'app'
              ? t('settings.data.nutstore.mobile_sync.restore.confirm.title')
              : t('settings.data.nutstore.restore.confirm.title'),
          restoreConfirmContent:
            nutstoreRestoreArtifactType === 'app'
              ? t('settings.data.nutstore.mobile_sync.restore.confirm.content')
              : t('settings.data.nutstore.restore.confirm.content'),
          managerEmptyText:
            nutstoreRestoreArtifactType === 'app' ? t('settings.data.nutstore.mobile_sync.manager.empty') : undefined,
          restoreSuccessMessage:
            nutstoreRestoreArtifactType === 'app' ? t('settings.data.nutstore.mobile_sync.restore.success') : undefined,
          invalidConfigMessage: t('message.error.invalid.nutstore')
        }}
      />

      <BackupTypeModal
        open={quickModalVisible}
        mode="backup"
        artifactType={quickArtifactType}
        onArtifactTypeChange={(value) => void handleQuickArtifactTypeChange(value)}
        onConfirm={() => void handleQuickConfirm()}
        onCancel={() => setQuickModalVisible(false)}
        loading={quickLoading}
        fileName={quickFileName}
        onFileNameChange={setQuickFileName}
      />
    </>
  )
}

const DropdownTrigger = styled.span`
  display: flex;
  justify-content: center;
  align-items: center;
  -webkit-app-region: none;
`

export default ManualSyncButtons
