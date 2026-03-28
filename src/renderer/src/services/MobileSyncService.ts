import { loggerService } from '@logger'
import db from '@renderer/databases'
import i18n from '@renderer/i18n'
import store, { persistor } from '@renderer/store'
import type { Assistant, Provider, Topic, WebDavConfig, WebSearchProvider } from '@renderer/types'
import type { Message, MessageBlock } from '@renderer/types/newMessage'

import { PERSISTED_REDUX_STATE_STORAGE_KEY } from './BackupLocalStorage'
import { buildPortableImageAssets, type PortableImageAsset } from './BackupService'
import {
  getMobileSyncLedgerEntry,
  getOrCreateMobileSyncSourceDeviceId,
  writeMobileSyncLedgerEntry
} from './mobileSyncLedger'
import {
  applyPortableSyncImageAssets,
  buildDesktopSyncAssistantState,
  filterDesktopSyncMessageBlocks,
  normalizeDesktopSyncTopics,
  normalizePortableConversationMessages,
  type PortableSyncImageAsset,
  resolveDesktopConversationSync
} from './mobileSyncUtils'

const logger = loggerService.withContext('MobileSyncService')

export const MOBILE_SYNC_SCHEMA = 'cherry-studio-cross-device-sync'
export const MOBILE_SYNC_SCHEMA_VERSION = 2
export const MOBILE_SYNC_FILE_MARKER = '.mobile-sync.'

type SyncSettings = {
  userName?: string
  avatar?: string
}

type SyncData = {
  assistants: {
    defaultAssistant: Assistant
    assistants: Assistant[]
  }
  llm: {
    providers: Provider[]
  }
  websearch: {
    providers: WebSearchProvider[]
    searchWithTime?: boolean
    maxResults?: number
  }
  settings: SyncSettings
  topics: SyncTopic[]
  messages: SyncMessage[]
  messageBlocks: SyncMessageBlock[]
  portableImageAssets?: PortableSyncImageAsset[]
}

type SyncTopic = Omit<Topic, 'createdAt' | 'updatedAt' | 'messages'> & {
  createdAt: number
  updatedAt: number
}

type SyncMessage = Omit<Message, 'createdAt' | 'updatedAt'> & {
  createdAt: number
  updatedAt?: number
}

type SyncMessageBlock = Omit<MessageBlock, 'createdAt' | 'updatedAt'> & {
  createdAt: number
  updatedAt?: number
}

type MobileSyncPayload = {
  schema: typeof MOBILE_SYNC_SCHEMA
  version: number
  source: 'desktop' | 'mobile'
  sourceDeviceId?: string
  sourcePlatform?: 'desktop' | 'mobile'
  exportedAt: number
  data: SyncData
}

type PersistedReduxState = Record<string, string>

export function buildPortableSyncSettings(
  settings: Partial<Pick<ReturnType<typeof store.getState>['settings'], 'userName'>>,
  avatar?: string
): SyncSettings {
  return {
    userName: settings.userName,
    avatar: avatar || undefined
  }
}

function sanitizeAssistantForSync(assistant: Assistant): Assistant {
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
    enableGenerateImage: assistant.enableGenerateImage,
    knowledgeRecognition: assistant.knowledgeRecognition,
    tags: assistant.tags,
    mcpServers: assistant.mcpServers,
    topics: assistant.topics.map((topic) => ({ ...toSyncTopic(topic), messages: [] as never[] })) as unknown as Topic[]
  }
}

function rebuildPortableAssistantTopicsForSync(assistant: Assistant, topics: SyncTopic[]): Assistant {
  return {
    ...assistant,
    topics: topics
      .filter((topic) => topic.assistantId === assistant.id)
      .map((topic) => ({ ...topic, messages: [] as never[] })) as unknown as Topic[]
  }
}

function toTimestamp(value: string | number | undefined): number {
  if (typeof value === 'number') {
    return value
  }

  return value ? new Date(value).getTime() : Date.now()
}

function toIsoString(value: string | number | undefined): string {
  return new Date(toTimestamp(value)).toISOString()
}

function toSyncTopic(topic: Topic): SyncTopic {
  return {
    ...topic,
    createdAt: toTimestamp(topic.createdAt),
    updatedAt: toTimestamp(topic.updatedAt)
  }
}

function toSyncMessage(message: Message): SyncMessage {
  return {
    ...message,
    createdAt: toTimestamp(message.createdAt),
    updatedAt: message.updatedAt ? toTimestamp(message.updatedAt) : undefined
  }
}

