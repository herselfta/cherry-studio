import type { Assistant, Topic } from '@renderer/types'
import type { Message, MessageBlock } from '@renderer/types/newMessage'

type AssistantLike = Pick<Assistant, 'id' | 'name' | 'prompt' | 'type' | 'topics'> & Partial<Assistant>

type BuildDesktopSyncAssistantStateParams = {
  currentDefaultAssistant: Assistant
  currentAssistants: Assistant[]
  incomingDefaultAssistant: AssistantLike
  incomingAssistants: AssistantLike[]
  normalizedTopics: Topic[]
}

type NormalizeDesktopSyncTopicsResult = {
  synthesizedTopicCount: number
  topics: Topic[]
}

type FilterSyncMessageBlocksResult = {
  droppedBlockCount: number
  messageBlocks: MessageBlock[]
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const merged = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) {
    merged.set(item.id, { ...merged.get(item.id), ...item })
  }
  return Array.from(merged.values())
}

function sanitizeTopic(topic: Topic): Topic {
  return {
    ...topic,
    messages: []
  }
}

function groupTopicsByAssistantId(topics: Topic[]) {
  return topics.reduce<Map<string, Topic[]>>((result, topic) => {
    const existing = result.get(topic.assistantId) || []
    result.set(topic.assistantId, mergeById(existing, [sanitizeTopic(topic)]))
    return result
  }, new Map())
}

function synthesizeTopicFromMessages(topicId: string, messages: Message[]): Topic {
  const sortedMessages = [...messages].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  )
  const firstMessage = sortedMessages[0]
  const lastMessage = sortedMessages.at(-1) || firstMessage

  return {
    id: topicId,
    assistantId: firstMessage?.assistantId || 'default',
    name: topicId,
    createdAt: firstMessage?.createdAt || new Date().toISOString(),
    updatedAt: lastMessage?.updatedAt || lastMessage?.createdAt || new Date().toISOString(),
    messages: []
  }
}

function createFallbackAssistant(assistantId: string, topics: Topic[]): Assistant {
  return {
    id: assistantId,
    name: assistantId,
    prompt: '',
    type: 'assistant',
    topics
  }
}

export function normalizeDesktopSyncTopics(
  topLevelTopics: Topic[],
  embeddedAssistantTopics: Topic[],
  messages: Message[],
  visibleAssistantIds?: Set<string>
): NormalizeDesktopSyncTopicsResult {
  // Mobile sync persists conversation content in two places:
  // 1. top-level topics/messages/messageBlocks
  // 2. assistant.embedded topics metadata
  //
  // The top-level topic table is the only reliable source of truth because assistant topic
  // arrays can go stale on one device. Keep both for backward compatibility, but always let
  // the top-level topic list win and synthesize any still-missing topics from message data.
  const normalizedTopics = new Map<string, Topic>()

  for (const topic of embeddedAssistantTopics) {
    normalizedTopics.set(topic.id, sanitizeTopic(topic))
  }

  for (const topic of topLevelTopics) {
    normalizedTopics.set(topic.id, sanitizeTopic(topic))
  }

  const messagesByTopicId = messages.reduce<Map<string, Message[]>>((result, message) => {
    const existing = result.get(message.topicId) || []
    result.set(message.topicId, [...existing, message])
    return result
  }, new Map())

  for (const [topicId, topic] of normalizedTopics.entries()) {
    if (!visibleAssistantIds || visibleAssistantIds.has(topic.assistantId)) {
      continue
    }

    const inferredAssistantId = messagesByTopicId
      .get(topicId)
      ?.map((message) => message.assistantId)
      .find((assistantId) => visibleAssistantIds.has(assistantId))

    if (!inferredAssistantId) {
      continue
    }

    normalizedTopics.set(topicId, {
      ...topic,
      assistantId: inferredAssistantId
    })
  }

  let synthesizedTopicCount = 0
  for (const [topicId, topicMessages] of messagesByTopicId.entries()) {
    if (normalizedTopics.has(topicId)) {
      continue
    }
    normalizedTopics.set(topicId, synthesizeTopicFromMessages(topicId, topicMessages))
    synthesizedTopicCount += 1
  }

  return {
    synthesizedTopicCount,
    topics: Array.from(normalizedTopics.values())
  }
}

export function filterDesktopSyncMessageBlocks(
  messageBlocks: MessageBlock[],
  messages: Message[]
): FilterSyncMessageBlocksResult {
  const messageIds = new Set(messages.map((message) => message.id))
  const filtered = messageBlocks.filter((block) => messageIds.has(block.messageId))

  return {
    droppedBlockCount: messageBlocks.length - filtered.length,
    messageBlocks: filtered
  }
}

export function buildDesktopSyncAssistantState({
  currentDefaultAssistant,
  currentAssistants,
  incomingDefaultAssistant,
  incomingAssistants,
  normalizedTopics
}: BuildDesktopSyncAssistantStateParams) {
  // Desktop UI indexes topics from Redux assistant.topic arrays, while Dexie only stores
  // `{ id, messages }` for each topic. Rebuild assistant topic ownership from the normalized
  // top-level topic list during import, otherwise mobile-created topics can be written into
  // Dexie successfully but still remain invisible in the sidebar.
  const topicsByAssistantId = groupTopicsByAssistantId(normalizedTopics)
  const incomingAssistantMap = new Map<string, AssistantLike>(
    [...incomingAssistants, incomingDefaultAssistant].map((assistant) => [assistant.id, assistant])
  )

  const allAssistantIds = new Set<string>([
    currentDefaultAssistant.id,
    incomingDefaultAssistant.id,
    ...currentAssistants.map((assistant) => assistant.id),
    ...incomingAssistants.map((assistant) => assistant.id)
  ])

  const defaultAssistant = {
    ...currentDefaultAssistant,
    ...incomingDefaultAssistant,
    topics: mergeById(
      mergeById(currentDefaultAssistant.topics || [], incomingDefaultAssistant.topics || []),
      topicsByAssistantId.get('default') || []
    )
  }

  const assistants = Array.from(allAssistantIds).map((assistantId) => {
    const currentAssistant = currentAssistants.find((assistant) => assistant.id === assistantId)
    const incomingAssistant = incomingAssistantMap.get(assistantId)
    const fallbackAssistant =
      assistantId === currentDefaultAssistant.id || assistantId === incomingDefaultAssistant.id
        ? currentDefaultAssistant
        : createFallbackAssistant(assistantId, [])
    const baseAssistant = {
      ...fallbackAssistant,
      ...currentAssistant,
      ...incomingAssistant
    }

    return {
      ...baseAssistant,
      topics: mergeById(
        mergeById(currentAssistant?.topics || [], incomingAssistant?.topics || []),
        topicsByAssistantId.get(assistantId) || []
      )
    } satisfies Assistant
  })

  return {
    assistants,
    defaultAssistant
  }
}
