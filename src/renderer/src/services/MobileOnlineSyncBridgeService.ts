import { loggerService } from '@logger'
import db from '@renderer/databases'
import { buildDesktopSyncAssistantState } from '@renderer/services/mobileSyncUtils'
import store, { persistor } from '@renderer/store'
import { updateAssistants,updateDefaultAssistant } from '@renderer/store/assistants'
import { newMessagesActions } from '@renderer/store/newMessage'
import { setAvatar } from '@renderer/store/runtime'
import { setUserName } from '@renderer/store/settings'
import { loadTopicMessagesThunk } from '@renderer/store/thunk/messageThunk'
import type { Assistant, Topic } from '@renderer/types'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import {
  MOBILE_ONLINE_SYNC_PROFILE_ID,
  type MobileOnlineSyncAssistant,
  type MobileOnlineSyncMessage,
  type MobileOnlineSyncMessageBlock,
  type MobileOnlineSyncSnapshot,
  type MobileOnlineSyncTopic
} from '@shared/mobileSync/onlineSync'

const logger = loggerService.withContext('MobileOnlineSyncBridge')

type TopicRecord = {
  id: string
  messages?: Message[]
}

type SettingsRecord = {
  id: string
  value: string
}

export const MOBILE_ONLINE_SYNC_BRIDGE_KEY = '__CHERRY_MOBILE_ONLINE_SYNC_BRIDGE__'

function toTimestamp(value: string | number | undefined): number {
  if (typeof value === 'number') {
    return value
  }

  return value ? new Date(value).getTime() : 0
}

function toIsoString(value: string | number | undefined): string {
  return new Date(toTimestamp(value) || Date.now()).toISOString()
}

function sortMessages(messages: Message[]) {
  return [...messages].sort((left, right) => toTimestamp(left.createdAt) - toTimestamp(right.createdAt))
}

function collectTopicMetadata() {
  const assistantsState = store.getState().assistants

  return [
    ...assistantsState.defaultAssistant.topics,
    ...assistantsState.assistants.flatMap((assistant) => assistant.topics)
  ]
}

function collectAllAssistants(): Assistant[] {
  const assistantsState = store.getState().assistants
  const assistants = [assistantsState.defaultAssistant, ...assistantsState.assistants]
  const assistantMap = new Map<string, Assistant>()

  for (const assistant of assistants) {
    if (!assistant?.id) {
      continue
    }

    const previousAssistant = assistantMap.get(assistant.id)
    assistantMap.set(assistant.id, {
      ...previousAssistant,
      ...assistant
    })
  }

  return Array.from(assistantMap.values())
}

function sanitizeAssistantForOnlineSync(assistant: Assistant): MobileOnlineSyncAssistant {
  return {
    id: assistant.id,
    name: assistant.name,
    prompt: assistant.prompt,
    type: assistant.type,
    emoji: assistant.emoji,
    avatar: assistant.avatar,
    description: assistant.description,
    model: assistant.model,
    defaultModel: assistant.defaultModel,
    settings: assistant.settings,
    enableWebSearch: assistant.enableWebSearch,
    webSearchProviderId: assistant.webSearchProviderId,
    enableUrlContext: assistant.enableUrlContext,
    enableGenerateImage: assistant.enableGenerateImage,
    knowledgeRecognition: assistant.knowledgeRecognition,
    tags: assistant.tags,
    mcpMode: assistant.mcpMode,
    mcpServers: assistant.mcpServers,
    topics: []
  }
}

function toSyncTopic(topic: Topic): MobileOnlineSyncTopic {
  const { messages, ...rest } = topic as Topic & { messages?: unknown }
  void messages
  return {
    ...rest,
    createdAt: toTimestamp(topic.createdAt),
    updatedAt: toTimestamp(topic.updatedAt)
  }
}

function toSyncMessage(message: Message): MobileOnlineSyncMessage {
  return {
    ...message,
    createdAt: toTimestamp(message.createdAt),
    updatedAt: message.updatedAt ? toTimestamp(message.updatedAt) : undefined
  }
}

function toSyncMessageBlock(block: MessageBlock): MobileOnlineSyncMessageBlock {
  return {
    ...block,
    createdAt: toTimestamp(block.createdAt),
    updatedAt: block.updatedAt ? toTimestamp(block.updatedAt) : undefined
  } as MobileOnlineSyncMessageBlock
}

