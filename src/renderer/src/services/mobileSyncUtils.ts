import type { Assistant, Topic } from '@renderer/types'
import { type Message, type MessageBlock, MessageBlockType } from '@renderer/types/newMessage'

import type { MobileSyncLedgerEntry } from './mobileSyncLedger'

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

type NormalizeDesktopSyncExportTopicsParams = {
  assistants: Assistant[]
  topics: Topic[]
  messages: Message[]
}

type FilterSyncMessageBlocksResult = {
  droppedBlockCount: number
  messageBlocks: MessageBlock[]
}

type ResolveDesktopConversationSyncParams = {
  currentTopics: Topic[]
  incomingTopics: Topic[]
  currentMessages: Message[]
  incomingMessages: Message[]
  currentMessageBlocks: MessageBlock[]
  incomingMessageBlocks: MessageBlock[]
  exportedAt: number
  previousLedgerEntry?: MobileSyncLedgerEntry
  treatIncomingAsFullSnapshot?: boolean
}

type ResolveDesktopConversationSyncResult = {
  topics: Topic[]
  messages: Message[]
  messageBlocks: MessageBlock[]
  deletedTopicIds: string[]
  deletedMessageIds: string[]
  deletedBlockIds: string[]
  isStaleImport: boolean
  nextLedgerEntry?: MobileSyncLedgerEntry
}