function toSyncMessageBlock(block: MessageBlock): SyncMessageBlock {
  return {
    ...block,
    createdAt: toTimestamp(block.createdAt),
    updatedAt: block.updatedAt ? toTimestamp(block.updatedAt) : undefined
  }
}

function toDesktopMessage(message: SyncMessage): Message {
  return {
    ...message,
    createdAt: toIsoString(message.createdAt),
    updatedAt: message.updatedAt ? toIsoString(message.updatedAt) : undefined
  }
}

function toDesktopTopic(topic: SyncTopic): Topic {
  return {
    ...topic,
    createdAt: toIsoString(topic.createdAt),
    updatedAt: toIsoString(topic.updatedAt),
    messages: []
  }
}

function toDesktopMessageBlock(block: SyncMessageBlock): MessageBlock {
  return {
    ...block,
    createdAt: toIsoString(block.createdAt),
    updatedAt: block.updatedAt ? toIsoString(block.updatedAt) : undefined
  } as MessageBlock
}

function sortMessages(messages: Message[]) {
  return [...messages].sort((left, right) => toTimestamp(left.createdAt) - toTimestamp(right.createdAt))
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const merged = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) {
    merged.set(item.id, { ...merged.get(item.id), ...item })
  }
  return Array.from(merged.values())
}

function toDesktopTopics(topics: Topic[] | SyncTopic[] | undefined): Topic[] {
  return (topics || []).map((topic) => toDesktopTopic(topic as SyncTopic))
}

function parsePersistedReduxState(): PersistedReduxState {
  const serialized = localStorage.getItem(PERSISTED_REDUX_STATE_STORAGE_KEY)
  if (!serialized) {
    throw new Error('Missing persisted Redux state')
  }

  return JSON.parse(serialized) as PersistedReduxState
}

function readPersistedSlice<T>(state: PersistedReduxState, key: string, fallback: T): T {
  const raw = state[key]
  return typeof raw === 'string' ? (JSON.parse(raw) as T) : fallback
}

function writePersistedSlice<T>(state: PersistedReduxState, key: string, value: T) {
  state[key] = JSON.stringify(value)
}

function isMobileSyncPayloadObject(payload: unknown): payload is MobileSyncPayload {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      (payload as MobileSyncPayload).schema === MOBILE_SYNC_SCHEMA &&
      typeof (payload as MobileSyncPayload).version === 'number'
  )
}

function collectTopicMetadata(currentState: ReturnType<typeof store.getState>) {
  return [
    ...currentState.assistants.assistants.flatMap((assistant) => assistant.topics),
    ...currentState.assistants.defaultAssistant.topics
  ]
}

function collectTopicMetadataFromAssistantState(assistantsState: ReturnType<typeof store.getState>['assistants']) {
  return [
    ...assistantsState.assistants.flatMap((assistant) => assistant.topics),
    ...assistantsState.defaultAssistant.topics
  ]
}

function buildDesktopConversationSnapshot(
  topicRecords: Array<{ id: string; messages?: Message[] }>,
  topicMetadata: Map<string, Topic>
) {
  const messages: Message[] = []
  const topics: Topic[] = []

  for (const record of topicRecords) {
    const topic = topicMetadata.get(record.id)
    const topicMessages = sortMessages(record.messages || [])
    if (topicMessages.length === 0) {
      continue
    }

    messages.push(...topicMessages)

    if (topic) {
      topics.push({
        ...topic,
        messages: []
      })
      continue
    }

    topics.push({
      id: record.id,
      assistantId: topicMessages[0]?.assistantId || 'default',
      name: record.id,
      createdAt: toIsoString(topicMessages[0]?.createdAt),
      updatedAt: toIsoString(topicMessages.at(-1)?.updatedAt || topicMessages.at(-1)?.createdAt),
      messages: []
    })
  }

  return {
    topics,
    messages
  }
}

export function isMobileSyncPayload(payload: string): boolean {
  try {
    return isMobileSyncPayloadObject(JSON.parse(payload))
  } catch (error) {
    logger.warn('Failed to inspect mobile sync payload', error as Error)
    return false
  }
}

export function isMobileSyncRemoteFile(fileName: string): boolean {
  return fileName.includes(MOBILE_SYNC_FILE_MARKER) && fileName.endsWith('.json')
}

