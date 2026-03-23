import { Button, Input, Modal, Segmented } from 'antd'
import type { TFunction } from 'i18next'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

export type BackupArtifactType = 'pc' | 'app'

interface BackupTypeModalProps {
  open: boolean
  mode: 'backup' | 'restore'
  artifactType: BackupArtifactType
  onArtifactTypeChange: (value: BackupArtifactType) => void
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
  fileName?: string
  onFileNameChange?: (value: string) => void
  customLabels?: {
    title?: string
    filenamePlaceholder?: string
  }
}

export function getBackupArtifactOptions(t: TFunction) {
  return [
    { label: t('settings.data.artifact_type.pc'), value: 'pc' },
    { label: t('settings.data.artifact_type.app'), value: 'app' }
  ] satisfies Array<{ label: string; value: BackupArtifactType }>
}

const BackupTypeModal: FC<BackupTypeModalProps> = ({
  open,
  mode,
  artifactType,
  onArtifactTypeChange,
  onConfirm,
  onCancel,
  loading = false,
  fileName,
  onFileNameChange,
  customLabels
}) => {
  const { t } = useTranslation()

  return (
    <Modal
      title={customLabels?.title || t(mode === 'backup' ? 'settings.data.artifact_type.backup_title' : 'settings.data.artifact_type.restore_title')}
      open={open}
      onOk={onConfirm}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          {t('common.cancel')}
        </Button>,
        <Button key="confirm" type="primary" loading={loading} onClick={onConfirm}>
          {t('common.confirm')}
        </Button>
      ]}
      centered>
      <Segmented
        block
        value={artifactType}
        onChange={(value) => onArtifactTypeChange(value as BackupArtifactType)}
        options={getBackupArtifactOptions(t)}
      />
      {mode === 'backup' && onFileNameChange && (
        <Input
          style={{ marginTop: 16 }}
          value={fileName}
          onChange={(event) => onFileNameChange(event.target.value)}
          placeholder={
            customLabels?.filenamePlaceholder || t('settings.data.local.backup.modal.filename.placeholder')
          }
        />
      )}
    </Modal>
  )
}

export default BackupTypeModal
