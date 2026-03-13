import { HStack } from '@renderer/components/Layout'
import { LocalBackupManager } from '@renderer/components/LocalBackupManager'
import { LocalBackupModal, useLocalBackupModal } from '@renderer/components/LocalBackupModals'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { S3BackupManager } from '@renderer/components/S3BackupManager'
import { S3BackupModal, useS3BackupModal } from '@renderer/components/S3Modals'
import { WebdavBackupManager } from '@renderer/components/WebdavBackupManager'
import { useWebdavBackupModal, WebdavBackupModal } from '@renderer/components/WebdavModals'
import { useSettings } from '@renderer/hooks/useSettings'
import { backupToNutstore, restoreFromNutstore } from '@renderer/services/NutstoreService'
import { useAppSelector } from '@renderer/store'
import { NUTSTORE_HOST } from '@shared/config/nutstore'
import { Dropdown, Tooltip } from 'antd'
import type { ItemType } from 'antd/es/menu/interface'
import { Download, Upload } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const ManualSyncButtons: FC = () => {
  const { t } = useTranslation()
  const settings = useSettings()
  const { nutstoreToken, nutstorePath } = useAppSelector((state) => state.nutstore)

  const [resolvedLocalBackupDir, setResolvedLocalBackupDir] = useState<string | undefined>(undefined)
  const [backupManagerType, setBackupManagerType] = useState<'webdav' | 'local' | 's3' | 'nutstore' | null>(null)
  const [nutstoreAuth, setNutstoreAuth] = useState<{ username: string; accessToken: string } | null>(null)

  const {
    isModalVisible: isWebdavBackupModalVisible,
    handleBackup: handleWebdavBackup,
    handleCancel: handleCancelWebdavBackup,
    backuping: webdavBackuping,
    customFileName: webdavFileName,
    setCustomFileName: setWebdavFileName,
    showBackupModal: showWebdavBackupModal
  } = useWebdavBackupModal()
  const {
    isModalVisible: isNutstoreBackupModalVisible,
    handleBackup: handleNutstoreBackup,
    handleCancel: handleCancelNutstoreBackup,
    backuping: nutstoreBackuping,
    customFileName: nutstoreFileName,
    setCustomFileName: setNutstoreFileName,
    showBackupModal: showNutstoreBackupModal
  } = useWebdavBackupModal({ backupMethod: backupToNutstore })
  const {
    isModalVisible: isS3BackupModalVisible,
    handleBackup: handleS3Backup,
    handleCancel: handleCancelS3Backup,
    backuping: s3Backuping,
    customFileName: s3FileName,
    setCustomFileName: setS3FileName,
    showBackupModal: showS3BackupModal
  } = useS3BackupModal()
  const {
    isModalVisible: isLocalBackupModalVisible,
    handleBackup: handleLocalBackup,
    handleCancel: handleCancelLocalBackup,
    backuping: localBackuping,
    customFileName: localFileName,
    setCustomFileName: setLocalFileName,
    showBackupModal: showLocalBackupModal
  } = useLocalBackupModal(resolvedLocalBackupDir)

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

  const uploadItems = useMemo<ItemType[]>(
    () => [
      {
        key: 'upload-webdav',
        label: t('settings.data.manual_schedule.providers.webdav'),
        disabled: !isWebdavConfigured,
        onClick: () => {
          void showWebdavBackupModal()
        }
      },
      {
        key: 'upload-local',
        label: t('settings.data.manual_schedule.providers.local'),
        disabled: !isLocalConfigured,
        onClick: () => {
          void showLocalBackupModal()
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
          void showNutstoreBackupModal()
        }
      }
    ],
    [
      isLocalConfigured,
      isNutstoreConfigured,
      isS3Configured,
      isWebdavConfigured,
      showLocalBackupModal,
      showNutstoreBackupModal,
      showS3BackupModal,
      showWebdavBackupModal,
      t
    ]
  )

  const restoreItems = useMemo<ItemType[]>(
    () => [
      {
        key: 'restore-webdav',
        label: t('settings.data.manual_schedule.providers.webdav'),
        disabled: !isWebdavConfigured,
        onClick: () => setBackupManagerType('webdav')
      },
      {
        key: 'restore-local',
        label: t('settings.data.manual_schedule.providers.local'),
        disabled: !isLocalConfigured,
        onClick: () => setBackupManagerType('local')
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
        onClick: () => setBackupManagerType('nutstore')
      }
    ],
    [isLocalConfigured, isNutstoreConfigured, isS3Configured, isWebdavConfigured, t]
  )

  return (
    <>
      <HStack alignItems="center" gap={8}>
        <Dropdown menu={{ items: uploadItems }} trigger={['click']} placement="bottomRight">
          <span>
            <Tooltip title={t('settings.data.manual_schedule.quick_actions.upload')} mouseEnterDelay={0.8}>
              <NavbarIcon role="button" aria-label={t('settings.data.manual_schedule.quick_actions.upload')}>
                <Upload size={18} />
              </NavbarIcon>
            </Tooltip>
          </span>
        </Dropdown>
        <Dropdown menu={{ items: restoreItems }} trigger={['click']} placement="bottomRight">
          <span>
            <Tooltip title={t('settings.data.manual_schedule.quick_actions.restore')} mouseEnterDelay={0.8}>
              <NavbarIcon role="button" aria-label={t('settings.data.manual_schedule.quick_actions.restore')}>
                <Download size={18} />
              </NavbarIcon>
            </Tooltip>
          </span>
        </Dropdown>
      </HStack>

      <WebdavBackupModal
        isModalVisible={isWebdavBackupModalVisible}
        handleBackup={handleWebdavBackup}
        handleCancel={handleCancelWebdavBackup}
        backuping={webdavBackuping}
        customFileName={webdavFileName}
        setCustomFileName={setWebdavFileName}
      />
      <WebdavBackupModal
        isModalVisible={isNutstoreBackupModalVisible}
        handleBackup={handleNutstoreBackup}
        handleCancel={handleCancelNutstoreBackup}
        backuping={nutstoreBackuping}
        customFileName={nutstoreFileName}
        setCustomFileName={setNutstoreFileName}
        customLabels={{
          modalTitle: t('settings.data.nutstore.backup.modal.title'),
          filenamePlaceholder: t('settings.data.nutstore.backup.modal.filename.placeholder')
        }}
      />
      <S3BackupModal
        isModalVisible={isS3BackupModalVisible}
        handleBackup={handleS3Backup}
        handleCancel={handleCancelS3Backup}
        backuping={s3Backuping}
        customFileName={s3FileName}
        setCustomFileName={setS3FileName}
      />
      <LocalBackupModal
        isModalVisible={isLocalBackupModalVisible}
        handleBackup={handleLocalBackup}
        handleCancel={handleCancelLocalBackup}
        backuping={localBackuping}
        customFileName={localFileName}
        setCustomFileName={setLocalFileName}
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
      />
      <LocalBackupManager
        visible={backupManagerType === 'local'}
        onClose={() => setBackupManagerType(null)}
        localBackupDir={resolvedLocalBackupDir}
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
        restoreMethod={restoreFromNutstore}
        customLabels={{
          restoreConfirmTitle: t('settings.data.nutstore.restore.confirm.title'),
          restoreConfirmContent: t('settings.data.nutstore.restore.confirm.content'),
          invalidConfigMessage: t('message.error.invalid.nutstore')
        }}
      />
    </>
  )
}

export default ManualSyncButtons
