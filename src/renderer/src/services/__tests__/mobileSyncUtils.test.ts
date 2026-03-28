import type { Assistant, Topic } from '@renderer/types'
import {
  AssistantMessageStatus,
  type Message,
  type MessageBlock,
  MessageBlockStatus,
  MessageBlockType
} from '@renderer/types/newMessage'
import { describe, expect, it } from 'vitest'

import {
  applyPortableSyncImageAssets,
  buildDesktopSyncAssistantState,
  normalizeDesktopSyncTopics,
  normalizePortableConversationMessages,
  resolveDesktopConversationSync
} from '../mobileSyncUtils'

function createTopic(overrides: Partial<Topic> & Pick<Topic, 'id' | 'assistantId'>): Topic {
  return {
    name: overrides.name || overrides.id,
    createdAt: overrides.createdAt || '2026-03-24T00:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-03-24T00:00:00.000Z',
    messages: [],
    ...overrides,
    id: overrides.id,
    assistantId: overrides.assistantId
  }
}

function createAssistant(overrides: Partial<Assistant> & Pick<Assistant, 'id' | 'name'>): Assistant {
  return {
    prompt: '',
    type: 'assistant',
    topics: [],
    ...overrides,
    id: overrides.id,
    name: overrides.name
  }
}

function createMessage(overrides: Partial<Message> & Pick<Message, 'id' | 'assistantId' | 'topicId'>): Message {
  return {
    role: 'assistant',
    createdAt: overrides.createdAt || '2026-03-24T00:00:00.000Z',
    updatedAt: overrides.updatedAt,
    status: AssistantMessageStatus.SUCCESS,
    blocks: [],
    ...overrides,
    id: overrides.id,
    assistantId: overrides.assistantId,
    topicId: overrides.topicId
  }
}

function createImageBlock(overrides: Partial<MessageBlock> & Pick<MessageBlock, 'id' | 'messageId'>): MessageBlock {
  return {
    type: MessageBlockType.IMAGE,
    createdAt: '2026-03-24T00:00:00.000Z',
    status: MessageBlockStatus.SUCCESS,
    file: {
      id: 'image-file-1',
      name: 'image-file-1',
      origin_name: 'image-file-1.png',
      path: '/tmp/image-file-1.png',
      ext: '.png',
      type: 'image',
      size: 1,
      created_at: '2026-03-24T00:00:00.000Z',
      count: 1
    },
    ...overrides,
    id: overrides.id,
    messageId: overrides.messageId
  } as MessageBlock
}

