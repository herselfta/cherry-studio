import type { Topic } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import { compareTopics, sortTopics } from '../topicSort'

function createTopic(overrides: Partial<Topic> & Pick<Topic, 'id' | 'assistantId'>): Topic {
  return {
    name: overrides.name || overrides.id,
    createdAt: overrides.createdAt || '2026-03-20T00:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-03-20T00:00:00.000Z',
    messages: [],
    ...overrides,
    id: overrides.id,
    assistantId: overrides.assistantId
  }
}

describe('topicSort', () => {
  it('sorts topics by updated time descending with deterministic fallback', () => {
    const topics = [
      createTopic({
        id: 'older',
        assistantId: 'default',
        updatedAt: '2026-03-20T00:00:00.000Z'
      }),
      createTopic({
        id: 'newer',
        assistantId: 'default',
        updatedAt: '2026-03-21T00:00:00.000Z'
      })
    ]

    expect(sortTopics(topics, { sortMode: 'updatedAt' }).map((topic) => topic.id)).toEqual(['newer', 'older'])
  })

  it('keeps manual order within pinned and unpinned groups', () => {
    const topics = [
      createTopic({ id: 'unpinned-a', assistantId: 'default' }),
      createTopic({ id: 'pinned-a', assistantId: 'default', pinned: true }),
      createTopic({ id: 'unpinned-b', assistantId: 'default' }),
      createTopic({ id: 'pinned-b', assistantId: 'default', pinned: true })
    ]

    expect(sortTopics(topics, { sortMode: 'manual', pinTopicsToTop: true }).map((topic) => topic.id)).toEqual([
      'pinned-a',
      'pinned-b',
      'unpinned-a',
      'unpinned-b'
    ])
  })

  it('falls back to created time and name when target timestamps are tied', () => {
    const left = createTopic({
      id: 'beta',
      assistantId: 'default',
      updatedAt: '2026-03-21T00:00:00.000Z',
      createdAt: '2026-03-20T00:00:00.000Z',
      name: 'Beta'
    })
    const right = createTopic({
      id: 'alpha',
      assistantId: 'default',
      updatedAt: '2026-03-21T00:00:00.000Z',
      createdAt: '2026-03-20T00:00:00.000Z',
      name: 'Alpha'
    })

    expect(compareTopics(left, right, 'updatedAt')).toBeGreaterThan(0)
  })
})
