import { PlusOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import {
  type ManualSyncProvider,
  loadManualSyncSchedule,
  normalizeManualSyncScheduleConfig,
  refreshManualSyncSchedules,
  saveManualSyncSchedule
} from '@renderer/services/ManualSyncScheduleService'
import { Button, Switch, Tag, TimePicker, Typography } from 'antd'
import type { Dayjs } from 'dayjs'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingHelpText, SettingRow, SettingRowTitle } from '..'

interface ManualSyncScheduleSettingsProps {
  provider: ManualSyncProvider
  isConfigured: boolean
}

const ManualSyncScheduleSettings: FC<ManualSyncScheduleSettingsProps> = ({ provider, isConfigured }) => {
  const [config, setConfig] = useState(() => loadManualSyncSchedule(provider))
  const { t } = useTranslation()

  useEffect(() => {
    setConfig(loadManualSyncSchedule(provider))
  }, [provider])

  const updateConfig = (nextConfig: typeof config) => {
    const normalizedConfig = normalizeManualSyncScheduleConfig(nextConfig)
    setConfig(normalizedConfig)
    saveManualSyncSchedule(provider, normalizedConfig)
    refreshManualSyncSchedules()
  }

  return (
    <>
      <SettingRow>
        <SettingRowTitle>{t('settings.data.manual_schedule.upload_times.label')}</SettingRowTitle>
        <DailyTimeEditor
          ariaLabel={t('settings.data.manual_schedule.upload_times.aria')}
          emptyText={t('settings.data.manual_schedule.empty')}
          times={config.uploadTimes}
          onChange={(uploadTimes) => updateConfig({ ...config, uploadTimes })}
        />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>
          {isConfigured ? t('settings.data.manual_schedule.help') : t('settings.data.manual_schedule.requires_setup')}
        </SettingHelpText>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.manual_schedule.restore_times.label')}</SettingRowTitle>
        <DailyTimeEditor
          ariaLabel={t('settings.data.manual_schedule.restore_times.aria')}
          emptyText={t('settings.data.manual_schedule.empty')}
          times={config.restoreTimes}
          onChange={(restoreTimes) => updateConfig({ ...config, restoreTimes })}
        />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.manual_schedule.restore_times.help')}</SettingHelpText>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.manual_schedule.confirm_before_restore.label')}</SettingRowTitle>
        <Switch
          checked={config.confirmBeforeRestore}
          onChange={(confirmBeforeRestore) => updateConfig({ ...config, confirmBeforeRestore })}
        />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.manual_schedule.confirm_before_restore.help')}</SettingHelpText>
      </SettingRow>
    </>
  )
}

interface DailyTimeEditorProps {
  ariaLabel: string
  emptyText: string
  times: string[]
  onChange: (times: string[]) => void
}

const DailyTimeEditor: FC<DailyTimeEditorProps> = ({ ariaLabel, emptyText, times, onChange }) => {
  const [draftTime, setDraftTime] = useState<Dayjs | null>(null)
  const { t } = useTranslation()

  const handleAddTime = () => {
    if (!draftTime) {
      return
    }

    const nextTime = draftTime.format('HH:mm')
    if (!times.includes(nextTime)) {
      onChange([...times, nextTime])
    }
    setDraftTime(null)
  }

  return (
    <div style={{ display: 'flex', minWidth: 280, flexDirection: 'column', gap: 10, alignItems: 'flex-end' }}>
      <HStack gap="5px" style={{ justifyContent: 'flex-end' }}>
        <TimePicker
          value={draftTime}
          onChange={setDraftTime}
          format="HH:mm"
          minuteStep={5}
          needConfirm={false}
          allowClear
          aria-label={ariaLabel}
        />
        <Button type="default" icon={<PlusOutlined />} onClick={handleAddTime} disabled={!draftTime}>
          {t('common.add')}
        </Button>
      </HStack>
      {times.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
          {times.map((time) => (
            <Tag
              key={time}
              closable
              onClose={(event) => {
                event.preventDefault()
                onChange(times.filter((item) => item !== time))
              }}>
              {time}
            </Tag>
          ))}
        </div>
      ) : (
        <Typography.Text type="secondary">{emptyText}</Typography.Text>
      )}
    </div>
  )
}

export default ManualSyncScheduleSettings