describe('mobileSyncUtils', () => {
  it('treats top-level topics as the source of truth when rebuilding desktop assistant state', () => {
    const currentDefaultAssistant = createAssistant({
      id: 'default',
      name: 'Default',
      topics: [createTopic({ id: 'desktop-default-topic', assistantId: 'default' })]
    })
    const currentAssistants = [
      createAssistant({
        id: 'external-1',
        name: 'External One',
        avatar: 'image://desktop-avatar',
        topics: [createTopic({ id: 'desktop-external-topic', assistantId: 'external-1' })]
      })
    ]

    const { topics: normalizedTopics } = normalizeDesktopSyncTopics(
      [
        createTopic({ id: 'mobile-default-topic', assistantId: 'default' }),
        createTopic({ id: 'mobile-external-topic', assistantId: 'external-1' }),
        createTopic({ id: 'mobile-external-topic-2', assistantId: 'quick' })
      ],
      [],
      [
        createMessage({
          id: 'message-default-1',
          assistantId: 'default',
          topicId: 'mobile-default-topic'
        }),
        createMessage({
          id: 'message-external-1',
          assistantId: 'external-1',
          topicId: 'mobile-external-topic'
        }),
        createMessage({
          id: 'message-quick-1',
          assistantId: 'external-1',
          topicId: 'mobile-external-topic-2'
        })
      ],
      new Set(['default', 'external-1'])
    )

    const result = buildDesktopSyncAssistantState({
      currentDefaultAssistant,
      currentAssistants,
      incomingDefaultAssistant: createAssistant({
        id: 'default',
        name: 'Imported Default',
        topics: []
      }),
      incomingAssistants: [
        createAssistant({
          id: 'external-1',
          name: 'Imported External',
          avatar: 'image://mobile-avatar',
          topics: []
        })
      ],
      normalizedTopics
    })

    expect(result.defaultAssistant.topics.map((topic) => topic.id)).toEqual(
      expect.arrayContaining(['desktop-default-topic', 'mobile-default-topic'])
    )
    expect(
      result.assistants.find((assistant) => assistant.id === 'external-1')?.topics.map((topic) => topic.id)
    ).toEqual(expect.arrayContaining(['desktop-external-topic', 'mobile-external-topic']))
    expect(result.assistants.find((assistant) => assistant.id === 'external-1')).toEqual(
      expect.objectContaining({
        name: 'Imported External',
        avatar: 'image://mobile-avatar'
      })
    )
    expect(
      result.assistants.find((assistant) => assistant.id === 'external-1')?.topics.map((topic) => topic.id)
    ).toEqual(expect.arrayContaining(['mobile-external-topic-2']))
    expect(result.assistants.find((assistant) => assistant.id === 'quick')).toBeUndefined()
  })

  it('synthesizes missing topics from message ownership so mobile imports do not silently lose them', () => {
    const messages = [
      createMessage({
        id: 'message-1',
        assistantId: 'external-1',
        topicId: 'missing-topic',
        createdAt: '2026-03-24T00:00:00.000Z'
      }),
      createMessage({
        id: 'message-2',
        assistantId: 'external-1',
        topicId: 'missing-topic',
        createdAt: '2026-03-24T00:01:00.000Z',
        updatedAt: '2026-03-24T00:02:00.000Z'
      })
    ]

    const result = normalizeDesktopSyncTopics([], [], messages)

    expect(result.synthesizedTopicCount).toBe(1)
    expect(result.topics).toEqual([
      expect.objectContaining({
        id: 'missing-topic',
        assistantId: 'external-1',
        createdAt: '2026-03-24T00:00:00.000Z',
        updatedAt: '2026-03-24T00:02:00.000Z'
      })
    ])
  })

  it('drops empty topics from portable sync normalization', () => {
    const result = normalizeDesktopSyncTopics([createTopic({ id: 'empty-topic', assistantId: 'default' })], [], [])

    expect(result.topics).toEqual([])
  })

  it('keeps the mirrored default assistant entry in sync with the imported default avatar', () => {
    const currentDefaultAssistant = createAssistant({
      id: 'default',
      name: 'Desktop Default',
      avatar: 'image://desktop-default-avatar',
      topics: [createTopic({ id: 'desktop-default-topic', assistantId: 'default' })]
    })

    const result = buildDesktopSyncAssistantState({
      currentDefaultAssistant,
      currentAssistants: [currentDefaultAssistant],
      incomingDefaultAssistant: createAssistant({
        id: 'default',
        name: 'Mobile Default',
        avatar: 'data:image/png;base64,mobile-default-avatar',
        topics: [createTopic({ id: 'mobile-default-topic', assistantId: 'default' })]
      }),
      incomingAssistants: [],
      normalizedTopics: [
        createTopic({ id: 'desktop-default-topic', assistantId: 'default' }),
        createTopic({ id: 'mobile-default-topic', assistantId: 'default' })
      ]
    })

    expect(result.defaultAssistant).toEqual(
      expect.objectContaining({
        name: 'Mobile Default',
        avatar: 'data:image/png;base64,mobile-default-avatar'
      })
    )
    expect(result.assistants.find((assistant) => assistant.id === 'default')).toEqual(
      expect.objectContaining({
        name: 'Mobile Default',
        avatar: 'data:image/png;base64,mobile-default-avatar'
      })
    )
  })

  it('preserves per-assistant runtime model fields from the imported mobile payload', () => {
    const runtimeModel = {
      id: 'mobile-runtime-model',
      provider: 'openrouter',
      name: 'Mobile Runtime Model',
      group: 'chat'
    }
    const assistantDefaultModel = {
      id: 'mobile-assistant-default-model',
      provider: 'anthropic',
      name: 'Mobile Assistant Default Model',
      group: 'assistant-default'
    }
    const mobileDefaultAssistantModel = {
      id: 'mobile-default-assistant-model',
      provider: 'openai',
      name: 'Mobile Default Assistant Model',
      group: 'default'
    }

    const result = buildDesktopSyncAssistantState({
      currentDefaultAssistant: createAssistant({
        id: 'default',
        name: 'Desktop Default',
        topics: []
      }),
      currentAssistants: [
        createAssistant({
          id: 'external-1',
          name: 'Desktop External',
          topics: []
        })
      ],
      incomingDefaultAssistant: createAssistant({
        id: 'default',
        name: 'Mobile Default',
        model: mobileDefaultAssistantModel,
        defaultModel: mobileDefaultAssistantModel,
        topics: []
      }),
      incomingAssistants: [
        createAssistant({
          id: 'external-1',
          name: 'Imported External',
          model: runtimeModel,
          defaultModel: assistantDefaultModel,
          topics: []
        })
      ],
      normalizedTopics: []
    })

    expect(result.defaultAssistant).toEqual(
      expect.objectContaining({
        model: mobileDefaultAssistantModel,
        defaultModel: mobileDefaultAssistantModel
      })
    )
    expect(result.assistants.find((assistant) => assistant.id === 'external-1')).toEqual(
      expect.objectContaining({
        model: runtimeModel,
        defaultModel: assistantDefaultModel
      })
    )
  })

  it('injects portable mobile image assets into imported image blocks', () => {
    const result = applyPortableSyncImageAssets(
      [
        createImageBlock({
          id: 'block-1',
          messageId: 'message-1'
        })
      ],
      [
        {
          fileId: 'image-file-1',
          data: 'data:image/png;base64,desktop-mobile-image'
        }
      ]
    )

    expect(result[0]).toEqual(
      expect.objectContaining({
        url: 'data:image/png;base64,desktop-mobile-image'
      })
    )
  })

  it('prunes empty ghost topics during desktop reconciliation', () => {
    const result = resolveDesktopConversationSync({
      currentTopics: [
        createTopic({ id: 'empty-local-topic', assistantId: 'default' }),
        createTopic({ id: 'shared-topic', assistantId: 'default' })
      ],
      incomingTopics: [createTopic({ id: 'shared-topic', assistantId: 'default' })],
      currentMessages: [createMessage({ id: 'shared-message', assistantId: 'default', topicId: 'shared-topic' })],
      incomingMessages: [createMessage({ id: 'shared-message', assistantId: 'default', topicId: 'shared-topic' })],
      currentMessageBlocks: [],
      incomingMessageBlocks: [],
      exportedAt: 20,
      previousLedgerEntry: {
        lastImportedExportedAt: 10,
        topicIds: ['shared-topic'],
        messageIds: ['shared-message'],
        blockIds: []
      }
    })

    expect(result.deletedTopicIds).toEqual(['empty-local-topic'])
    expect(result.topics.map((topic) => topic.id)).toEqual(['shared-topic'])
  })

  it('collapses fold-selected assistant alternatives into a single portable snapshot response', () => {
    const userMessage = createMessage({
      id: 'user-message',
      assistantId: 'default',
      topicId: 'topic-1',
      role: 'user',
      createdAt: '2026-03-24T00:00:10.000Z'
    })
    const oldAssistantMessage = createMessage({
      id: 'assistant-old',
      assistantId: 'default',
      topicId: 'topic-1',
      askId: 'user-message',
      createdAt: '2026-03-24T00:00:20.000Z',
      foldSelected: false
    })
    const selectedAssistantMessage = createMessage({
      id: 'assistant-selected',
      assistantId: 'default',
      topicId: 'topic-1',
      askId: 'user-message',
      createdAt: '2026-03-24T00:00:30.000Z',
      foldSelected: true
    })

    expect(
      normalizePortableConversationMessages([userMessage, oldAssistantMessage, selectedAssistantMessage]).map(
        (message) => message.id
      )
    ).toEqual(['user-message', 'assistant-selected'])
  })

  it('keeps multi-model assistant responses when no fold selection state exists', () => {
    const userMessage = createMessage({
      id: 'user-message',
      assistantId: 'default',
      topicId: 'topic-1',
      role: 'user',
      createdAt: '2026-03-24T00:00:10.000Z'
    })
    const assistantA = createMessage({
      id: 'assistant-a',
      assistantId: 'default',
      topicId: 'topic-1',
      askId: 'user-message',
      createdAt: '2026-03-24T00:00:20.000Z'
    })
    const assistantB = createMessage({
      id: 'assistant-b',
      assistantId: 'default',
      topicId: 'topic-1',
      askId: 'user-message',
      createdAt: '2026-03-24T00:00:30.000Z'
    })

    expect(
      normalizePortableConversationMessages([userMessage, assistantA, assistantB]).map((message) => message.id)
    ).toEqual(['user-message', 'assistant-a', 'assistant-b'])
  })

  it('keeps local-only conversations while deleting entities previously seen from the same source device', () => {
    const result = resolveDesktopConversationSync({
      currentTopics: [
        createTopic({ id: 'local-topic', assistantId: 'default' }),
        createTopic({ id: 'shared-topic', assistantId: 'default' }),
        createTopic({ id: 'removed-topic', assistantId: 'default' })
      ],
      incomingTopics: [
        createTopic({ id: 'shared-topic', assistantId: 'default', updatedAt: '2026-03-24T00:05:00.000Z' })
      ],
      currentMessages: [
        createMessage({ id: 'local-message', assistantId: 'default', topicId: 'local-topic' }),
        createMessage({ id: 'shared-message', assistantId: 'default', topicId: 'shared-topic' }),
        createMessage({ id: 'removed-message', assistantId: 'default', topicId: 'removed-topic' })
      ],
      incomingMessages: [
        createMessage({
          id: 'shared-message',
          assistantId: 'default',
          topicId: 'shared-topic',
          updatedAt: '2026-03-24T00:06:00.000Z'
        })
      ],
      currentMessageBlocks: [
        createImageBlock({ id: 'local-block', messageId: 'local-message' }),
        createImageBlock({ id: 'shared-block', messageId: 'shared-message' }),
        createImageBlock({ id: 'removed-block', messageId: 'removed-message' })
      ],
      incomingMessageBlocks: [createImageBlock({ id: 'shared-block', messageId: 'shared-message' })],
      exportedAt: 20,
      previousLedgerEntry: {
        lastImportedExportedAt: 10,
        topicIds: ['shared-topic', 'removed-topic'],
        messageIds: ['shared-message', 'removed-message'],
        blockIds: ['shared-block', 'removed-block']
      }
    })

    expect(result.deletedTopicIds).toEqual(['removed-topic'])
    expect(result.deletedMessageIds).toEqual(['removed-message'])
    expect(result.deletedBlockIds).toEqual(['removed-block'])
    expect(result.topics.map((topic) => topic.id)).toEqual(expect.arrayContaining(['local-topic', 'shared-topic']))
    expect(result.topics.map((topic) => topic.id)).not.toContain('removed-topic')
    expect(result.messages.map((message) => message.id)).toEqual(
      expect.arrayContaining(['local-message', 'shared-message'])
    )
    expect(result.nextLedgerEntry).toEqual(
      expect.objectContaining({
        lastImportedExportedAt: 20,
        topicIds: ['shared-topic'],
        messageIds: ['shared-message'],
        blockIds: ['shared-block']
      })
    )
  })

  it('downgrades stale imports to non-destructive merge mode', () => {
    const result = resolveDesktopConversationSync({
      currentTopics: [
        createTopic({ id: 'local-topic', assistantId: 'default' }),
        createTopic({ id: 'previously-synced-topic', assistantId: 'default' })
      ],
      incomingTopics: [createTopic({ id: 'local-topic', assistantId: 'default' })],
      currentMessages: [
        createMessage({ id: 'local-message', assistantId: 'default', topicId: 'local-topic' }),
        createMessage({ id: 'previously-synced-message', assistantId: 'default', topicId: 'previously-synced-topic' })
      ],
      incomingMessages: [createMessage({ id: 'local-message', assistantId: 'default', topicId: 'local-topic' })],
      currentMessageBlocks: [
        createImageBlock({ id: 'previously-synced-block', messageId: 'previously-synced-message' })
      ],
      incomingMessageBlocks: [],
      exportedAt: 5,
      previousLedgerEntry: {
        lastImportedExportedAt: 10,
        topicIds: ['previously-synced-topic'],
        messageIds: ['previously-synced-message'],
        blockIds: ['previously-synced-block']
      }
    })

    expect(result.isStaleImport).toBe(true)
    expect(result.deletedTopicIds).toEqual([])
    expect(result.deletedMessageIds).toEqual([])
    expect(result.deletedBlockIds).toEqual([])
    expect(result.topics.map((topic) => topic.id)).toEqual(
      expect.arrayContaining(['local-topic', 'previously-synced-topic'])
    )
  })

  it('rebuilds assistant topic indexes from final topics when replacement mode is enabled', () => {
    const currentAssistants = [
      createAssistant({
        id: 'assistant-a',
        name: 'Assistant A',
        topics: [createTopic({ id: 'moved-topic', assistantId: 'assistant-a' })]
      }),
      createAssistant({
        id: 'assistant-b',
        name: 'Assistant B',
        topics: []
      })
    ]

    const result = buildDesktopSyncAssistantState({
      currentDefaultAssistant: createAssistant({ id: 'default', name: 'Default', topics: [] }),
      currentAssistants,
      incomingDefaultAssistant: createAssistant({ id: 'default', name: 'Default', topics: [] }),
      incomingAssistants: currentAssistants,
      normalizedTopics: [createTopic({ id: 'moved-topic', assistantId: 'assistant-b' })],
      replaceTopics: true
    })

    expect(result.assistants.find((assistant) => assistant.id === 'assistant-a')?.topics).toEqual([])
    expect(result.assistants.find((assistant) => assistant.id === 'assistant-b')?.topics).toEqual([
      expect.objectContaining({ id: 'moved-topic' })
    ])
  })
})
