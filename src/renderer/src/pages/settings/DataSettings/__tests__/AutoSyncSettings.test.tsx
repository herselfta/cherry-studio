import { render, screen } from '@testing-library/react'
import type { TFunction } from 'i18next'
import { describe, expect, it, vi } from 'vitest'

import {
  AutoSyncDescription,
  AutoSyncStatusValue,
  getAutoSyncIntervalOptions,
  getAutoSyncIntervalValue
} from '../AutoSyncSettings'

const translationMap: Record<string, string | ((options?: Record<string, unknown>) => string)> = {
  'settings.data.auto_sync.help':
    'Checks local and remote changes on the selected interval. Local changes are pushed automatically.',
  'settings.data.auto_sync.requiresSetup': 'Complete this storage configuration to enable automatic sync.',
  'settings.data.auto_sync.status.error': 'Sync Issue',
  'settings.data.auto_sync.status.lastSync': ({ time } = {}) => `Last sync: ${time}`,
  'settings.data.auto_sync.status.pending': 'Enabled, waiting for the first sync',
  'settings.data.auto_sync.status.syncing': 'Syncing',
  'settings.data.auto_sync.status.unavailable': 'Finish setup to view sync status',
  'settings.data.auto_sync.interval.hour': ({ count } = {}) => `Every ${count} hour${count === 1 ? '' : 's'}`,
  'settings.data.auto_sync.interval.minute': ({ count } = {}) => `Every ${count} minute${count === 1 ? '' : 's'}`
}

const t = ((key: string, options?: Record<string, unknown>) => {
  const value = translationMap[key]
  if (typeof value === 'function') {
    return value(options)
  }
  return value ?? key
}) as TFunction<'translation'>

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t
  })
}))

describe('AutoSyncSettings', () => {
  it('builds interval options without an off entry', () => {
    const options = getAutoSyncIntervalOptions(t)

    expect(options.map((option) => option.value)).toEqual([1, 5, 15, 30, 60, 120, 360, 720, 1440])
    expect(getAutoSyncIntervalValue(0)).toBeUndefined()
    expect(getAutoSyncIntervalValue(15)).toBe(15)
  })

  it('shows setup guidance when sync is not configured', () => {
    render(<AutoSyncDescription isConfigured={false} />)

    expect(screen.getByText('Complete this storage configuration to enable automatic sync.')).toBeInTheDocument()
  })

  it('shows pending state before the first sync', () => {
    render(
      <AutoSyncStatusValue
        isConfigured={true}
        syncState={{ lastSyncTime: null, syncing: false, lastSyncError: null }}
      />
    )

    expect(screen.getByText('Enabled, waiting for the first sync')).toBeInTheDocument()
  })

  it('shows syncing and last sync states', () => {
    const { rerender } = render(
      <AutoSyncStatusValue isConfigured={true} syncState={{ lastSyncTime: null, syncing: true, lastSyncError: null }} />
    )

    expect(screen.getByText('Syncing')).toBeInTheDocument()

    rerender(
      <AutoSyncStatusValue
        isConfigured={true}
        syncState={{ lastSyncTime: new Date(2026, 2, 12, 9, 8, 7).getTime(), syncing: false, lastSyncError: null }}
      />
    )

    expect(screen.getByText('Last sync: 09:08:07')).toBeInTheDocument()
  })
})
