import { loggerService } from '@logger'
import { backupToLocal } from '@renderer/services/BackupService'
import { Button, Input, Modal } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface LocalBackupModalProps {
  isModalVisible: boolean
  handleBackup: () => void
  handleCancel: () => void
  backuping: boolean
  customFileName: string
  setCustomFileName: (value: string) => void
  customLabels?: {
    title?: string
    filenamePlaceholder?: string
  }
}

const logger = loggerService.withContext('LocalBackupModal')

export function LocalBackupModal({
  isModalVisible,
  handleBackup,
  handleCancel,
  backuping,
  customFileName,
  setCustomFileName,
  customLabels
}: LocalBackupModalProps) {
  const { t } = useTranslation()

  return (
    <Modal
      title={customLabels?.title || t('settings.data.local.backup.modal.title')}
      open={isModalVisible}
      onOk={handleBackup}
      onCancel={handleCancel}
      footer={[
        <Button key="back" onClick={handleCancel}>
          {t('common.cancel')}
        </Button>,
        <Button key="submit" type="primary" loading={backuping} onClick={handleBackup}>
          {t('common.confirm')}
        </Button>
      ]}>
      <Input
        value={customFileName}
        onChange={(e) => setCustomFileName(e.target.value)}
        placeholder={customLabels?.filenamePlaceholder || t('settings.data.local.backup.modal.filename.placeholder')}
      />
    </Modal>
  )
}

// Hook for backup modal
export function useLocalBackupModal(
  localBackupDir: string | undefined,
  {
    backupMethod = backupToLocal,
    defaultFileNameBuilder
  }: {
    backupMethod?: typeof backupToLocal
    defaultFileNameBuilder?: (args: { timestamp: string; hostname: string; deviceType: string }) => string
  } = {}
) {
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [backuping, setBackuping] = useState(false)
  const [customFileName, setCustomFileName] = useState('')

  const handleCancel = () => {
    setIsModalVisible(false)
  }

  const showBackupModal = useCallback(async () => {
    const deviceType = await window.api.system.getDeviceType()
    const hostname = await window.api.system.getHostname()
    const timestamp = dayjs().format('YYYYMMDDHHmmss')
    const defaultFileName =
      defaultFileNameBuilder?.({ timestamp, hostname, deviceType }) ||
      `cherry-studio.${timestamp}.${hostname}.${deviceType}.zip`
    setCustomFileName(defaultFileName)
    setIsModalVisible(true)
  }, [defaultFileNameBuilder])

  const handleBackup = async () => {
    if (!localBackupDir) {
      setIsModalVisible(false)
      return
    }

    setBackuping(true)
    try {
      await backupMethod({
        showMessage: true,
        customFileName: customFileName || undefined
      })
      setIsModalVisible(false)
    } catch (error) {
      logger.error('Backup failed:', error as Error)
    } finally {
      setBackuping(false)
    }
  }

  return {
    isModalVisible,
    handleBackup,
    handleCancel,
    backuping,
    customFileName,
    setCustomFileName,
    showBackupModal
  }
}
