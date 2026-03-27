import { loggerService } from '@logger'
import db from '@renderer/databases'
import i18n from '@renderer/i18n'
import store, { persistor } from '@renderer/store'
import type { Assistant, MCPServer, Provider, Topic, WebDavConfig, WebSearchProvider } from '@renderer/types'
import type { Message, MessageBlock } from '@renderer/types/newMessage'

import { BACKUP_AWARE_LOCAL_STORAGE_KEYS, PERSISTED_REDUX_STATE_STORAGE_KEY } from './BackupLocalStorage'
import { buildPortableImageAssets, type PortableImageAsset } from './BackupService'
import {
  applyPortableSyncImageAssets,
  buildDesktopSyncAssistantState,
  filterDesktopSyncMessageBlocks,
  normalizeDesktopSyncTopics,
  type PortableSyncImageAsset
} from './mobileSyncUtils'

const logger = loggerService.withContext('MobileSyncService')

export const MOBILE_SYNC_SCHEMA = 'cherry-studio-cross-device-sync'
export const MOBILE_SYNC_SCHEMA_VERSION = 1
export const MOBILE_SYNC_FILE_MARKER = '.mobile-sync.'

type SyncSettings = {
  userName?: string
  theme?: string
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
  mcp: {
    servers: MCPServer[]
  }
  settings: SyncSettings
  topics: SyncTopic[]
  messages: SyncMessage[]
  messageBlocks: SyncMessageBlock[]
  portableImageAssets?: PortableSyncImageAsset[]
  localStorage: Partial<Record<(typeof BACKUP_AWARE_LOCAL_STORAGE_KEYS)[number], string>>
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
  exportedAt: number
  data: SyncData
}

type PersistedReduxState = Record<string, string>

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

function readPortableLocalStorage(): SyncData['localStorage'] {
  return BACKUP_AWARE_LOCAL_STORAGE_KEYS.reduce<SyncData['localStorage']>((result, key) => {
    const value = localStorage.getItem(key)
    if (value !== null) {
      result[key] = value
    }
    return result
  }, {})
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

  const messages: SyncMessage[] = []
  const topics: SyncTopic[] = []

  for (const record of topicRecords as Array<{ id: string; messages?: Message[] }>) {
    const topic = topicMetadata.get(record.id)
    const topicMessages = sortMessages(record.messages || [])
    messages.push(...topicMessages.map(toSyncMessage))

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

  const portableImageAssets = (await buildPortableImageAssets({
    message_blocks: messageBlocks,
    files
  } as Record<string, any>)) as PortableImageAsset[]

  const payload: MobileSyncPayload = {
    schema: MOBILE_SYNC_SCHEMA,
    version: MOBILE_SYNC_SCHEMA_VERSION,
    source: 'desktop',
    exportedAt: Date.now(),
    data: {
      assistants: {
        defaultAssistant: sanitizeAssistantForSync(currentState.assistants.defaultAssistant),
        assistants: currentState.assistants.assistants.map(sanitizeAssistantForSync)
      },
      llm: {
        providers: currentState.llm.providers
      },
      websearch: {
        providers: currentState.websearch.providers,
        searchWithTime: currentState.websearch.searchWithTime,
        maxResults: currentState.websearch.maxResults
      },
      mcp: {
        servers: currentState.mcp.servers || []
      },
      settings: {
        userName: currentState.settings.userName,
        theme: currentState.settings.theme,
        avatar: avatarSetting?.value
      },
      topics,
      messages,
      messageBlocks: messageBlocks.map(toSyncMessageBlock),
      portableImageAssets,
      localStorage: readPortableLocalStorage()
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
  const currentMcp = readPersistedSlice(persistedState, 'mcp', store.getState().mcp)
  const incomingMessages = parsed.data.messages.map(toDesktopMessage)
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
  const { droppedBlockCount, messageBlocks: normalizedMessageBlocks } = filterDesktopSyncMessageBlocks(
    parsed.data.messageBlocks.map(toDesktopMessageBlock),
    incomingMessages
  )
  const portableMessageBlocks = applyPortableSyncImageAssets(
    normalizedMessageBlocks,
    parsed.data.portableImageAssets || []
  )
  const { assistants: incomingAssistants, defaultAssistant: mergedDefaultAssistant } = buildDesktopSyncAssistantState({
    currentDefaultAssistant: currentAssistants.defaultAssistant,
    currentAssistants: currentAssistants.assistants,
    incomingDefaultAssistant: {
      ...parsed.data.assistants.defaultAssistant,
      topics: toDesktopTopics(parsed.data.assistants.defaultAssistant.topics)
    },
    incomingAssistants: parsed.data.assistants.assistants.map((assistant) => ({
      ...assistant,
      topics: toDesktopTopics(assistant.topics)
    })),
    normalizedTopics
  })

  writePersistedSlice(persistedState, 'assistants', {
    ...currentAssistants,
    defaultAssistant: mergedDefaultAssistant,
    assistants: mergeById(currentAssistants.assistants, incomingAssistants)
  })

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
    userName: parsed.data.settings.userName ?? currentSettings.userName,
    theme: parsed.data.settings.theme ?? currentSettings.theme
  })

  writePersistedSlice(persistedState, 'mcp', {
    ...currentMcp,
    servers: mergeById(currentMcp.servers || [], parsed.data.mcp.servers || [])
  })

  localStorage.setItem(PERSISTED_REDUX_STATE_STORAGE_KEY, JSON.stringify(persistedState))

  for (const [key, value] of Object.entries(parsed.data.localStorage)) {
    if (typeof value === 'string') {
      localStorage.setItem(key, value)
    }
  }

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

  if (synthesizedTopicCount > 0) {
    logger.warn(`Synthesized ${synthesizedTopicCount} missing topic record(s) from mobile sync messages`)
  }

  if (droppedBlockCount > 0) {
    logger.warn(`Dropped ${droppedBlockCount} orphan message block(s) during mobile sync import`)
  }

  logger.info('Mobile sync payload imported. Relaunching to refresh Redux and Dexie bindings.')
  setTimeout(() => window.api.relaunchApp(), 300)
}