function normalizeMobileSyncFileName(fileName: string) {
  if (isMobileSyncRemoteFile(fileName)) {
    return fileName
  }

  const baseName = fileName.replace(/\.json$/i, '')
  const withMarker = baseName.startsWith('cherry-studio.')
    ? baseName.replace(/^cherry-studio\./, `cherry-studio${MOBILE_SYNC_FILE_MARKER}`)
    : `cherry-studio${MOBILE_SYNC_FILE_MARKER}${baseName}`

  return `${withMarker}.json`
}

function buildLocalBackupPath(localBackupDir: string, fileName: string) {
  return `${localBackupDir.replace(/[\\/]+$/, '')}/${fileName}`
}

export async function buildMobileSyncFileName() {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, '')
    .slice(0, 14)
  const [hostname, deviceType] = await Promise.all([
    window.api.system.getHostname().catch(() => 'desktop'),
    window.api.system.getDeviceType().catch(() => 'desktop')
  ])

  return `cherry-studio${MOBILE_SYNC_FILE_MARKER}${timestamp}.${hostname || 'desktop'}.${deviceType || 'desktop'}.json`
}

export async function exportMobileSyncPayload(): Promise<string> {
  const currentState = store.getState()
  const topicRecords = await db.table('topics').toArray()
  const messageBlocks = (await db.table('message_blocks').toArray()) as MessageBlock[]
  const files = await db.table('files').toArray()
  const avatarSetting = await db.table('settings').get('image://avatar')
  const topicMetadata = new Map(collectTopicMetadata(currentState).map((topic) => [topic.id, topic]))
  const sourceDeviceId = getOrCreateMobileSyncSourceDeviceId()

  const rawMessages: Message[] = []
  const topics: SyncTopic[] = []

  for (const record of topicRecords as Array<{ id: string; messages?: Message[] }>) {
    const topic = topicMetadata.get(record.id)
    const topicMessages = sortMessages(record.messages || [])
    if (topicMessages.length === 0) {
      continue
    }

    rawMessages.push(...topicMessages)

    if (topic) {
      topics.push(toSyncTopic(topic))
      continue
    }

    topics.push({
      id: record.id,
      assistantId: topicMessages[0]?.assistantId || 'default',
      name: record.id,
      createdAt: toTimestamp(topicMessages[0]?.createdAt),
      updatedAt: toTimestamp(topicMessages.at(-1)?.updatedAt || topicMessages.at(-1)?.createdAt)
    })
  }

  const normalizedMessages = normalizePortableConversationMessages(rawMessages)
  const normalizedMessageIds = new Set(normalizedMessages.map((message) => message.id))
  const normalizedMessageBlocks = messageBlocks.filter((block) => normalizedMessageIds.has(block.messageId))

  const portableImageAssets = (await buildPortableImageAssets({
    message_blocks: normalizedMessageBlocks,
    files
  } as Record<string, any>)) as PortableImageAsset[]

  logger.info('Exporting mobile sync payload', {
    version: MOBILE_SYNC_SCHEMA_VERSION,
    sourcePlatform: 'desktop',
    sourceDeviceId,
    rawTopicCount: topics.length,
    normalizedTopicCount: topics.length,
    rawMessageCount: rawMessages.length,
    normalizedMessageCount: normalizedMessages.length,
    rawBlockCount: messageBlocks.length,
    normalizedBlockCount: normalizedMessageBlocks.length,
    portableImageAssetCount: portableImageAssets.length
  })

  const payload: MobileSyncPayload = {
    schema: MOBILE_SYNC_SCHEMA,
    version: MOBILE_SYNC_SCHEMA_VERSION,
    source: 'desktop',
    sourceDeviceId,
    sourcePlatform: 'desktop',
    exportedAt: Date.now(),
    data: {
      assistants: {
        defaultAssistant: sanitizeAssistantForSync(
          rebuildPortableAssistantTopicsForSync(currentState.assistants.defaultAssistant, topics)
        ),
        assistants: currentState.assistants.assistants.map((assistant) =>
          sanitizeAssistantForSync(rebuildPortableAssistantTopicsForSync(assistant, topics))
        )
      },
      llm: {
        providers: currentState.llm.providers
      },
      websearch: {
        providers: currentState.websearch.providers,
        searchWithTime: currentState.websearch.searchWithTime,
        maxResults: currentState.websearch.maxResults
      },
      settings: {
        ...buildPortableSyncSettings(currentState.settings, avatarSetting?.value)
      },
      topics,
      messages: normalizedMessages.map(toSyncMessage),
      messageBlocks: normalizedMessageBlocks.map(toSyncMessageBlock),
      portableImageAssets
    }
  }

  // Cross-device sync is intentionally separate from full migration backup:
  // it only contains the desktop/mobile overlap and must never be promoted into
  // a "full restore" artifact, otherwise importing mobile data would wipe
  // desktop-only state again during future upstream refactors.
  return JSON.stringify(payload)
}