function toDesktopTopic(topic: MobileOnlineSyncTopic): Topic {
  return {
    ...topic,
    createdAt: toIsoString(topic.createdAt),
    updatedAt: toIsoString(topic.updatedAt),
    messages: []
  }
}

function toDesktopMessage(message: MobileOnlineSyncMessage): Message {
  return {
    ...message,
    createdAt: toIsoString(message.createdAt),
    updatedAt: message.updatedAt ? toIsoString(message.updatedAt) : undefined
  } as Message
}

function toDesktopMessageBlock(block: MobileOnlineSyncMessageBlock): MessageBlock {
  return {
    ...block,
    createdAt: toIsoString(block.createdAt),
    updatedAt: block.updatedAt ? toIsoString(block.updatedAt) : undefined
  } as MessageBlock
}

function synthesizeTopic(topicId: string, messages: Message[]): Topic {
  const sortedMessages = sortMessages(messages)
  const firstMessage = sortedMessages[0]
  const lastMessage = sortedMessages.at(-1) || firstMessage

  return {
    id: topicId,
    assistantId: firstMessage?.assistantId || 'default',
    name: topicId,
    createdAt: toIsoString(firstMessage?.createdAt),
    updatedAt: toIsoString(lastMessage?.updatedAt || lastMessage?.createdAt),
    messages: []
  }
}

function pickLatestTopic(topics: Topic[]) {
  return [...topics].sort((left, right) => toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt))[0]
}

function buildDesktopTopics(topicRecords: TopicRecord[], topicMetadata: Topic[]): Topic[] {
  const topicCandidates = topicMetadata.reduce<Map<string, Topic[]>>((result, topic) => {
    const existing = result.get(topic.id) || []
    result.set(topic.id, [...existing, topic])
    return result
  }, new Map())

  const topicRecordsById = new Map(topicRecords.map((record) => [record.id, record]))
  const allTopicIds = new Set<string>([...topicCandidates.keys(), ...topicRecordsById.keys()])
  const topics: Topic[] = []

  for (const topicId of allTopicIds) {
    const candidates = topicCandidates.get(topicId) || []
    const recordMessages = sortMessages(topicRecordsById.get(topicId)?.messages || [])
    const nextTopic =
      pickLatestTopic(candidates) || (recordMessages.length > 0 ? synthesizeTopic(topicId, recordMessages) : null)

    if (!nextTopic) {
      continue
    }

    topics.push({
      ...nextTopic,
      messages: []
    })
  }

  return topics.sort((left, right) => toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt))
}

async function collectSnapshot(): Promise<MobileOnlineSyncSnapshot> {
  const [topicRecords, messageBlocks, avatarSetting] = await Promise.all([
    db.table('topics').toArray() as Promise<TopicRecord[]>,
    db.table('message_blocks').toArray() as Promise<MessageBlock[]>,
    db.table('settings').get('image://avatar') as Promise<SettingsRecord | undefined>
  ])
  const currentState = store.getState()
  const topicMetadata = collectTopicMetadata()
  const topics = buildDesktopTopics(topicRecords, topicMetadata)
  const rawMessages = topicRecords.flatMap((record) => sortMessages(record.messages || []))
  const messageIds = new Set(rawMessages.map((message) => message.id))
  const assistants = collectAllAssistants().map(sanitizeAssistantForOnlineSync)

  const snapshot: MobileOnlineSyncSnapshot = {
    profile: {
      id: MOBILE_ONLINE_SYNC_PROFILE_ID,
      userName: currentState.settings.userName,
      avatar: avatarSetting?.value
    },
    assistants,
    topics: topics.map(toSyncTopic),
    messages: rawMessages.map(toSyncMessage),
    messageBlocks: messageBlocks.filter((block) => messageIds.has(block.messageId)).map(toSyncMessageBlock)
  }

  logger.info('Collected desktop online sync snapshot', {
    assistantCount: snapshot.assistants.length,
    topicCount: snapshot.topics.length,
    messageCount: snapshot.messages.length,
    blockCount: snapshot.messageBlocks.length
  })

  return snapshot
}

