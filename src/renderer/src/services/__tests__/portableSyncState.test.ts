import type { Topic } from '@renderer/types'
import {
  AssistantMessageStatus,
  type MainTextMessageBlock,
  type Message,
  type MessageBlock,
  MessageBlockStatus,
  MessageBlockType
} from '@renderer/types/newMessage'
import { describe, expect, it, vi } from 'vitest'

import {
  bootstrapPortableSyncState,
  diagnosePortableSyncVersionDrift,
  PORTABLE_SYNC_STATE_STORAGE_KEY,
  preparePortableSyncState,
  resolvePortableSyncSnapshot,
  toPortableSyncMetadata
} from '../portableSyncState'
import { normalizeDesktopSyncExportTopics } from '../mobileSyncUtils'

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
type TestMessage = Message & { content?: string }

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
    messages: [],
    ...overrides,
    id: overrides.id,
    assistantId: overrides.assistantId,
    name: overrides.name || overrides.id,
    createdAt: overrides.createdAt || '2026-03-29T00:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-03-29T00:00:00.000Z'
  }
}

function createMessage(overrides: Partial<TestMessage> & Pick<Message, 'id' | 'assistantId' | 'topicId'>): TestMessage {
  return {
    role: 'assistant',
    status: AssistantMessageStatus.SUCCESS,
    blocks: [],
    ...overrides,
    id: overrides.id,
    assistantId: overrides.assistantId,
    topicId: overrides.topicId,
    createdAt: overrides.createdAt || '2026-03-29T00:00:00.000Z',
    updatedAt: overrides.updatedAt
  }
}

