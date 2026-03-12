import { fireEvent, render, screen } from '@testing-library/react'
import type { TFunction } from 'i18next'
import { describe, expect, it, vi } from 'vitest'

import ManualSyncScheduleSettings from '../ManualSyncScheduleSettings'

const serviceMocks = vi.hoisted(() => ({
  loadManualSyncSchedule: vi.fn(),
  saveManualSyncSchedule: vi.fn(),
  refreshManualSyncSchedules: vi.fn()
}))

const translationMap: Record<string, string> = {
  'common.add': 'Add',
  'settings.data.manual_schedule.confirm_before_restore.help': 'Ask before restoring scheduled backups.',
  'settings.data.manual_schedule.confirm_before_restore.label': 'Confirm Before Restore',
  'settings.data.manual_schedule.empty': 'No times configured',
  'settings.data.manual_schedule.help': 'Uploads run every day at the selected times.',
  'settings.data.manual_schedule.requires_setup': 'This storage needs setup before the schedule can run.',
  'settings.data.manual_schedule.restore_times.aria': 'Scheduled restore times',
  'settings.data.manual_schedule.restore_times.help': 'Restores always use the latest manual backup.',
  'settings.data.manual_schedule.restore_times.label': 'Scheduled Restore Times',
  'settings.data.manual_schedule.upload_times.aria': 'Scheduled upload times',
  'settings.data.manual_schedule.upload_times.label': 'Scheduled Upload Times'
}

const t = ((key: string) => translationMap[key] ?? key) as TFunction<'translation'>

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t
  })
}))

vi.mock('@renderer/services/ManualSyncScheduleService', () => ({
  loadManualSyncSchedule: serviceMocks.loadManualSyncSchedule,
  normalizeManualSyncScheduleConfig: (config: unknown) => config,
  refreshManualSyncSchedules: serviceMocks.refreshManualSyncSchedules,
  saveManualSyncSchedule: serviceMocks.saveManualSyncSchedule
}))

describe('ManualSyncScheduleSettings', () => {
  it('shows current schedule and persists confirm toggle changes', () => {
    serviceMocks.loadManualSyncSchedule.mockReturnValue({
      uploadTimes: ['09:00'],
      restoreTimes: [],
      confirmBeforeRestore: true
    })

    render(<ManualSyncScheduleSettings provider="webdav" isConfigured={true} />)

    expect(screen.getByText('09:00')).toBeInTheDocument()
    expect(screen.getByText('No times configured')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch'))

    expect(serviceMocks.saveManualSyncSchedule).toHaveBeenCalledWith('webdav', {
      uploadTimes: ['09:00'],
      restoreTimes: [],
      confirmBeforeRestore: false
    })
    expect(serviceMocks.refreshManualSyncSchedules).toHaveBeenCalled()
  })

  it('shows setup guidance when the provider is not configured yet', () => {
    serviceMocks.loadManualSyncSchedule.mockReturnValue({
      uploadTimes: [],
      restoreTimes: [],
      confirmBeforeRestore: true
    })

    render(<ManualSyncScheduleSettings provider="local" isConfigured={false} />)

    expect(screen.getByText('This storage needs setup before the schedule can run.')).toBeInTheDocument()
  })
})
