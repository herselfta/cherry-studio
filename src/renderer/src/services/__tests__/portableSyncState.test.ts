import type { Topic } from '@renderer/types'
import { AssistantMessageStatus, type Message, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { describe, expect, it, vi } from 'vitest'

import { preparePortableSyncState, resolvePortableSyncSnapshot, toPortableSyncMetadata } from '../portableSyncState'

vi.mock('../mobileSyncLedger', () => ({
  MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY: 'mobile_sync_source_device_id',
  getOrCreateMobileSyncSourceDeviceId: (storage: Storage = localStorage) => {
    const key = 'mobile_sync_source_device_id'
    const existing = storage.getItem(key)
    if (existing) {
      return existing
    }

    storage.setItem(key, 'test-device-id')
    return 'test-device-id'
  }
}))

const MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY = 'mobile_sync_source_device_id'

function createMemoryStorage(): Storage {
  const state = new Map<string, string>()

  return {
    get length() {
      return state.size
    },
    clear() {
      state.clear()
    },
    getItem(key: string) {
      return state.get(key) ?? null
    },
    key(index: number) {
      return Array.from(state.keys())[index] ?? null
    },
    removeItem(key: string) {
      state.delete(key)
    },
    setItem(key: string, value: string) {
      state.set(key, value)
    }
  }
}

function createTopic(overrides: Partial<Topic> & Pick<Topic, 'id' | 'assistantId'>): Topic {
  return {
    id: overrides.id,
    assistantId: overrides.assistantId,
    name: overrides.name || overrides.id,
    createdAt: overrides.createdAt || '2026-03-29T00:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-03-29T00:00:00.000Z',
    messages: [],
    ...overrides
  }
}

function createMessage(overrides: Partial<Message> & Pick<Message, 'id' | 'assistantId' | 'topicId'>): Message {
  return {
    id: overrides.id,
    assistantId: overrides.assistantId,
    topicId: overrides.topicId,
    role: 'assistant',
    createdAt: overrides.createdAt || '2026-03-29T00:00:00.000Z',
    updatedAt: overrides.updatedAt,
    status: AssistantMessageStatus.SUCCESS,
    blocks: [],
    ...overrides
  }
}

function createBlock(messageId: string, id = `block:${messageId}`) {
  return {
    id,
    messageId,
    type: MessageBlockType.MAIN_TEXT,
    status: MessageBlockStatus.SUCCESS,
    content: 'content',
    createdAt: '2026-03-29T00:00:00.000Z'
  }
}

describe('portableSyncState', () => {
  it('preserves local-only topics when the incoming snapshot simply has not seen them', () => {
    const localStorage = createMemoryStorage()
    localStorage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'desktop-a')

    const localTopic = createTopic({ id: 'local-only-topic', assistantId: 'default' })
    const localState = preparePortableSyncState(
      {
        topics: [localTopic],
        messages: [],
        messageBlocks: []
      },
      localStorage
    )

    const remoteStorage = createMemoryStorage()
    remoteStorage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'mobile-b')
    const remoteState = preparePortableSyncState(
      {
        topics: [],
        messages: [],
        messageBlocks: []
      },
      remoteStorage
    )

    const result = resolvePortableSyncSnapshot({
      currentTopics: [localTopic],
      incomingTopics: [],
      currentMessages: [],
      incomingMessages: [],
      currentMessageBlocks: [],
      incomingMessageBlocks: [],
      localState,
      incomingSync: toPortableSyncMetadata(remoteState)
    })

    expect(result.topics.map((topic) => topic.id)).toEqual(['local-only-topic'])
    expect(result.deletedTopicIds).toEqual([])
  })

  it('applies remote tombstones when the remote replica explicitly deleted a topic', () => {
    const sharedTopic = createTopic({ id: 'shared-topic', assistantId: 'default' })

    const localStorage = createMemoryStorage()
    localStorage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'desktop-a')
    const localState = preparePortableSyncState(
      {
        topics: [sharedTopic],
        messages: [],
        messageBlocks: []
      },
      localStorage
    )

    const remoteStorage = createMemoryStorage()
    remoteStorage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'mobile-b')
    preparePortableSyncState(
      {
        topics: [sharedTopic],
        messages: [],
        messageBlocks: []
      },
      remoteStorage
    )
    const remoteDeletionState = preparePortableSyncState(
      {
        topics: [],
        messages: [],
        messageBlocks: []
      },
      remoteStorage
    )

    const result = resolvePortableSyncSnapshot({
      currentTopics: [sharedTopic],
      incomingTopics: [],
      currentMessages: [],
      incomingMessages: [],
      currentMessageBlocks: [],
      incomingMessageBlocks: [],
      localState,
      incomingSync: toPortableSyncMetadata(remoteDeletionState)
    })

    expect(result.topics).toEqual([])
    expect(result.deletedTopicIds).toEqual(['shared-topic'])
  })

  it('suppresses stale assistant responses when a newer slot winner exists on another replica', () => {
    const localStorage = createMemoryStorage()
    localStorage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'desktop-a')
    const remoteStorage = createMemoryStorage()
    remoteStorage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'mobile-b')

    const topic = createTopic({ id: 'topic-1', assistantId: 'default' })
    const userMessage = createMessage({
      id: 'user-1',
      assistantId: 'default',
      topicId: topic.id,
      role: 'user'
    })
    const oldAssistantMessage = createMessage({
      id: 'assistant-old',
      assistantId: 'default',
      topicId: topic.id,
      askId: 'user-1',
      foldSelected: true,
      createdAt: '2026-03-29T00:01:00.000Z'
    })
    const newAssistantMessage = createMessage({
      id: 'assistant-new',
      assistantId: 'default',
      topicId: topic.id,
      askId: 'user-1',
      foldSelected: true,
      createdAt: '2026-03-29T00:02:00.000Z'
    })

    const localState = preparePortableSyncState(
      {
        topics: [topic],
        messages: [userMessage, oldAssistantMessage],
        messageBlocks: [createBlock(userMessage.id), createBlock(oldAssistantMessage.id)]
      },
      localStorage
    )

    preparePortableSyncState(
      {
        topics: [topic],
        messages: [userMessage, oldAssistantMessage],
        messageBlocks: [createBlock(userMessage.id), createBlock(oldAssistantMessage.id)]
      },
      remoteStorage
    )
    const remoteState = preparePortableSyncState(
      {
        topics: [topic],
        messages: [userMessage, newAssistantMessage],
        messageBlocks: [createBlock(userMessage.id), createBlock(newAssistantMessage.id)]
      },
      remoteStorage
    )

    const result = resolvePortableSyncSnapshot({
      currentTopics: [topic],
      incomingTopics: [topic],
      currentMessages: [userMessage, oldAssistantMessage],
      incomingMessages: [userMessage, newAssistantMessage],
      currentMessageBlocks: [createBlock(userMessage.id), createBlock(oldAssistantMessage.id)],
      incomingMessageBlocks: [createBlock(userMessage.id), createBlock(newAssistantMessage.id)],
      localState,
      incomingSync: toPortableSyncMetadata(remoteState)
    })

    expect(result.messages.map((message) => message.id).sort()).toEqual(['assistant-new', 'user-1'])
    expect(result.deletedMessageIds).toContain('assistant-old')
  })
})