export async function uploadMobileSyncToWebdav(webdavConfig: WebDavConfig, customFileName?: string) {
  const fileName = customFileName?.trim() || (await buildMobileSyncFileName())
  const normalizedFileName = normalizeMobileSyncFileName(fileName)

  // WebDAV mobile sync intentionally uploads the shared-data JSON directly instead of
  // wrapping it into a migration archive. This keeps cloud sync semantics aligned with
  // phone import/export and prevents future backup refactors from turning it back into
  // a desktop-only restore artifact.
  const payload = await exportMobileSyncPayload()
  await window.api.backup.uploadTextToWebdav(
    {
      ...webdavConfig,
      fileName: normalizedFileName
    },
    payload
  )

  return normalizedFileName
}

export async function backupMobileSyncToLocal({
  showMessage = false,
  customFileName = ''
}: {
  showMessage?: boolean
  customFileName?: string
} = {}) {
  const localBackupDirSetting = store.getState().settings.localBackupDir
  const localBackupDir = await window.api.resolvePath(localBackupDirSetting)
  const fileName = normalizeMobileSyncFileName(customFileName.trim() || (await buildMobileSyncFileName()))
  const payload = await exportMobileSyncPayload()

  // Local APP sync writes the same portable JSON artifact into the configured
  // backup directory so local/WebDAV restore pickers can share the same PC/APP flow.
  await window.api.file.write(buildLocalBackupPath(localBackupDir, fileName), payload)

  if (showMessage) {
    window.toast.success(i18n.t('message.backup.success'))
  }

  return fileName
}

export async function importMobileSyncFromWebdav(webdavConfig: WebDavConfig, fileName: string) {
  const payload = await window.api.backup.downloadTextFromWebdav({
    ...webdavConfig,
    fileName
  })

  await importMobileSyncPayload(payload)
}

export async function restoreMobileSyncFromLocal(fileName: string) {
  const localBackupDirSetting = store.getState().settings.localBackupDir
  const localBackupDir = await window.api.resolvePath(localBackupDirSetting)
  const payload = await window.api.file.readExternal(buildLocalBackupPath(localBackupDir, fileName))

  await importMobileSyncPayload(payload)
}

