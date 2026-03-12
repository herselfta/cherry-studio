import { beforeEach, describe, expect, it } from 'vitest'

import {
  getNextManualSyncOccurrence,
  loadManualSyncSchedule,
  normalizeManualSyncScheduleConfig,
  normalizeManualSyncTime,
  pickLatestManualBackup,
  saveManualSyncSchedule,
  sortManualSyncTimes
} from '../ManualSyncScheduleService'

describe('ManualSyncScheduleService', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('normalizes daily times and removes duplicates', () => {
    expect(sortManualSyncTimes(['9:05', '23:10', '09:05', 'invalid'])).toEqual(['09:05', '23:10'])
    expect(normalizeManualSyncTime('7:03')).toBe('07:03')
    expect(normalizeManualSyncTime('25:00')).toBeNull()
  })

  it('normalizes schedule configs with defaults', () => {
    expect(
      normalizeManualSyncScheduleConfig({
        uploadTimes: ['18:30', '08:00', '18:30'],
        restoreTimes: ['06:30'],
        confirmBeforeRestore: false
      })
    ).toEqual({
      uploadTimes: ['08:00', '18:30'],
      restoreTimes: ['06:30'],
      confirmBeforeRestore: false
    })

    expect(normalizeManualSyncScheduleConfig()).toEqual({
      uploadTimes: [],
      restoreTimes: [],
      confirmBeforeRestore: true
    })
  })

  it('calculates the next daily occurrence across multiple times', () => {
    const sameDay = getNextManualSyncOccurrence(new Date(2026, 2, 12, 8, 10, 0), ['08:30', '21:15'])
    const nextDay = getNextManualSyncOccurrence(new Date(2026, 2, 12, 23, 59, 0), ['08:30', '21:15'])

    expect(sameDay?.getFullYear()).toBe(2026)
    expect(sameDay?.getMonth()).toBe(2)
    expect(sameDay?.getDate()).toBe(12)
    expect(sameDay?.getHours()).toBe(8)
    expect(sameDay?.getMinutes()).toBe(30)

    expect(nextDay?.getFullYear()).toBe(2026)
    expect(nextDay?.getMonth()).toBe(2)
    expect(nextDay?.getDate()).toBe(13)
    expect(nextDay?.getHours()).toBe(8)
    expect(nextDay?.getMinutes()).toBe(30)
  })

  it('picks the latest manual backup and skips the internal sync snapshot', () => {
    expect(
      pickLatestManualBackup([
        {
          fileName: 'cherry-studio.sync.zip',
          modifiedTime: '2026-03-12T08:00:00.000Z',
          size: 1
        },
        {
          fileName: 'cherry-studio.20260312090000.device.zip',
          modifiedTime: '2026-03-12T09:00:00.000Z',
          size: 2
        }
      ])
    ).toEqual({
      fileName: 'cherry-studio.20260312090000.device.zip',
      modifiedTime: '2026-03-12T09:00:00.000Z',
      size: 2
    })
  })

  it('persists provider-specific schedule settings', () => {
    saveManualSyncSchedule('webdav', {
      uploadTimes: ['09:00'],
      restoreTimes: ['20:00'],
      confirmBeforeRestore: false
    })

    expect(loadManualSyncSchedule('webdav')).toEqual({
      uploadTimes: ['09:00'],
      restoreTimes: ['20:00'],
      confirmBeforeRestore: false
    })
    expect(loadManualSyncSchedule('s3')).toEqual({
      uploadTimes: [],
      restoreTimes: [],
      confirmBeforeRestore: true
    })
  })
})
