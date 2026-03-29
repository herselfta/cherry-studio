import { beforeEach, describe, expect, it } from 'vitest'

import {
  getLatestMobileSyncLedgerEntry,
  getMobileSyncLedgerEntry,
  MOBILE_SYNC_GLOBAL_LEDGER_STORAGE_KEY,
  MOBILE_SYNC_LEDGER_STORAGE_KEY,
  writeLatestMobileSyncLedgerEntry,
  writeMobileSyncLedgerEntry
} from '../mobileSyncLedger'

describe('mobileSyncLedger', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stores the latest imported portable snapshot globally instead of only per source device', () => {
    writeMobileSyncLedgerEntry('device-a', {
      lastImportedExportedAt: 10,
      topicIds: ['topic-a'],
      messageIds: ['message-a'],
      blockIds: ['block-a']
    })
    writeLatestMobileSyncLedgerEntry({
      lastImportedExportedAt: 20,
      topicIds: ['topic-b'],
      messageIds: ['message-b'],
      blockIds: ['block-b']
    })

    expect(getMobileSyncLedgerEntry('device-a')).toEqual(
      expect.objectContaining({
        lastImportedExportedAt: 10,
        topicIds: ['topic-a']
      })
    )
    expect(getLatestMobileSyncLedgerEntry()).toEqual(
      expect.objectContaining({
        lastImportedExportedAt: 20,
        topicIds: ['topic-b'],
        messageIds: ['message-b'],
        blockIds: ['block-b']
      })
    )
    expect(localStorage.getItem(MOBILE_SYNC_LEDGER_STORAGE_KEY)).toContain('device-a')
    expect(localStorage.getItem(MOBILE_SYNC_GLOBAL_LEDGER_STORAGE_KEY)).toContain('topic-b')
  })
})