export async function importMobileSyncPayload(payload: string) {
  const parsed = JSON.parse(payload) as unknown
  if (!isMobileSyncPayloadObject(parsed)) {
    throw new Error('Invalid mobile sync payload')
  }

  if (parsed.version > MOBILE_SYNC_SCHEMA_VERSION) {
    throw new Error(`Unsupported mobile sync schema version: ${parsed.version}`)
  }

  await persistor.flush()

  const persistedState = parsePersistedReduxState()
  const currentAssistants = readPersistedSlice(persistedState, 'assistants', store.getState().assistants)
  const currentLlm = readPersistedSlice(persistedState, 'llm', store.getState().llm)
  const currentWebsearch = readPersistedSlice(persistedState, 'websearch', store.getState().websearch)
  const currentSettings = readPersistedSlice(persistedState, 'settings', store.getState().settings)
  const rawIncomingMessages = parsed.data.messages.map(toDesktopMessage)
  const incomingMessages = normalizePortableConversationMessages(rawIncomingMessages)
  const incomingDefaultAssistant = {
    ...parsed.data.assistants.defaultAssistant,
    topics: toDesktopTopics(parsed.data.assistants.defaultAssistant.topics)
  }
  const incomingAssistants = parsed.data.assistants.assistants.map((assistant) => ({
    ...assistant,
    topics: toDesktopTopics(assistant.topics)
  }))
  const visibleAssistantIds = new Set<string>([
    currentAssistants.defaultAssistant.id,
    parsed.data.assistants.defaultAssistant.id,
    ...currentAssistants.assistants.map((assistant) => assistant.id),
    ...parsed.data.assistants.assistants.map((assistant) => assistant.id)
  ])
  const embeddedTopics = [
    ...toDesktopTopics(parsed.data.assistants.defaultAssistant.topics),
    ...parsed.data.assistants.assistants.flatMap((assistant) => toDesktopTopics(assistant.topics))
  ]
  const { synthesizedTopicCount, topics: normalizedTopics } = normalizeDesktopSyncTopics(
    toDesktopTopics(parsed.data.topics),
    embeddedTopics,
    incomingMessages,
    visibleAssistantIds
  )
  const rawPortableMessageBlocks = parsed.data.messageBlocks.map(toDesktopMessageBlock)
  const { droppedBlockCount, messageBlocks: normalizedMessageBlocks } = filterDesktopSyncMessageBlocks(
    rawPortableMessageBlocks,
    incomingMessages
  )
  const portableMessageBlocks = applyPortableSyncImageAssets(
    normalizedMessageBlocks,
    parsed.data.portableImageAssets || []
  )

  writePersistedSlice(persistedState, 'llm', {
    ...currentLlm,
    providers: mergeById(currentLlm.providers || [], parsed.data.llm.providers || [])
  })

  writePersistedSlice(persistedState, 'websearch', {
    ...currentWebsearch,
    providers: mergeById(currentWebsearch.providers || [], parsed.data.websearch.providers || []),
    searchWithTime: parsed.data.websearch.searchWithTime ?? currentWebsearch.searchWithTime,
    maxResults: parsed.data.websearch.maxResults ?? currentWebsearch.maxResults
  })

  writePersistedSlice(persistedState, 'settings', {
    ...currentSettings,
    userName: parsed.data.settings.userName ?? currentSettings.userName
  })

  const shouldUseSourceAwareImport = parsed.version >= 2 && Boolean(parsed.sourceDeviceId)

  logger.info('Importing mobile sync payload', {
    version: parsed.version,
    source: parsed.source,
    sourcePlatform: parsed.sourcePlatform,
    sourceDeviceId: parsed.sourceDeviceId,
    sourceAware: shouldUseSourceAwareImport,
    rawIncomingTopicCount: parsed.data.topics.length,
    rawIncomingMessageCount: rawIncomingMessages.length,
    rawIncomingBlockCount: rawPortableMessageBlocks.length,
    normalizedIncomingTopicCount: normalizedTopics.length,
    normalizedIncomingMessageCount: incomingMessages.length,
    normalizedIncomingBlockCount: portableMessageBlocks.length
  })

  if (shouldUseSourceAwareImport && !getMobileSyncLedgerEntry(parsed.sourceDeviceId!)) {
    logger.warn(
      `First source-aware mobile sync import detected for ${parsed.sourceDeviceId}. Deletions will become active after this baseline import.`
    )
  }

  if (
    rawIncomingMessages.length !== incomingMessages.length ||
    rawPortableMessageBlocks.length !== portableMessageBlocks.length
  ) {
    logger.info('Normalized legacy-style mobile sync snapshot before import', {
      rawIncomingMessageCount: rawIncomingMessages.length,
      normalizedIncomingMessageCount: incomingMessages.length,
      rawIncomingBlockCount: rawPortableMessageBlocks.length,
      normalizedIncomingBlockCount: portableMessageBlocks.length
    })
  }

  if (!shouldUseSourceAwareImport) {
    const { assistants: mergedAssistants, defaultAssistant: mergedDefaultAssistant } = buildDesktopSyncAssistantState({
      currentDefaultAssistant: currentAssistants.defaultAssistant,
      currentAssistants: currentAssistants.assistants,
      incomingDefaultAssistant,
      incomingAssistants,
      normalizedTopics
    })

    writePersistedSlice(persistedState, 'assistants', {
      ...currentAssistants,
      defaultAssistant: mergedDefaultAssistant,
      assistants: mergeById(currentAssistants.assistants, mergedAssistants)
    })

    localStorage.setItem(PERSISTED_REDUX_STATE_STORAGE_KEY, JSON.stringify(persistedState))

    await db.transaction('rw', db.table('topics'), db.table('message_blocks'), db.table('settings'), async () => {
      for (const topic of normalizedTopics) {
        const existing = (await db.table('topics').get(topic.id)) as { id: string; messages?: Message[] } | undefined
        const topicMessages = incomingMessages.filter((message) => message.topicId === topic.id)
        const mergedMessages = sortMessages(
          mergeById<Message>(
            existing?.messages || [],
            topicMessages.map((message) => ({ ...message }))
          )
        )

        await db.table('topics').put({
          id: topic.id,
          messages: mergedMessages
        })
      }

      if (portableMessageBlocks.length > 0) {
        await db.table('message_blocks').bulkPut(portableMessageBlocks)
      }

      if (parsed.data.settings.avatar) {
        await db.table('settings').put({
          id: 'image://avatar',
          value: parsed.data.settings.avatar
        })
      }
    })
  } else {
    const currentTopicRecords = (await db.table('topics').toArray()) as Array<{ id: string; messages?: Message[] }>
    const currentMessageBlocks = (await db.table('message_blocks').toArray()) as MessageBlock[]
    const currentTopicMetadata = new Map(
      collectTopicMetadataFromAssistantState(currentAssistants).map((topic) => [topic.id, topic])
    )
    const currentConversation = buildDesktopConversationSnapshot(currentTopicRecords, currentTopicMetadata)
    const previousLedgerEntry = getMobileSyncLedgerEntry(parsed.sourceDeviceId!)
    const resolvedConversation = resolveDesktopConversationSync({
      currentTopics: currentConversation.topics,
      incomingTopics: normalizedTopics,
      currentMessages: currentConversation.messages,
      incomingMessages,
      currentMessageBlocks,
      incomingMessageBlocks: portableMessageBlocks,
      exportedAt: parsed.exportedAt,
      previousLedgerEntry
    })
    const { assistants: syncedAssistants, defaultAssistant: syncedDefaultAssistant } = buildDesktopSyncAssistantState({
      currentDefaultAssistant: currentAssistants.defaultAssistant,
      currentAssistants: currentAssistants.assistants,
      incomingDefaultAssistant,
      incomingAssistants,
      normalizedTopics: resolvedConversation.topics,
      replaceTopics: true
    })

    writePersistedSlice(persistedState, 'assistants', {
      ...currentAssistants,
      defaultAssistant: syncedDefaultAssistant,
      assistants: syncedAssistants
    })

    localStorage.setItem(PERSISTED_REDUX_STATE_STORAGE_KEY, JSON.stringify(persistedState))

    await db.transaction('rw', db.table('topics'), db.table('message_blocks'), db.table('settings'), async () => {
      if (resolvedConversation.deletedTopicIds.length > 0) {
        await db.table('topics').bulkDelete(resolvedConversation.deletedTopicIds)
      }

      const messagesByTopicId = resolvedConversation.messages.reduce<Map<string, Message[]>>((result, message) => {
        const existing = result.get(message.topicId) || []
        result.set(message.topicId, [...existing, message])
        return result
      }, new Map())

      for (const topic of resolvedConversation.topics) {
        await db.table('topics').put({
          id: topic.id,
          messages: sortMessages(messagesByTopicId.get(topic.id) || [])
        })
      }

      if (resolvedConversation.deletedBlockIds.length > 0) {
        await db.table('message_blocks').bulkDelete(resolvedConversation.deletedBlockIds)
      }

      if (resolvedConversation.messageBlocks.length > 0) {
        await db.table('message_blocks').bulkPut(resolvedConversation.messageBlocks)
      }

      if (parsed.data.settings.avatar) {
        await db.table('settings').put({
          id: 'image://avatar',
          value: parsed.data.settings.avatar
        })
      }
    })

    if (!resolvedConversation.isStaleImport && resolvedConversation.nextLedgerEntry) {
      writeMobileSyncLedgerEntry(parsed.sourceDeviceId!, resolvedConversation.nextLedgerEntry)
    } else if (resolvedConversation.isStaleImport) {
      logger.warn(
        `Skipping destructive mobile sync actions for stale payload from ${parsed.sourceDeviceId} exported at ${parsed.exportedAt}`
      )
    }

    if (resolvedConversation.deletedTopicIds.length > 0) {
      logger.info(
        `Deleted ${resolvedConversation.deletedTopicIds.length} topic(s) from mobile sync snapshot reconciliation`
      )
    }
    if (resolvedConversation.deletedMessageIds.length > 0) {
      logger.info(
        `Deleted ${resolvedConversation.deletedMessageIds.length} message(s) from mobile sync snapshot reconciliation`
      )
    }
    if (resolvedConversation.deletedBlockIds.length > 0) {
      logger.info(
        `Deleted ${resolvedConversation.deletedBlockIds.length} block(s) from mobile sync snapshot reconciliation`
      )
    }
  }

  if (synthesizedTopicCount > 0) {
    logger.warn(`Synthesized ${synthesizedTopicCount} missing topic record(s) from mobile sync messages`)
  }

  if (droppedBlockCount > 0) {
    logger.warn(`Dropped ${droppedBlockCount} orphan message block(s) during mobile sync import`)
  }

  logger.info('Mobile sync payload imported. Relaunching to refresh Redux and Dexie bindings.')
  setTimeout(() => window.api.relaunchApp(), 300)
}