function createBlock(messageId: string, id = `block:${messageId}`): MainTextMessageBlock {
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

  it('bootstraps missing sync history so remote tombstones still delete tracked topics', () => {
    const sharedTopic = createTopic({ id: 'shared-topic', assistantId: 'default' })

    const localStorage = createMemoryStorage()
    localStorage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'desktop-a')
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
    const localState = bootstrapPortableSyncState(
      {
        topics: [sharedTopic],
        messages: [],
        messageBlocks: []
      },
      toPortableSyncMetadata(remoteDeletionState),
      localStorage
    )

    const result = resolvePortableSyncSnapshot({
      currentTopics: [sharedTopic],
      incomingTopics: [],
      currentMessages: [],
      incomingMessages: [],
      currentMessageBlocks: [],
      incomingMessageBlocks: [],
      localState,
      incomingSync: toPortableSyncMetadata(remoteDeletionState),
      preferIncomingOnEqualVersion: true
    })

    expect(result.topics).toEqual([])
    expect(result.deletedTopicIds).toEqual(['shared-topic'])
  })

  it('prefers incoming tracked topic metadata on version tie during bootstrap recovery', () => {
    const localStorage = createMemoryStorage()
    localStorage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'desktop-a')
    const remoteStorage = createMemoryStorage()
    remoteStorage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'mobile-b')

    const localTopic = createTopic({
      id: 'shared-topic',
      assistantId: 'default',
      name: 'desktop stale title'
    })
    const remoteTopic = createTopic({
      id: 'shared-topic',
      assistantId: 'default',
      name: 'mobile newer title'
    })
    const sharedMessage = createMessage({
      id: 'shared-message',
      assistantId: 'default',
      topicId: 'shared-topic',
      role: 'user'
    })
    const sharedBlock = createBlock(sharedMessage.id)

    const remoteState = preparePortableSyncState(
      {
        topics: [remoteTopic],
        messages: [sharedMessage],
        messageBlocks: [sharedBlock]
      },
      remoteStorage
    )
    const localState = bootstrapPortableSyncState(
      {
        topics: [localTopic],
        messages: [sharedMessage],
        messageBlocks: [sharedBlock]
      },
      toPortableSyncMetadata(remoteState),
      localStorage
    )

    const result = resolvePortableSyncSnapshot({
      currentTopics: [localTopic],
      incomingTopics: [remoteTopic],
      currentMessages: [sharedMessage],
      incomingMessages: [sharedMessage],
      currentMessageBlocks: [sharedBlock],
      incomingMessageBlocks: [sharedBlock],
      localState,
      incomingSync: toPortableSyncMetadata(remoteState),
      preferIncomingOnEqualVersion: true
    })

    expect(result.topics).toEqual([expect.objectContaining({ id: 'shared-topic', name: 'mobile newer title' })])
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
      updatedAt: undefined
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

  it('round-trips app edits for existing topics back into desktop state', () => {
    const desktopStorage = createMemoryStorage()
    desktopStorage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'desktop-a')
    const appStorage = createMemoryStorage()
    appStorage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'mobile-b')

    const sharedTopic = createTopic({ id: 'shared-topic', assistantId: 'default', name: 'desktop original topic' })
    const deletedTopic = createTopic({ id: 'deleted-topic', assistantId: 'default', name: 'delete me' })
    const sharedMessage = createMessage({
      id: 'shared-message',
      assistantId: 'default',
      topicId: sharedTopic.id,
      role: 'user',
      content: 'desktop original content'
    })
    const deletedMessage = createMessage({
      id: 'deleted-message',
      assistantId: 'default',
      topicId: deletedTopic.id,
      role: 'user',
      content: 'to be deleted'
    })
    const sharedBlock = {
      ...createBlock(sharedMessage.id, 'shared-block'),
      content: 'desktop original block'
    } satisfies MessageBlock
    const deletedBlock = {
      ...createBlock(deletedMessage.id, 'deleted-block'),
      content: 'delete block'
    } satisfies MessageBlock
    const initialDesktopSnapshot = {
      topics: [sharedTopic, deletedTopic],
      messages: [sharedMessage, deletedMessage],
      messageBlocks: [sharedBlock, deletedBlock]
    }

    const desktopSeedState = preparePortableSyncState(initialDesktopSnapshot, desktopStorage)
    bootstrapPortableSyncState(initialDesktopSnapshot, toPortableSyncMetadata(desktopSeedState), appStorage)

    const appSharedTopic = createTopic({
      ...sharedTopic,
      name: 'mobile renamed topic',
      updatedAt: '2026-03-29T00:05:00.000Z'
    })
    const appSharedMessage = createMessage({
      ...sharedMessage,
      content: 'mobile updated content',
      updatedAt: '2026-03-29T00:05:00.000Z'
    })
    const appSharedBlock = {
      ...sharedBlock,
      content: 'mobile updated block',
      updatedAt: '2026-03-29T00:05:00.000Z'
    } satisfies MessageBlock
    const appNewTopic = createTopic({
      id: 'mobile-new-topic',
      assistantId: 'default',
      name: 'new on mobile',
      updatedAt: '2026-03-29T00:06:00.000Z'
    })
    const appNewMessage = createMessage({
      id: 'mobile-new-message',
      assistantId: 'default',
      topicId: appNewTopic.id,
      role: 'user',
      content: 'brand new'
    })
    const appNewBlock = {
      ...createBlock(appNewMessage.id, 'mobile-new-block'),
      content: 'brand new block'
    } satisfies MessageBlock
    const appSnapshot = {
      topics: [appSharedTopic, appNewTopic],
      messages: [appSharedMessage, appNewMessage],
      messageBlocks: [appSharedBlock, appNewBlock]
    }
    const appState = preparePortableSyncState(
      appSnapshot,
      appStorage,
      toPortableSyncMetadata(desktopSeedState).frontier
    )

    const desktopLocalState = preparePortableSyncState(
      initialDesktopSnapshot,
      desktopStorage,
      toPortableSyncMetadata(appState).frontier
    )
    const result = resolvePortableSyncSnapshot({
      currentTopics: initialDesktopSnapshot.topics,
      incomingTopics: appSnapshot.topics,
      currentMessages: initialDesktopSnapshot.messages,
      incomingMessages: appSnapshot.messages,
      currentMessageBlocks: initialDesktopSnapshot.messageBlocks,
      incomingMessageBlocks: appSnapshot.messageBlocks,
      localState: desktopLocalState,
      incomingSync: toPortableSyncMetadata(appState)
    })

    expect(result.topics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'shared-topic', name: 'mobile renamed topic' }),
        expect.objectContaining({ id: 'mobile-new-topic', name: 'new on mobile' })
      ])
    )
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'shared-message', content: 'mobile updated content' }),
        expect.objectContaining({ id: 'mobile-new-message', content: 'brand new' })
      ])
    )
    expect(result.messageBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'shared-block', content: 'mobile updated block' }),
        expect.objectContaining({ id: 'mobile-new-block', content: 'brand new block' })
      ])
    )
    expect(result.deletedTopicIds).toContain('deleted-topic')
    expect(result.deletedMessageIds).toContain('deleted-message')
    expect(result.deletedBlockIds).toContain('deleted-block')
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

  it('migrates legacy fingerprint state without inflating tracked versions', () => {
    const storage = createMemoryStorage()
    storage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'desktop-a')

    const snapshot = {
      topics: [createTopic({ id: 'shared-topic', assistantId: 'default', name: 'shared' })],
      messages: [
        createMessage({
          id: 'shared-message',
          assistantId: 'default',
          topicId: 'shared-topic',
          blocks: ['shared-block']
        })
      ],
      messageBlocks: [createBlock('shared-message', 'shared-block')]
    }

    const firstState = preparePortableSyncState(snapshot, storage)
    const legacyState = JSON.parse(storage.getItem(PORTABLE_SYNC_STATE_STORAGE_KEY) || '{}')
    delete legacyState.fingerprintVersion
    legacyState.fingerprints = {
      topics: { 'shared-topic': 'legacy-topic-fingerprint' },
      messages: { 'shared-message': 'legacy-message-fingerprint' },
      blocks: { 'shared-block': 'legacy-block-fingerprint' },
      messageSlots: {}
    }
    storage.setItem(PORTABLE_SYNC_STATE_STORAGE_KEY, JSON.stringify(legacyState))

    const secondState = preparePortableSyncState(snapshot, storage)

    expect(secondState.entityVersions.topics['shared-topic']).toEqual(firstState.entityVersions.topics['shared-topic'])
    expect(secondState.entityVersions.messages['shared-message']).toEqual(
      firstState.entityVersions.messages['shared-message']
    )
    expect(secondState.entityVersions.blocks['shared-block']).toEqual(firstState.entityVersions.blocks['shared-block'])
  })

  it('rebootstraps shared lineage when local versions drift far beyond the incoming frontier', () => {
    const desktopStorage = createMemoryStorage()
    desktopStorage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'desktop-a')
    const appStorage = createMemoryStorage()
    appStorage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'mobile-b')

    const sharedEntries = Array.from({ length: 12 }, (_, index) => {
      const topicId = `shared-topic-${index}`
      const messageId = `shared-message-${index}`
      const blockId = `shared-block-${index}`

      return {
        topic: createTopic({ id: topicId, assistantId: 'default', name: `shared topic ${index}` }),
        message: createMessage({
          id: messageId,
          assistantId: 'default',
          topicId,
          role: 'user',
          content: `shared message ${index}`,
          blocks: [blockId]
        }),
        block: {
          ...createBlock(messageId, blockId),
          content: `shared block ${index}`
        } satisfies MessageBlock
      }
    })

    const deletedTopic = createTopic({ id: 'deleted-topic', assistantId: 'default', name: 'delete me' })
    const deletedMessage = createMessage({
      id: 'deleted-message',
      assistantId: 'default',
      topicId: deletedTopic.id,
      role: 'user',
      content: 'delete message',
      blocks: ['deleted-block']
    })
    const deletedBlock = {
      ...createBlock(deletedMessage.id, 'deleted-block'),
      content: 'delete block'
    } satisfies MessageBlock

    const initialDesktopSnapshot = {
      topics: [...sharedEntries.map((entry) => entry.topic), deletedTopic],
      messages: [...sharedEntries.map((entry) => entry.message), deletedMessage],
      messageBlocks: [...sharedEntries.map((entry) => entry.block), deletedBlock]
    }

    const desktopSeedState = preparePortableSyncState(initialDesktopSnapshot, desktopStorage)
    bootstrapPortableSyncState(initialDesktopSnapshot, toPortableSyncMetadata(desktopSeedState), appStorage)

    const appSnapshot = {
      topics: [
        createTopic({
          ...sharedEntries[0].topic,
          name: 'mobile renamed topic',
          updatedAt: '2026-03-29T00:05:00.000Z'
        }),
        ...sharedEntries.slice(1).map((entry) => entry.topic),
        createTopic({
          id: 'mobile-new-topic',
          assistantId: 'default',
          name: 'brand new on mobile',
          updatedAt: '2026-03-29T00:06:00.000Z'
        })
      ],
      messages: [
        createMessage({
          ...sharedEntries[0].message,
          content: 'mobile updated content',
          updatedAt: '2026-03-29T00:05:00.000Z'
        }),
        ...sharedEntries.slice(1).map((entry) => entry.message),
        createMessage({
          id: 'mobile-new-message',
          assistantId: 'default',
          topicId: 'mobile-new-topic',
          role: 'user',
          content: 'brand new message',
          blocks: ['mobile-new-block']
        })
      ],
      messageBlocks: [
        {
          ...sharedEntries[0].block,
          content: 'mobile updated block',
          updatedAt: '2026-03-29T00:05:00.000Z'
        } satisfies MessageBlock,
        ...sharedEntries.slice(1).map((entry) => entry.block),
        {
          ...createBlock('mobile-new-message', 'mobile-new-block'),
          content: 'brand new block'
        } satisfies MessageBlock
      ]
    }
    const appState = preparePortableSyncState(
      appSnapshot,
      appStorage,
      toPortableSyncMetadata(desktopSeedState).frontier
    )

    const pollutedState = JSON.parse(desktopStorage.getItem(PORTABLE_SYNC_STATE_STORAGE_KEY) || '{}')
    let nextLamport = 500
    pollutedState.lamport = nextLamport
    pollutedState.frontier['desktop-a'] = nextLamport
    for (const topic of initialDesktopSnapshot.topics) {
      pollutedState.entityVersions.topics[topic.id] = { replicaId: 'desktop-a', lamport: nextLamport-- }
    }
    for (const message of initialDesktopSnapshot.messages) {
      pollutedState.entityVersions.messages[message.id] = { replicaId: 'desktop-a', lamport: nextLamport-- }
    }
    for (const block of initialDesktopSnapshot.messageBlocks) {
      pollutedState.entityVersions.blocks[block.id] = { replicaId: 'desktop-a', lamport: nextLamport-- }
    }
    desktopStorage.setItem(PORTABLE_SYNC_STATE_STORAGE_KEY, JSON.stringify(pollutedState))

    const driftedLocalState = preparePortableSyncState(
      initialDesktopSnapshot,
      desktopStorage,
      toPortableSyncMetadata(appState).frontier
    )
    const diagnosis = diagnosePortableSyncVersionDrift({
      currentTopics: initialDesktopSnapshot.topics,
      incomingTopics: appSnapshot.topics,
      currentMessages: initialDesktopSnapshot.messages,
      incomingMessages: appSnapshot.messages,
      currentMessageBlocks: initialDesktopSnapshot.messageBlocks,
      incomingMessageBlocks: appSnapshot.messageBlocks,
      localState: driftedLocalState,
      incomingSync: toPortableSyncMetadata(appState)
    })

    expect(diagnosis.suspected).toBe(true)
    expect(diagnosis.inflatedEntityCount).toBeGreaterThanOrEqual(32)

    const repairedLocalState = bootstrapPortableSyncState(
      initialDesktopSnapshot,
      toPortableSyncMetadata(appState),
      desktopStorage
    )
    const result = resolvePortableSyncSnapshot({
      currentTopics: initialDesktopSnapshot.topics,
      incomingTopics: appSnapshot.topics,
      currentMessages: initialDesktopSnapshot.messages,
      incomingMessages: appSnapshot.messages,
      currentMessageBlocks: initialDesktopSnapshot.messageBlocks,
      incomingMessageBlocks: appSnapshot.messageBlocks,
      localState: repairedLocalState,
      incomingSync: toPortableSyncMetadata(appState),
      preferIncomingOnEqualVersion: true
    })

    expect(result.topics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'shared-topic-0', name: 'mobile renamed topic' }),
        expect.objectContaining({ id: 'mobile-new-topic', name: 'brand new on mobile' })
      ])
    )
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'shared-message-0', content: 'mobile updated content' }),
        expect.objectContaining({ id: 'mobile-new-message', content: 'brand new message' })
      ])
    )
    expect(result.messageBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'shared-block-0', content: 'mobile updated block' }),
        expect.objectContaining({ id: 'mobile-new-block', content: 'brand new block' })
      ])
    )
    expect(result.deletedTopicIds).toContain('deleted-topic')
    expect(result.deletedMessageIds).toContain('deleted-message')
    expect(result.deletedBlockIds).toContain('deleted-block')
  })

  it('detects and repairs shared lineage drift even when the lagging device only tracks a small shared dataset', () => {
    const desktopStorage = createMemoryStorage()
    desktopStorage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'desktop-a')
    const appStorage = createMemoryStorage()
    appStorage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'mobile-b')

    const sharedEntries = Array.from({ length: 3 }, (_, index) => {
      const topicId = `shared-topic-small-${index}`
      const messageId = `shared-message-small-${index}`
      const blockId = `shared-block-small-${index}`

      return {
        topic: createTopic({ id: topicId, assistantId: 'default', name: `shared topic ${index}` }),
        message: createMessage({
          id: messageId,
          assistantId: 'default',
          topicId,
          role: 'user',
          content: `shared message ${index}`,
          blocks: [blockId]
        }),
        block: {
          ...createBlock(messageId, blockId),
          content: `shared block ${index}`
        } satisfies MessageBlock
      }
    })

    const deletedTopic = createTopic({ id: 'deleted-topic-small', assistantId: 'default', name: 'delete me' })
    const deletedMessage = createMessage({
      id: 'deleted-message-small',
      assistantId: 'default',
      topicId: deletedTopic.id,
      role: 'user',
      content: 'delete message',
      blocks: ['deleted-block-small']
    })
    const deletedBlock = {
      ...createBlock(deletedMessage.id, 'deleted-block-small'),
      content: 'delete block'
    } satisfies MessageBlock

    const initialDesktopSnapshot = {
      topics: [...sharedEntries.map((entry) => entry.topic), deletedTopic],
      messages: [...sharedEntries.map((entry) => entry.message), deletedMessage],
      messageBlocks: [...sharedEntries.map((entry) => entry.block), deletedBlock]
    }

    const desktopSeedState = preparePortableSyncState(initialDesktopSnapshot, desktopStorage)
    bootstrapPortableSyncState(initialDesktopSnapshot, toPortableSyncMetadata(desktopSeedState), appStorage)

    const appSnapshot = {
      topics: [
        createTopic({
          ...sharedEntries[0].topic,
          name: 'mobile renamed topic',
          updatedAt: '2026-03-29T00:05:00.000Z'
        }),
        ...sharedEntries.slice(1).map((entry) => entry.topic),
        createTopic({
          id: 'mobile-new-topic-small',
          assistantId: 'default',
          name: 'brand new on mobile',
          updatedAt: '2026-03-29T00:06:00.000Z'
        })
      ],
      messages: [
        createMessage({
          ...sharedEntries[0].message,
          content: 'mobile updated content',
          updatedAt: '2026-03-29T00:05:00.000Z'
        }),
        ...sharedEntries.slice(1).map((entry) => entry.message),
        createMessage({
          id: 'mobile-new-message-small',
          assistantId: 'default',
          topicId: 'mobile-new-topic-small',
          role: 'user',
          content: 'brand new message',
          blocks: ['mobile-new-block-small']
        })
      ],
      messageBlocks: [
        {
          ...sharedEntries[0].block,
          content: 'mobile updated block',
          updatedAt: '2026-03-29T00:05:00.000Z'
        } satisfies MessageBlock,
        ...sharedEntries.slice(1).map((entry) => entry.block),
        {
          ...createBlock('mobile-new-message-small', 'mobile-new-block-small'),
          content: 'brand new block'
        } satisfies MessageBlock
      ]
    }
    const appState = preparePortableSyncState(
      appSnapshot,
      appStorage,
      toPortableSyncMetadata(desktopSeedState).frontier
    )

    const pollutedState = JSON.parse(desktopStorage.getItem(PORTABLE_SYNC_STATE_STORAGE_KEY) || '{}')
    let nextLamport = 120
    pollutedState.lamport = nextLamport
    pollutedState.frontier['desktop-a'] = nextLamport
    for (const topic of initialDesktopSnapshot.topics) {
      pollutedState.entityVersions.topics[topic.id] = { replicaId: 'desktop-a', lamport: nextLamport-- }
    }
    for (const message of initialDesktopSnapshot.messages) {
      pollutedState.entityVersions.messages[message.id] = { replicaId: 'desktop-a', lamport: nextLamport-- }
    }
    for (const block of initialDesktopSnapshot.messageBlocks) {
      pollutedState.entityVersions.blocks[block.id] = { replicaId: 'desktop-a', lamport: nextLamport-- }
    }
    desktopStorage.setItem(PORTABLE_SYNC_STATE_STORAGE_KEY, JSON.stringify(pollutedState))

    const driftedLocalState = preparePortableSyncState(
      initialDesktopSnapshot,
      desktopStorage,
      toPortableSyncMetadata(appState).frontier
    )
    const diagnosis = diagnosePortableSyncVersionDrift({
      currentTopics: initialDesktopSnapshot.topics,
      incomingTopics: appSnapshot.topics,
      currentMessages: initialDesktopSnapshot.messages,
      incomingMessages: appSnapshot.messages,
      currentMessageBlocks: initialDesktopSnapshot.messageBlocks,
      incomingMessageBlocks: appSnapshot.messageBlocks,
      localState: driftedLocalState,
      incomingSync: toPortableSyncMetadata(appState)
    })

    expect(diagnosis.suspected).toBe(true)
    expect(diagnosis.inflatedEntityCount).toBeGreaterThanOrEqual(3)

    const repairedLocalState = bootstrapPortableSyncState(
      initialDesktopSnapshot,
      toPortableSyncMetadata(appState),
      desktopStorage
    )
    const result = resolvePortableSyncSnapshot({
      currentTopics: initialDesktopSnapshot.topics,
      incomingTopics: appSnapshot.topics,
      currentMessages: initialDesktopSnapshot.messages,
      incomingMessages: appSnapshot.messages,
      currentMessageBlocks: initialDesktopSnapshot.messageBlocks,
      incomingMessageBlocks: appSnapshot.messageBlocks,
      localState: repairedLocalState,
      incomingSync: toPortableSyncMetadata(appState),
      preferIncomingOnEqualVersion: true
    })

    expect(result.topics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'shared-topic-small-0', name: 'mobile renamed topic' }),
        expect.objectContaining({ id: 'mobile-new-topic-small', name: 'brand new on mobile' })
      ])
    )
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'shared-message-small-0', content: 'mobile updated content' }),
        expect.objectContaining({ id: 'mobile-new-message-small', content: 'brand new message' })
      ])
    )
    expect(result.messageBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'shared-block-small-0', content: 'mobile updated block' }),
        expect.objectContaining({ id: 'mobile-new-block-small', content: 'brand new block' })
      ])
    )
    expect(result.deletedTopicIds).toContain('deleted-topic-small')
    expect(result.deletedMessageIds).toContain('deleted-message-small')
    expect(result.deletedBlockIds).toContain('deleted-block-small')
  })

  it('treats an emptied topic as deleted once the portable export subset no longer includes it', () => {
    const storage = createMemoryStorage()
    storage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'desktop-a')

    const assistant = {
      id: 'default',
      name: 'Default',
      prompt: '',
      type: 'assistant',
      topics: []
    }
    const topic = createTopic({ id: 'shared-topic', assistantId: 'default' })
    const message = createMessage({
      id: 'shared-message',
      assistantId: 'default',
      topicId: topic.id,
      role: 'user',
      content: 'hello',
      blocks: ['shared-block']
    })
    const block = {
      ...createBlock(message.id, 'shared-block'),
      content: 'hello'
    } satisfies MessageBlock

    const firstExportTopics = normalizeDesktopSyncExportTopics({
      assistants: [assistant],
      topics: [topic],
      messages: [message]
    })
    const firstState = preparePortableSyncState(
      {
        topics: firstExportTopics,
        messages: [message],
        messageBlocks: [block]
      },
      storage
    )

    const secondExportTopics = normalizeDesktopSyncExportTopics({
      assistants: [assistant],
      topics: [topic],
      messages: []
    })
    expect(secondExportTopics).toEqual([])

    const secondState = preparePortableSyncState(
      {
        topics: secondExportTopics,
        messages: [],
        messageBlocks: []
      },
      storage
    )

    expect(firstState.entityVersions.topics['shared-topic']).toBeDefined()
    expect(secondState.entityVersions.topics['shared-topic']).toBeUndefined()
    expect(secondState.tombstones.topics['shared-topic']).toBeDefined()
    expect(secondState.tombstones.messages['shared-message']).toBeDefined()
    expect(secondState.tombstones.blocks['shared-block']).toBeDefined()
  })

  it('ignores platform-specific fields when computing portable sync fingerprints', () => {
    const storage = createMemoryStorage()
    storage.setItem(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'desktop-a')

    const richTopic = createTopic({
      id: 'shared-topic',
      assistantId: 'default',
      pinned: true,
      prompt: 'desktop-only prompt',
      isNameManuallyEdited: true
    } as Topic)
    const portableTopic = createTopic({
      id: 'shared-topic',
      assistantId: 'default'
    })

    const richMessage = createMessage({
      id: 'shared-message',
      assistantId: 'default',
      topicId: 'shared-topic',
      blocks: ['shared-block'],
      modelId: 'gpt-5',
      model: { id: 'gpt-5', provider: 'openai', name: 'GPT-5', group: 'default' } as Message['model'],
      usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
      metrics: { completion_tokens: 1, time_completion_millsec: 10 },
      providerMetadata: { provider: { trace: 'desktop-only' } },
      traceId: 'trace-desktop-only',
      agentSessionId: 'agent-desktop-only'
    })
    const portableMessage = createMessage({
      id: 'shared-message',
      assistantId: 'default',
      topicId: 'shared-topic',
      blocks: ['shared-block'],
      modelId: 'gpt-5'
    })

    const richBlock = {
      id: 'shared-block',
      messageId: 'shared-message',
      type: MessageBlockType.IMAGE,
      status: MessageBlockStatus.SUCCESS,
      createdAt: '2026-03-29T00:00:00.000Z',
      updatedAt: '2026-03-29T01:00:00.000Z',
      url: 'data:image/png;base64,desktop-only',
      file: {
        id: 'file-1',
        name: 'image.png',
        origin_name: 'image.png',
        path: '/desktop/private/path/image.png',
        size: 123,
        ext: '.png',
        type: 'image',
        created_at: '2026-03-29T00:00:00.000Z',
        count: 1
      }
    } as MessageBlock
    const portableBlock = {
      id: 'shared-block',
      messageId: 'shared-message',
      type: MessageBlockType.IMAGE,
      status: MessageBlockStatus.SUCCESS,
      createdAt: '2026-03-29T00:00:00.000Z',
      updatedAt: '2026-03-29T01:00:00.000Z',
      file: {
        id: 'file-1',
        name: 'image.png',
        origin_name: 'image.png',
        path: '/mobile/different/path/image.png',
        size: 123,
        ext: '.png',
        type: 'image',
        created_at: '2026-03-29T00:00:00.000Z',
        count: 1
      }
    } as MessageBlock

    const firstState = preparePortableSyncState(
      {
        topics: [richTopic],
        messages: [richMessage],
        messageBlocks: [richBlock]
      },
      storage
    )
    const secondState = preparePortableSyncState(
      {
        topics: [portableTopic],
        messages: [portableMessage],
        messageBlocks: [portableBlock]
      },
      storage
    )

    expect(secondState.entityVersions.topics['shared-topic']).toEqual(firstState.entityVersions.topics['shared-topic'])
    expect(secondState.entityVersions.messages['shared-message']).toEqual(
      firstState.entityVersions.messages['shared-message']
    )
    expect(secondState.entityVersions.blocks['shared-block']).toEqual(firstState.entityVersions.blocks['shared-block'])
  })
})
