import { beforeEach, describe, expect, it } from 'vitest'

import { decideAutoSyncAction, getNormalizedBackupData, hasMeaningfulLocalData } from '../AutoSyncService'

describe('AutoSyncService', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('strips runtime sync state from persisted backup data before hashing', () => {
    const normalized = getNormalizedBackupData(
      JSON.stringify({
        version: 5,
        localStorage: {
          'persist:cherry-studio': JSON.stringify({
            backup: JSON.stringify({
              webdavSync: { lastSyncTime: 100, syncing: true, lastSyncError: 'boom' },
              localBackupSync: { lastSyncTime: 200, syncing: true, lastSyncError: 'boom' },
              s3Sync: { lastSyncTime: 300, syncing: true, lastSyncError: 'boom' }
            }),
            nutstore: JSON.stringify({
              nutstoreToken: 'token',
              nutstorePath: '/sync',
              nutstoreSyncState: { lastSyncTime: 400, syncing: true, lastSyncError: 'boom' }
            }),
            settings: JSON.stringify({
              webdavHost: 'https://example.com'
            })
          })
        },
        indexedDB: {
          topics: [{ id: 'topic-1' }]
        }
      })
    )

    const normalizedBackup = JSON.parse(normalized)
    const persistedState = JSON.parse(normalizedBackup.localStorage['persist:cherry-studio'])
    const backupState = JSON.parse(persistedState.backup)
    const nutstoreState = JSON.parse(persistedState.nutstore)

    expect(backupState.webdavSync).toEqual({ lastSyncTime: null, syncing: false, lastSyncError: null })
    expect(backupState.localBackupSync).toEqual({ lastSyncTime: null, syncing: false, lastSyncError: null })
    expect(backupState.s3Sync).toEqual({ lastSyncTime: null, syncing: false, lastSyncError: null })
    expect(nutstoreState.nutstoreSyncState).toEqual({ lastSyncTime: null, syncing: false, lastSyncError: null })
  })

  it('detects whether local data is meaningful for bootstrap decisions', () => {
    const emptyBackup = JSON.stringify({
      version: 5,
      localStorage: {
        'persist:cherry-studio': JSON.stringify({
          assistants: JSON.stringify({
            assistants: [{ id: 'default' }]
          })
        })
      },
      indexedDB: {
        topics: [],
        files: [],
        knowledge_notes: [],
        translate_history: [],
        quick_phrases: [],
        message_blocks: [],
        translate_languages: [],
        settings: [{ id: 'theme', value: 'light' }]
      }
    })
    const assistantBackup = JSON.stringify({
      version: 5,
      localStorage: {
        'persist:cherry-studio': JSON.stringify({
          assistants: JSON.stringify({
            assistants: [{ id: 'default' }, { id: 'custom-1' }]
          })
        })
      },
      indexedDB: {
        topics: [],
        files: [],
        knowledge_notes: [],
        translate_history: [],
        quick_phrases: [],
        message_blocks: [],
        translate_languages: [],
        settings: []
      }
    })
    const indexedDbBackup = JSON.stringify({
      version: 5,
      localStorage: {
        'persist:cherry-studio': JSON.stringify({
          assistants: JSON.stringify({
            assistants: [{ id: 'default' }]
          })
        })
      },
      indexedDB: {
        topics: [{ id: 'topic-1' }],
        files: []
      }
    })

    expect(hasMeaningfulLocalData(emptyBackup)).toBe(false)
    expect(hasMeaningfulLocalData(assistantBackup)).toBe(true)
    expect(hasMeaningfulLocalData(indexedDbBackup)).toBe(true)
  })

  it('decides whether to push, pull, noop, or stop on conflicts', () => {
    expect(
      decideAutoSyncAction({
        metadata: {
          lastSyncedFingerprint: null,
          lastRemoteRevision: null,
          updatedAt: null
        },
        currentFingerprint: 'local-a',
        remoteRevision: null,
        hasMeaningfulLocalState: false
      })
    ).toBe('push')

    expect(
      decideAutoSyncAction({
        metadata: {
          lastSyncedFingerprint: null,
          lastRemoteRevision: null,
          updatedAt: null
        },
        currentFingerprint: 'local-a',
        remoteRevision: 'remote-1',
        hasMeaningfulLocalState: false
      })
    ).toBe('pull')

    expect(
      decideAutoSyncAction({
        metadata: {
          lastSyncedFingerprint: null,
          lastRemoteRevision: null,
          updatedAt: null
        },
        currentFingerprint: 'local-a',
        remoteRevision: 'remote-1',
        hasMeaningfulLocalState: true
      })
    ).toBe('conflict')

    expect(
      decideAutoSyncAction({
        metadata: {
          lastSyncedFingerprint: 'fingerprint-1',
          lastRemoteRevision: 'remote-1',
          updatedAt: 1
        },
        currentFingerprint: 'fingerprint-1',
        remoteRevision: 'remote-1',
        hasMeaningfulLocalState: true
      })
    ).toBe('noop')

    expect(
      decideAutoSyncAction({
        metadata: {
          lastSyncedFingerprint: 'fingerprint-1',
          lastRemoteRevision: 'remote-1',
          updatedAt: 1
        },
        currentFingerprint: 'fingerprint-2',
        remoteRevision: 'remote-1',
        hasMeaningfulLocalState: true
      })
    ).toBe('push')

    expect(
      decideAutoSyncAction({
        metadata: {
          lastSyncedFingerprint: 'fingerprint-1',
          lastRemoteRevision: 'remote-1',
          updatedAt: 1
        },
        currentFingerprint: 'fingerprint-1',
        remoteRevision: 'remote-2',
        hasMeaningfulLocalState: true
      })
    ).toBe('pull')

    expect(
      decideAutoSyncAction({
        metadata: {
          lastSyncedFingerprint: 'fingerprint-1',
          lastRemoteRevision: 'remote-1',
          updatedAt: 1
        },
        currentFingerprint: 'fingerprint-2',
        remoteRevision: 'remote-2',
        hasMeaningfulLocalState: true
      })
    ).toBe('conflict')
  })
})