async function applySnapshot(snapshot: MobileOnlineSyncSnapshot) {
  const currentState = store.getState()
  const incomingDefaultAssistant = {
    ...(snapshot.assistants.find((assistant) => assistant.id === currentState.assistants.defaultAssistant.id) ||
      snapshot.assistants.find((assistant) => assistant.id === 'default') ||
      sanitizeAssistantForOnlineSync(currentState.assistants.defaultAssistant)),
    topics: []
  } as unknown as Assistant
  const incomingAssistants = snapshot.assistants
    .filter((assistant) => assistant.id !== incomingDefaultAssistant.id)
    .map((assistant) => ({
      ...assistant,
      topics: []
    })) as unknown as Assistant[]
  const normalizedTopics = snapshot.topics.map(toDesktopTopic)
  const normalizedMessages = snapshot.messages.map(toDesktopMessage)
  const normalizedBlocks = snapshot.messageBlocks.map(toDesktopMessageBlock)
  const { assistants: syncedAssistants, defaultAssistant: syncedDefaultAssistant } = buildDesktopSyncAssistantState({
    currentDefaultAssistant: currentState.assistants.defaultAssistant,
    currentAssistants: currentState.assistants.assistants,
    incomingDefaultAssistant,
    incomingAssistants,
    normalizedTopics,
    replaceTopics: true
  })
  const messagesByTopicId = normalizedMessages.reduce<Map<string, Message[]>>((result, message) => {
    const existing = result.get(message.topicId) || []
    result.set(message.topicId, [...existing, message])
    return result
  }, new Map())
  const targetTopicIds = new Set(normalizedTopics.map((topic) => topic.id))
  const targetBlockIds = new Set(normalizedBlocks.map((block) => block.id))

  await db.transaction('rw', db.table('topics'), db.table('message_blocks'), db.table('settings'), async () => {
    const currentTopicRecords = (await db.table('topics').toArray()) as TopicRecord[]
    const deletedTopicIds = currentTopicRecords
      .filter((record) => !targetTopicIds.has(record.id))
      .map((record) => record.id)
    if (deletedTopicIds.length > 0) {
      await db.table('topics').bulkDelete(deletedTopicIds)
    }

    for (const topic of normalizedTopics) {
      await db.table('topics').put({
        id: topic.id,
        messages: sortMessages(messagesByTopicId.get(topic.id) || [])
      })
    }

    const currentBlocks = (await db.table('message_blocks').toArray()) as MessageBlock[]
    const deletedBlockIds = currentBlocks.filter((block) => !targetBlockIds.has(block.id)).map((block) => block.id)
    if (deletedBlockIds.length > 0) {
      await db.table('message_blocks').bulkDelete(deletedBlockIds)
    }

    if (normalizedBlocks.length > 0) {
      await db.table('message_blocks').bulkPut(normalizedBlocks)
    }

    if (typeof snapshot.profile.avatar === 'string') {
      await db.table('settings').put({
        id: 'image://avatar',
        value: snapshot.profile.avatar
      })
    }
  })

  store.dispatch(updateDefaultAssistant({ assistant: syncedDefaultAssistant }))
  store.dispatch(updateAssistants(syncedAssistants))

  if (typeof snapshot.profile.userName === 'string') {
    store.dispatch(setUserName(snapshot.profile.userName))
  }

  if (typeof snapshot.profile.avatar === 'string') {
    store.dispatch(setAvatar(snapshot.profile.avatar))
  }

  const currentTopicId = currentState.messages.currentTopicId
  const nextTopicId =
    currentTopicId && targetTopicIds.has(currentTopicId) ? currentTopicId : normalizedTopics[0]?.id || null
  store.dispatch(newMessagesActions.setCurrentTopicId(nextTopicId))
  if (nextTopicId) {
    await store.dispatch(loadTopicMessagesThunk(nextTopicId, true))
  }

  await persistor.flush()

  logger.info('Applied desktop online sync snapshot', {
    assistantCount: syncedAssistants.length,
    topicCount: normalizedTopics.length,
    messageCount: normalizedMessages.length,
    blockCount: normalizedBlocks.length,
    nextTopicId
  })

  return {
    assistantCount: syncedAssistants.length,
    topicCount: normalizedTopics.length,
    messageCount: normalizedMessages.length,
    blockCount: normalizedBlocks.length,
    nextTopicId
  }
}

export const mobileOnlineSyncBridgeService = {
  init() {
    window[MOBILE_ONLINE_SYNC_BRIDGE_KEY] = {
      collectSnapshot,
      applySnapshot
    }

    logger.info('Mobile online sync bridge initialized')
  }
}
