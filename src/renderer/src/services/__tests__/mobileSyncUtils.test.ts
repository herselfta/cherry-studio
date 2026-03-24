import type { Assistant, Topic } from '@renderer/types'
import { AssistantMessageStatus, type Message } from '@renderer/types/newMessage'
import { describe, expect, it } from 'vitest'

import { buildDesktopSyncAssistantState, normalizeDesktopSyncTopics } from '../mobileSyncUtils'

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
        createTopic({ id: 'mobile-orphan-topic', assistantId: 'quick' })
      ],
      [],
      []
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
    expect(result.assistants.find((assistant) => assistant.id === 'quick')).toEqual(
      expect.objectContaining({
        id: 'quick',
        topics: [expect.objectContaining({ id: 'mobile-orphan-topic', assistantId: 'quick' })]
      })
    )
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
})