export type PortableSyncImageAsset = {
  fileId: string
  data: string
  ext?: string
  name?: string
  origin_name?: string
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

function toTimestamp(value: string | number | undefined): number {
  if (typeof value === 'number') {
    return value
  }

  return value ? new Date(value).getTime() : 0
}

function getEntityTimestamp(entity: { createdAt: string | number; updatedAt?: string | number }) {
  return toTimestamp(entity.updatedAt ?? entity.createdAt)
}

function pickNewerEntity<T extends { createdAt: string | number; updatedAt?: string | number }>(
  current: T | undefined,
  incoming: T
): T {
  if (!current) {
    return incoming
  }

  return getEntityTimestamp(incoming) >= getEntityTimestamp(current) ? incoming : current
}

function groupTopicsByAssistantId(topics: Topic[]) {
  return topics.reduce<Map<string, Topic[]>>((result, topic) => {
    const existing = result.get(topic.assistantId) || []
    result.set(topic.assistantId, mergeById(existing, [sanitizeTopic(topic)]))
    return result
  }, new Map())
}

function getPortableConversationGroupKey(message: Message) {
  return message.role === 'assistant' && message.askId ? `assistant:${message.askId}` : `message:${message.id}`
}

function getPortableAssistantModelKey(message: Message) {
  return message.modelId || message.model?.id || message.assistantId
}

function shouldResolvePortableAssistantGroup(messages: Message[]) {
  if (messages.length <= 1) {
    return false
  }

  const hasFoldSelectionState = messages.some((message) => typeof message.foldSelected === 'boolean')
  if (hasFoldSelectionState) {
    return true
  }

  return new Set(messages.map(getPortableAssistantModelKey)).size <= 1
}

function resolveVisibleAssistantId(
  topic: Pick<Topic, 'assistantId' | 'createdAt' | 'updatedAt'> | undefined,
  messages: Message[],
  visibleAssistantIds: Set<string>
) {
  const visibleMessages = messages.filter((message) => visibleAssistantIds.has(message.assistantId))
  const visibleTopicAssistantId =
    topic?.assistantId && visibleAssistantIds.has(topic.assistantId) ? topic.assistantId : undefined
  const latestVisibleMessage = [...visibleMessages].sort(
    (left, right) => getEntityTimestamp(right) - getEntityTimestamp(left)
  )[0]
  const visibleMessageAssistantIds = Array.from(new Set(visibleMessages.map((message) => message.assistantId)))

  if (!visibleTopicAssistantId) {
    return latestVisibleMessage?.assistantId
  }

  if (visibleMessageAssistantIds.length === 0) {
    return visibleTopicAssistantId
  }

  if (visibleMessageAssistantIds.includes(visibleTopicAssistantId)) {
    return visibleTopicAssistantId
  }

  const topicTimestamp = topic ? getEntityTimestamp(topic) : 0
  const latestMessageTimestamp = latestVisibleMessage ? getEntityTimestamp(latestVisibleMessage) : 0

  if (topicTimestamp > latestMessageTimestamp) {
    return visibleTopicAssistantId
  }

  if (visibleMessageAssistantIds.length === 1) {
    return visibleMessageAssistantIds[0]
  }

  return latestVisibleMessage?.assistantId || visibleTopicAssistantId
}

function selectPortableAssistantMessages(messages: Message[]) {
  if (messages.length <= 1) {
    return messages
  }

  if (!shouldResolvePortableAssistantGroup(messages)) {
    return messages
  }

  const selectedMessage =
    messages.find((message) => message.foldSelected) ||
    [...messages].sort((left, right) => getEntityTimestamp(right) - getEntityTimestamp(left))[0]

  return selectedMessage ? [selectedMessage] : messages
}

function synthesizeTopicFromMessages(topicId: string, messages: Message[], assistantId?: string): Topic {
  const sortedMessages = [...messages].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  )
  const firstMessage = sortedMessages[0]
  const lastMessage = sortedMessages.at(-1) || firstMessage

  return {
    id: topicId,
    assistantId: assistantId || firstMessage?.assistantId || 'default',
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

export function normalizeDesktopSyncExportTopics({
  assistants,
  topics,
  messages
}: NormalizeDesktopSyncExportTopicsParams): Topic[] {
  const visibleAssistantIds = new Set(assistants.map((assistant) => assistant.id))
  const topicCandidatesById = topics.reduce<Map<string, Topic[]>>((result, topic) => {
    const existing = result.get(topic.id) || []
    result.set(topic.id, [...existing, topic])
    return result
  }, new Map())
  const messagesByTopicId = messages.reduce<Map<string, Message[]>>((result, message) => {
    const existing = result.get(message.topicId) || []
    result.set(message.topicId, [...existing, message])
    return result
  }, new Map())
  const normalizedTopics = new Map<string, Topic>()

  for (const [topicId, topicMessages] of messagesByTopicId.entries()) {
    const topicCandidates = topicCandidatesById.get(topicId) || []
    const visibleMessageAssistantIds = new Set(
      topicMessages.map((message) => message.assistantId).filter((assistantId) => visibleAssistantIds.has(assistantId))
    )
    const candidateMatchingMessageStream = topicCandidates
      .filter((topic) => visibleMessageAssistantIds.has(topic.assistantId))
      .sort((left, right) => getEntityTimestamp(right) - getEntityTimestamp(left))[0]
    const newestCandidate = [...topicCandidates].sort(
      (left, right) => getEntityTimestamp(right) - getEntityTimestamp(left)
    )[0]
    const referenceCandidate = candidateMatchingMessageStream || newestCandidate
    const assistantId = resolveVisibleAssistantId(referenceCandidate, topicMessages, visibleAssistantIds)
    if (!assistantId) {
      continue
    }

    const matchedCandidate = topicCandidates
      .filter((topic) => topic.assistantId === assistantId)
      .sort((left, right) => getEntityTimestamp(right) - getEntityTimestamp(left))[0]
    const visibleCandidate = topicCandidates
      .filter((topic) => visibleAssistantIds.has(topic.assistantId))
      .sort((left, right) => getEntityTimestamp(right) - getEntityTimestamp(left))[0]
    const canonicalCandidate = matchedCandidate || referenceCandidate || visibleCandidate

    if (canonicalCandidate) {
      normalizedTopics.set(topicId, sanitizeTopic({ ...canonicalCandidate, assistantId }))
      continue
    }

    normalizedTopics.set(topicId, synthesizeTopicFromMessages(topicId, topicMessages, assistantId))
  }

  return Array.from(normalizedTopics.values())
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
    topics: Array.from(normalizedTopics.values()).filter((topic) => (messagesByTopicId.get(topic.id) || []).length > 0)
  }
}

export function normalizePortableConversationMessages(messages: Message[]): Message[] {
  const groupedMessages = new Map<string, Message[]>()
  const groupOrder: string[] = []
  const sortedMessages = [...messages].sort((left, right) => getEntityTimestamp(left) - getEntityTimestamp(right))

  for (const message of sortedMessages) {
    const groupKey = getPortableConversationGroupKey(message)
    if (!groupedMessages.has(groupKey)) {
      groupedMessages.set(groupKey, [])
      groupOrder.push(groupKey)
    }

    groupedMessages.get(groupKey)!.push(message)
  }

  return groupOrder.flatMap((groupKey) => {
    const groupMessages = groupedMessages.get(groupKey) || []
    return groupKey.startsWith('assistant:') ? selectPortableAssistantMessages(groupMessages) : groupMessages
  })
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

export function applyPortableSyncImageAssets(
  messageBlocks: MessageBlock[],
  portableImageAssets: PortableSyncImageAsset[]
) {
  if (portableImageAssets.length === 0) {
    return messageBlocks
  }

  const portableImageAssetMap = new Map(portableImageAssets.map((asset) => [asset.fileId, asset]))

  return messageBlocks.map((block) => {
    if (block.type !== MessageBlockType.IMAGE || !block.file?.id) {
      return block
    }

    const portableImageAsset = portableImageAssetMap.get(block.file.id)
    if (!portableImageAsset) {
      return block
    }

    return {
      ...block,
      url: portableImageAsset.data
    }
  })
}

export function buildDesktopSyncAssistantState({
  currentDefaultAssistant,
  currentAssistants,
  incomingDefaultAssistant,
  incomingAssistants,
  normalizedTopics,
  replaceTopics = false
}: BuildDesktopSyncAssistantStateParams & { replaceTopics?: boolean }) {
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
    ...incomingAssistants.map((assistant) => assistant.id),
    ...Array.from(topicsByAssistantId.keys())
  ])

  const defaultAssistant = {
    ...currentDefaultAssistant,
    ...incomingDefaultAssistant,
    topics: replaceTopics
      ? topicsByAssistantId.get('default') || []
      : mergeById(
          mergeById(currentDefaultAssistant.topics || [], incomingDefaultAssistant.topics || []),
          topicsByAssistantId.get('default') || []
        )
  }

  const assistants = Array.from(allAssistantIds).map((assistantId) => {
    if (assistantId === defaultAssistant.id) {
      // Keep the default assistant mirrored inside `assistants[]` for legacy Redux/UI selectors
      // that still read topics exclusively from that list during the v2 migration window.
      return defaultAssistant
    }

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
      topics: replaceTopics
        ? topicsByAssistantId.get(assistantId) || []
        : mergeById(
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

export function resolveDesktopConversationSync({
  currentTopics,
  incomingTopics,
  currentMessages,
  incomingMessages,
  currentMessageBlocks,
  incomingMessageBlocks,
  exportedAt,
  previousLedgerEntry,
  treatIncomingAsFullSnapshot = false
}: ResolveDesktopConversationSyncParams): ResolveDesktopConversationSyncResult {
  const incomingTopicIds = new Set(incomingTopics.map((topic) => topic.id))
  const incomingMessageIds = new Set(incomingMessages.map((message) => message.id))
  const incomingBlockIds = new Set(incomingMessageBlocks.map((block) => block.id))
  const isStaleImport = Boolean(previousLedgerEntry && exportedAt <= previousLedgerEntry.lastImportedExportedAt)

  if (treatIncomingAsFullSnapshot && !isStaleImport) {
    const topicMap = new Map<string, Topic>(incomingTopics.map((topic) => [topic.id, topic]))
    const messageMap = new Map<string, Message>()

    for (const message of incomingMessages) {
      if (topicMap.has(message.topicId)) {
        messageMap.set(message.id, message)
      }
    }

    const topicIdsWithMessages = new Set(Array.from(messageMap.values()).map((message) => message.topicId))
    const prunedEmptyTopicIds = Array.from(topicMap.keys()).filter((topicId) => !topicIdsWithMessages.has(topicId))
    for (const topicId of prunedEmptyTopicIds) {
      topicMap.delete(topicId)
    }

    const finalTopicIds = new Set(topicMap.keys())
    const deletedTopicIds = Array.from(
      new Set([
        ...currentTopics.filter((topic) => !finalTopicIds.has(topic.id)).map((topic) => topic.id),
        ...prunedEmptyTopicIds
      ])
    )

    const finalMessageIds = new Set(messageMap.keys())
    const deletedMessageIds = Array.from(
      new Set(
        currentMessages
          .filter((message) => !finalMessageIds.has(message.id) || !finalTopicIds.has(message.topicId))
          .map((message) => message.id)
      )
    )

    const blockMap = new Map<string, MessageBlock>()
    for (const block of incomingMessageBlocks) {
      if (finalMessageIds.has(block.messageId)) {
        blockMap.set(block.id, block)
      }
    }

    const finalBlockIds = new Set(blockMap.keys())
    const deletedBlockIds = Array.from(
      new Set(
        currentMessageBlocks
          .filter((block) => !finalBlockIds.has(block.id) || !finalMessageIds.has(block.messageId))
          .map((block) => block.id)
      )
    )

    return {
      topics: Array.from(topicMap.values()),
      messages: Array.from(messageMap.values()),
      messageBlocks: Array.from(blockMap.values()),
      deletedTopicIds,
      deletedMessageIds,
      deletedBlockIds,
      isStaleImport: false,
      nextLedgerEntry: {
        lastImportedExportedAt: exportedAt,
        topicIds: Array.from(finalTopicIds),
        messageIds: Array.from(finalMessageIds),
        blockIds: Array.from(finalBlockIds)
      }
    }
  }

  const ledgerDeletedTopicIds = isStaleImport
    ? []
    : (previousLedgerEntry?.topicIds || []).filter((topicId) => !incomingTopicIds.has(topicId))
  const deletedTopicIdSet = new Set(ledgerDeletedTopicIds)

  const directDeletedMessageIds = isStaleImport
    ? []
    : (previousLedgerEntry?.messageIds || []).filter((messageId) => !incomingMessageIds.has(messageId))
  const topicCascadeMessageIds = currentMessages
    .filter((message) => deletedTopicIdSet.has(message.topicId))
    .map((message) => message.id)
  const deletedMessageIds = Array.from(new Set([...directDeletedMessageIds, ...topicCascadeMessageIds]))
  const deletedMessageIdSet = new Set(deletedMessageIds)

  const topicMap = new Map<string, Topic>()
  for (const topic of currentTopics) {
    if (!deletedTopicIdSet.has(topic.id)) {
      topicMap.set(topic.id, topic)
    }
  }
  for (const topic of incomingTopics) {
    // Portable sync treats top-level incoming topics as the canonical source of topic metadata.
    // Always let imported title / assistant ownership override the local copy for the same topic id.
    topicMap.set(topic.id, topic)
  }

  const finalTopicIds = new Set(topicMap.keys())
  const messageMap = new Map<string, Message>()
  for (const message of currentMessages) {
    if (!deletedMessageIdSet.has(message.id) && finalTopicIds.has(message.topicId)) {
      messageMap.set(message.id, message)
    }
  }
  for (const message of incomingMessages) {
    if (finalTopicIds.has(message.topicId)) {
      messageMap.set(message.id, pickNewerEntity(messageMap.get(message.id), message))
    }
  }

  const topicIdsWithMessages = new Set(Array.from(messageMap.values()).map((message) => message.topicId))
  const prunedEmptyTopicIds = Array.from(topicMap.keys()).filter((topicId) => !topicIdsWithMessages.has(topicId))
  for (const topicId of prunedEmptyTopicIds) {
    topicMap.delete(topicId)
  }

  const deletedTopicIds = Array.from(new Set([...ledgerDeletedTopicIds, ...prunedEmptyTopicIds]))

  const finalMessageIds = new Set(messageMap.keys())
  const directDeletedBlockIds = isStaleImport
    ? []
    : (previousLedgerEntry?.blockIds || []).filter((blockId) => !incomingBlockIds.has(blockId))
  const messageCascadeBlockIds = currentMessageBlocks
    .filter((block) => deletedMessageIdSet.has(block.messageId) || !finalMessageIds.has(block.messageId))
    .map((block) => block.id)
  const deletedBlockIds = Array.from(new Set([...directDeletedBlockIds, ...messageCascadeBlockIds]))
  const deletedBlockIdSet = new Set(deletedBlockIds)

  const blockMap = new Map<string, MessageBlock>()
  for (const block of currentMessageBlocks) {
    if (!deletedBlockIdSet.has(block.id) && finalMessageIds.has(block.messageId)) {
      blockMap.set(block.id, block)
    }
  }
  for (const block of incomingMessageBlocks) {
    if (finalMessageIds.has(block.messageId)) {
      blockMap.set(block.id, pickNewerEntity(blockMap.get(block.id), block))
    }
  }

  return {
    topics: Array.from(topicMap.values()),
    messages: Array.from(messageMap.values()),
    messageBlocks: Array.from(blockMap.values()),
    deletedTopicIds,
    deletedMessageIds,
    deletedBlockIds,
    isStaleImport,
    nextLedgerEntry: isStaleImport
      ? previousLedgerEntry
      : {
          lastImportedExportedAt: exportedAt,
          topicIds: Array.from(incomingTopicIds),
          messageIds: Array.from(incomingMessageIds),
          blockIds: Array.from(incomingBlockIds)
        }
  }
}
