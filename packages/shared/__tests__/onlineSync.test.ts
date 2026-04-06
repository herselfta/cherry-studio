import { describe, expect, it } from 'vitest'

import {
  applyMobileOnlineSyncChanges,
  buildMobileOnlineSyncChanges,
  createEmptyMobileOnlineSyncState,
  markMobileOnlineSyncChangesPublished,
  MOBILE_ONLINE_SYNC_PROFILE_ID,
  type MobileOnlineSyncSnapshot,
  prepareMobileOnlineSyncState
} from '../mobileSync/onlineSync'

function createSnapshot(overrides?: Partial<MobileOnlineSyncSnapshot>): MobileOnlineSyncSnapshot {
  return {
    profile: {
      id: MOBILE_ONLINE_SYNC_PROFILE_ID,
      userName: 'tester'
    },
    assistants: [
      {
        id: 'default',
        name: 'Default',
        prompt: '',
        type: 'system',
        topics: []
      }
    ],
    topics: [],
    messages: [],
    messageBlocks: [],
    ...overrides
  }
}

describe('mobile online sync state', () => {
  it('does not delete a local topic when the incoming delta never mentions it', () => {
    const initialSnapshot = createSnapshot({
      topics: [
        {
          id: 'topic-local',
          assistantId: 'default',
          name: 'Local Topic',
          createdAt: 1,
          updatedAt: 1
        }
      ]
    })

    const localPrepared = prepareMobileOnlineSyncState(initialSnapshot, createEmptyMobileOnlineSyncState('desktop-a'))
    const result = applyMobileOnlineSyncChanges(localPrepared.snapshot, localPrepared.state, [])

    expect(result.snapshot.topics.map((topic) => topic.id)).toEqual(['topic-local'])
    expect(result.acceptedChanges).toEqual([])
    expect(result.skippedChanges).toEqual([])
  })

  it('builds delta changes only for records that actually changed', () => {
    const initialSnapshot = createSnapshot({
      topics: [
        {
          id: 'topic-1',
          assistantId: 'default',
          name: 'Topic One',
          createdAt: 1,
          updatedAt: 1
        }
      ]
    })

    const prepared = prepareMobileOnlineSyncState(initialSnapshot, createEmptyMobileOnlineSyncState('mobile-a'))
    const publishedState = markMobileOnlineSyncChangesPublished(
      prepared.state,
      buildMobileOnlineSyncChanges(prepared.snapshot, prepared.state)
    )

    const updatedSnapshot = createSnapshot({
      topics: [
        {
          id: 'topic-1',
          assistantId: 'default',
          name: 'Topic One Renamed',
          createdAt: 1,
          updatedAt: 2
        }
      ]
    })

    const updatedPrepared = prepareMobileOnlineSyncState(updatedSnapshot, publishedState)
    const changes = buildMobileOnlineSyncChanges(updatedPrepared.snapshot, updatedPrepared.state)

    expect(changes).toHaveLength(1)
    expect(changes[0]).toEqual(
      expect.objectContaining({
        entityType: 'topic',
        entityId: 'topic-1',
        op: 'upsert',
        data: expect.objectContaining({
          name: 'Topic One Renamed'
        })
      })
    )
  })

  it('emits explicit tombstones for deletions and cascades them on apply', () => {
    const topic = {
      id: 'topic-1',
      assistantId: 'default',
      name: 'Topic One',
      createdAt: 1,
      updatedAt: 1
    }
    const message = {
      id: 'message-1',
      assistantId: 'default',
      topicId: 'topic-1',
      role: 'assistant',
      createdAt: 2,
      blocks: []
    }
    const block = {
      id: 'block-1',
      messageId: 'message-1',
      type: 'main_text',
      createdAt: 3,
      status: 'success',
      content: 'hello'
    }

    const baseSnapshot = createSnapshot({
      topics: [topic],
      messages: [message],
      messageBlocks: [block]
    })
    const basePrepared = prepareMobileOnlineSyncState(baseSnapshot, createEmptyMobileOnlineSyncState('desktop-a'))
    const basePublishedState = markMobileOnlineSyncChangesPublished(
      basePrepared.state,
      buildMobileOnlineSyncChanges(basePrepared.snapshot, basePrepared.state)
    )

    const deletedSnapshot = createSnapshot({
      topics: [],
      messages: [],
      messageBlocks: []
    })
    const deletedPrepared = prepareMobileOnlineSyncState(deletedSnapshot, basePublishedState)
    const deleteChanges = buildMobileOnlineSyncChanges(deletedPrepared.snapshot, deletedPrepared.state)
    const topicDelete = deleteChanges.find((change) => change.entityType === 'topic' && change.entityId === 'topic-1')

    expect(topicDelete).toEqual(expect.objectContaining({ op: 'delete' }))

    const applyResult = applyMobileOnlineSyncChanges(basePrepared.snapshot, basePrepared.state, [topicDelete!])
    expect(applyResult.snapshot.topics).toEqual([])
    expect(applyResult.snapshot.messages).toEqual([])
    expect(applyResult.snapshot.messageBlocks).toEqual([])
  })

  it('skips stale incoming upserts when the local replica is newer', () => {
    const initialSnapshot = createSnapshot({
      topics: [
        {
          id: 'topic-1',
          assistantId: 'default',
          name: 'Older Name',
          createdAt: 1,
          updatedAt: 1
        }
      ]
    })

    const localPrepared = prepareMobileOnlineSyncState(initialSnapshot, createEmptyMobileOnlineSyncState('desktop-a'))
    const localUpdated = prepareMobileOnlineSyncState(
      createSnapshot({
        topics: [
          {
            id: 'topic-1',
            assistantId: 'default',
            name: 'Newer Local Name',
            createdAt: 1,
            updatedAt: 2
          }
        ]
      }),
      localPrepared.state
    )

    const remotePrepared = prepareMobileOnlineSyncState(initialSnapshot, createEmptyMobileOnlineSyncState('mobile-b'))
    const remoteChanges = buildMobileOnlineSyncChanges(remotePrepared.snapshot, remotePrepared.state)
    const staleTopicChange = remoteChanges.find(
      (change) => change.entityType === 'topic' && change.entityId === 'topic-1'
    )

    const result = applyMobileOnlineSyncChanges(localUpdated.snapshot, localUpdated.state, [staleTopicChange!])

    expect(result.snapshot.topics[0]?.name).toBe('Newer Local Name')
    expect(result.skippedChanges).toEqual([
      expect.objectContaining({
        reason: 'stale_change'
      })
    ])
  })

  it('treats identical re-delivered changes as duplicates', () => {
    const prepared = prepareMobileOnlineSyncState(
      createSnapshot({
        topics: [
          {
            id: 'topic-1',
            assistantId: 'default',
            name: 'Topic One',
            createdAt: 1,
            updatedAt: 1
          }
        ]
      }),
      createEmptyMobileOnlineSyncState('desktop-a')
    )

    const topicChange = buildMobileOnlineSyncChanges(prepared.snapshot, prepared.state).find(
      (change) => change.entityType === 'topic' && change.entityId === 'topic-1'
    )

    const once = applyMobileOnlineSyncChanges(createSnapshot(), createEmptyMobileOnlineSyncState('mobile-b'), [
      topicChange!
    ])
    const twice = applyMobileOnlineSyncChanges(once.snapshot, once.state, [topicChange!])

    expect(twice.skippedChanges).toEqual([
      expect.objectContaining({
        reason: 'duplicate_change'
      })
    ])
  })
})
