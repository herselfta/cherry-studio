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

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as T
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).flatMap(([key, childValue]) =>
        childValue === undefined ? [] : [[key, stripUndefinedDeep(childValue)]]
      )
    ) as T
  }

  return value
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

  it('ignores topic versions that no longer have a normalized incoming topic entity', () => {
    const remoteStorage = createMemoryStorage()
    remoteStorage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'mobile-b')

    const remoteTopic = createTopic({ id: 'filtered-topic', assistantId: 'default' })
    const remoteState = preparePortableSyncState(
      {
        topics: [remoteTopic],
        messages: [],
        messageBlocks: []
      },
      remoteStorage
    )

    const result = resolvePortableSyncSnapshot({
      currentTopics: [],
      incomingTopics: [],
      currentMessages: [],
      incomingMessages: [],
      currentMessageBlocks: [],
      incomingMessageBlocks: [],
      localState: preparePortableSyncState(
        {
          topics: [],
          messages: [],
          messageBlocks: []
        },
        createMemoryStorage()
      ),
      incomingSync: toPortableSyncMetadata(remoteState)
    })

    expect(result.topics).toEqual([])
    expect(result.deletedTopicIds).toEqual([])
  })

  it('drops remotely tracked empty ghost topics but keeps local-only empty topics', () => {
    const localStorage = createMemoryStorage()
    localStorage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'desktop-a')
    const remoteStorage = createMemoryStorage()
    remoteStorage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'mobile-b')

    const sharedTopic = createTopic({ id: 'shared-topic', assistantId: 'default', name: 'shared topic' })
    const locallyRetitledSharedTopic = createTopic({
      id: 'shared-topic',
      assistantId: 'default',
      name: 'locally retitled topic',
      updatedAt: '2026-03-29T00:03:00.000Z'
    })
    const localOnlyTopic = createTopic({ id: 'local-only-topic', assistantId: 'default', name: 'local empty topic' })
    const sharedMessage = createMessage({
      id: 'shared-message',
      assistantId: 'default',
      topicId: 'shared-topic',
      role: 'user'
    })
    const sharedBlock = createBlock(sharedMessage.id)

    preparePortableSyncState(
      {
        topics: [sharedTopic],
        messages: [sharedMessage],
        messageBlocks: [sharedBlock]
      },
      localStorage
    )

    preparePortableSyncState(
      {
        topics: [sharedTopic],
        messages: [sharedMessage],
        messageBlocks: [sharedBlock]
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

    const localState = preparePortableSyncState(
      {
        topics: [locallyRetitledSharedTopic, localOnlyTopic],
        messages: [sharedMessage],
        messageBlocks: [sharedBlock]
      },
      localStorage,
      toPortableSyncMetadata(remoteDeletionState).frontier
    )

    const result = resolvePortableSyncSnapshot({
      currentTopics: [locallyRetitledSharedTopic, localOnlyTopic],
      incomingTopics: [],
      currentMessages: [sharedMessage],
      incomingMessages: [],
      currentMessageBlocks: [sharedBlock],
      incomingMessageBlocks: [],
      localState,
      incomingSync: toPortableSyncMetadata(remoteDeletionState)
    })

    expect(result.topics).toEqual([expect.objectContaining({ id: 'local-only-topic' })])
    expect(result.deletedTopicIds).toContain('shared-topic')
    expect(result.deletedTopicIds).not.toContain('local-only-topic')
    expect(result.deletedMessageIds).toContain('shared-message')
    expect(result.deletedBlockIds).toContain(sharedBlock.id)
  })

  it('keeps newer local message and block content when an older incoming payload replays the same ids', () => {
    const localStorage = createMemoryStorage()
    localStorage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'desktop-a')
    const remoteStorage = createMemoryStorage()
    remoteStorage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'mobile-b')

    const topic = createTopic({ id: 'shared-topic', assistantId: 'default' })
    const originalMessage = createMessage({
      id: 'shared-message',
      assistantId: 'default',
      topicId: topic.id,
      content: 'original content'
    })
    const originalBlock = {
      ...createBlock(originalMessage.id, 'shared-block'),
      content: 'original block'
    }
    const updatedLocalMessage = createMessage({
      ...originalMessage,
      content: 'desktop newer content',
      updatedAt: '2026-03-29T00:03:00.000Z'
    })
    const updatedLocalBlock = {
      ...originalBlock,
      content: 'desktop newer block',
      updatedAt: '2026-03-29T00:03:00.000Z'
    } satisfies MessageBlock

    preparePortableSyncState(
      {
        topics: [topic],
        messages: [originalMessage],
        messageBlocks: [originalBlock]
      },
      localStorage
    )

    preparePortableSyncState(
      {
        topics: [topic],
        messages: [originalMessage],
        messageBlocks: [originalBlock]
      },
      remoteStorage
    )

    const localState = preparePortableSyncState(
      {
        topics: [topic],
        messages: [updatedLocalMessage],
        messageBlocks: [updatedLocalBlock]
      },
      localStorage
    )
    const incomingSync = toPortableSyncMetadata(
      preparePortableSyncState(
        {
          topics: [topic],
          messages: [originalMessage],
          messageBlocks: [originalBlock]
        },
        remoteStorage
      )
    )

    const result = resolvePortableSyncSnapshot({
      currentTopics: [topic],
      incomingTopics: [topic],
      currentMessages: [updatedLocalMessage],
      incomingMessages: [originalMessage],
      currentMessageBlocks: [updatedLocalBlock],
      incomingMessageBlocks: [originalBlock],
      localState,
      incomingSync
    })

    expect(result.messages).toEqual([
      expect.objectContaining({ id: 'shared-message', content: 'desktop newer content' })
    ])
    expect(result.messageBlocks).toEqual([
      expect.objectContaining({ id: 'shared-block', content: 'desktop newer block' })
    ])
    expect(result.deletedMessageIds).toEqual([])
    expect(result.deletedBlockIds).toEqual([])
  })

  it('treats omitted optional fields as the same fingerprint when merging newer remote edits', () => {
    const localStorage = createMemoryStorage()
    localStorage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'desktop-a')
    const remoteStorage = createMemoryStorage()
    remoteStorage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'mobile-b')

    const baseTopic = createTopic({ id: 'shared-topic', assistantId: 'default' })
    const baseMessage = {
      ...createMessage({
        id: 'shared-message',
        assistantId: 'default',
        topicId: baseTopic.id,
        content: 'original content'
      }),
      modelId: undefined,
      mentions: undefined
    } satisfies Message
    const baseBlock = {
      ...createBlock(baseMessage.id, 'shared-block'),
      content: 'original block',
      updatedAt: undefined,
      file: undefined
    } satisfies MessageBlock

    preparePortableSyncState(
      {
        topics: [baseTopic],
        messages: [baseMessage],
        messageBlocks: [baseBlock]
      },
      localStorage
    )

    preparePortableSyncState(
      {
        topics: [stripUndefinedDeep(baseTopic)],
        messages: [stripUndefinedDeep(baseMessage)],
        messageBlocks: [stripUndefinedDeep(baseBlock)]
      },
      remoteStorage
    )

    const remoteTopic = createTopic({
      ...stripUndefinedDeep(baseTopic),
      name: 'mobile renamed topic',
      updatedAt: '2026-03-29T00:03:00.000Z'
    })
    const remoteMessage = createMessage({
      ...stripUndefinedDeep(baseMessage),
      content: 'mobile newer content',
      updatedAt: '2026-03-29T00:03:00.000Z'
    })
    const remoteBlock = {
      ...stripUndefinedDeep(baseBlock),
      content: 'mobile newer block',
      updatedAt: '2026-03-29T00:03:00.000Z'
    } satisfies MessageBlock
    const remoteState = preparePortableSyncState(
      {
        topics: [remoteTopic],
        messages: [remoteMessage],
        messageBlocks: [remoteBlock]
      },
      remoteStorage
    )

    const currentLocalTopic = stripUndefinedDeep(baseTopic)
    const currentLocalMessage = stripUndefinedDeep(baseMessage)
    const currentLocalBlock = stripUndefinedDeep(baseBlock)
    const localState = preparePortableSyncState(
      {
        topics: [currentLocalTopic],
        messages: [currentLocalMessage],
        messageBlocks: [currentLocalBlock]
      },
      localStorage,
      toPortableSyncMetadata(remoteState).frontier
    )

    const result = resolvePortableSyncSnapshot({
      currentTopics: [currentLocalTopic],
      incomingTopics: [remoteTopic],
      currentMessages: [currentLocalMessage],
      incomingMessages: [remoteMessage],
      currentMessageBlocks: [currentLocalBlock],
      incomingMessageBlocks: [remoteBlock],
      localState,
      incomingSync: toPortableSyncMetadata(remoteState)
    })

    expect(result.topics).toEqual([expect.objectContaining({ id: 'shared-topic', name: 'mobile renamed topic' })])
    expect(result.messages).toEqual([
      expect.objectContaining({ id: 'shared-message', content: 'mobile newer content' })
    ])
    expect(result.messageBlocks).toEqual([
      expect.objectContaining({ id: 'shared-block', content: 'mobile newer block' })
    ])
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

  it('suppresses same-model assistant retries even without explicit fold selection metadata', () => {
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
      modelId: 'same-model',
      createdAt: '2026-03-29T00:01:00.000Z'
    })
    const newAssistantMessage = createMessage({
      id: 'assistant-new',
      assistantId: 'default',
      topicId: topic.id,
      askId: 'user-1',
      modelId: 'same-model',
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
