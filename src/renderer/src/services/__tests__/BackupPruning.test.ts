import { describe, expect, it } from 'vitest'

import {
  getAppMigrationBackupFilesToDelete,
  getLocalBackupFilesToDelete,
  getRemotePortableBackupFilesToDelete
} from '../BackupService'

describe('Backup Pruning Logic', () => {
  describe('getLocalBackupFilesToDelete', () => {
    it('keeps the newest local backups even when host or device names change', () => {
      const files = [
        {
          fileName: 'cherry-studio.20260510090000.alpha.laptop.zip',
          modifiedTime: '2026-05-10T09:00:00.000Z',
          size: 100
        },
        {
          fileName: 'cherry-studio.20260510080000.beta.desktop.zip',
          modifiedTime: '2026-05-10T08:00:00.000Z',
          size: 100
        },
        {
          fileName: 'cherry-studio.20260510070000.gamma.tablet.zip',
          modifiedTime: '2026-05-10T07:00:00.000Z',
          size: 100
        },
        {
          fileName: 'cherry-studio.sync.zip',
          modifiedTime: '2026-05-10T10:00:00.000Z',
          size: 100
        }
      ]

      // Should keep 2 newest backups matching pattern, ignore sync.zip
      // Newest: 09:00, 08:00
      // Oldest to delete: 07:00
      expect(getLocalBackupFilesToDelete(files, 2)).toEqual([
        {
          fileName: 'cherry-studio.20260510070000.gamma.tablet.zip',
          modifiedTime: '2026-05-10T07:00:00.000Z',
          size: 100
        }
      ])
    })
  })

  describe('getRemotePortableBackupFilesToDelete', () => {
    it('correctly filters and prunes remote portable backups', () => {
      const files = [
        {
          fileName: 'cherry-studio.20260510090000.alpha.laptop.zip',
          modifiedTime: '2026-05-10T09:00:00.000Z',
          size: 100
        },
        {
          fileName: 'cherry-studio.20260510080000.beta.desktop.zip',
          modifiedTime: '2026-05-10T08:00:00.000Z',
          size: 100
        },
        {
          fileName: 'cherry-studio.20260510070000.gamma.tablet.zip',
          modifiedTime: '2026-05-10T07:00:00.000Z',
          size: 100
        },
        {
          fileName: 'cherry-studio.backup.zip',
          modifiedTime: '2026-05-10T10:00:00.000Z',
          size: 100
        }
      ]

      // Remote helper ignores .backup.zip, sees 3 files, deletes oldest (07:00)
      expect(getRemotePortableBackupFilesToDelete(files, 2)).toEqual([
        {
          fileName: 'cherry-studio.20260510070000.gamma.tablet.zip',
          modifiedTime: '2026-05-10T07:00:00.000Z',
          size: 100
        }
      ])
    })
  })

  describe('getAppMigrationBackupFilesToDelete', () => {
    it('correctly filters and prunes mobile sync (app) backups separately', () => {
      const files = [
        // PC Backups (should be ignored by this helper)
        {
          fileName: 'cherry-studio.20260510090000.laptop.zip',
          modifiedTime: '2026-05-10T09:00:00.000Z',
          size: 100
        },
        // App Backups
        {
          fileName: 'cherry-studio.mobile-sync.20260510080000.laptop.json',
          modifiedTime: '2026-05-10T08:00:00.000Z',
          size: 100
        },
        {
          fileName: 'cherry-studio.mobile-sync.20260510070000.laptop.json',
          modifiedTime: '2026-05-10T07:00:00.000Z',
          size: 100
        },
        {
          fileName: 'cherry-studio.mobile-sync.20260510060000.laptop.json',
          modifiedTime: '2026-05-10T06:00:00.000Z',
          size: 100
        }
      ]

      // With maxBackups = 2, it should delete the oldest app backup (06:00:00)
      // and ignore the PC backup (09:00:00)
      const result = getAppMigrationBackupFilesToDelete(files, 2)

      expect(result).toEqual([
        {
          fileName: 'cherry-studio.mobile-sync.20260510060000.laptop.json',
          modifiedTime: '2026-05-10T06:00:00.000Z',
          size: 100
        }
      ])
    })
  })
})
