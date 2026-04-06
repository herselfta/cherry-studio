import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import {
  applyMobileOnlineSyncChanges,
  buildMobileOnlineSyncChanges,
  createEmptyMobileOnlineSyncState,
  markMobileOnlineSyncChangesPublished,
  MOBILE_ONLINE_SYNC_PROFILE_ID,
  type MobileOnlineSyncChange,
  type MobileOnlineSyncSkippedChange,
  type MobileOnlineSyncSnapshot,
  type MobileOnlineSyncTrackerState,
  prepareMobileOnlineSyncState
} from '@shared/mobileSync/onlineSync'
import { app } from 'electron'

import { windowService } from './WindowService'

const logger = loggerService.withContext('MobileOnlineSyncServer')

type MobileOnlineSyncLogEntry = {
  cursor: number
  change: MobileOnlineSyncChange
}

type MobileOnlineSyncServerState = {
  cursor: number
  snapshot: MobileOnlineSyncSnapshot
  tracker: MobileOnlineSyncTrackerState
  changeLog: MobileOnlineSyncLogEntry[]
}

const MOBILE_ONLINE_SYNC_BRIDGE_KEY = '__CHERRY_MOBILE_ONLINE_SYNC_BRIDGE__'

function createEmptySnapshot(): MobileOnlineSyncSnapshot {
  return {
    profile: {
      id: MOBILE_ONLINE_SYNC_PROFILE_ID
    },
    assistants: [],
    topics: [],
    messages: [],
    messageBlocks: []
  }
}

function createInitialServerState(): MobileOnlineSyncServerState {
  const replicaId = `desktop-server:${randomUUID()}`

  return {
    cursor: 0,
    snapshot: createEmptySnapshot(),
    tracker: createEmptyMobileOnlineSyncState(replicaId),
    changeLog: []
  }
}

export class MobileOnlineSyncServerService {
  private statePromise: Promise<MobileOnlineSyncServerState> | null = null

  private getStateFilePath() {
    return path.join(app.getPath('userData'), 'Data', 'mobile-online-sync-state.json')
  }

  private async readState() {
    if (!this.statePromise) {
      this.statePromise = this.loadState()
    }

    return this.statePromise
  }

  private async loadState(): Promise<MobileOnlineSyncServerState> {
    const filePath = this.getStateFilePath()

    try {
      const serialized = await fs.readFile(filePath, 'utf-8')
      const parsed = JSON.parse(serialized) as MobileOnlineSyncServerState
      logger.info('Loaded mobile online sync server state', {
        cursor: parsed.cursor,
        changeCount: parsed.changeLog.length
      })
      return parsed
    } catch (error) {
      const nextState = createInitialServerState()
      logger.info('Initialized empty mobile online sync server state', {
        replicaId: nextState.tracker.replicaId
      })
      return nextState
    }
  }

  private async writeState(nextState: MobileOnlineSyncServerState) {
    const filePath = this.getStateFilePath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(nextState), 'utf-8')
    this.statePromise = Promise.resolve(nextState)
  }

  private async evaluateRendererBridge<T>(method: 'collectSnapshot' | 'applySnapshot', argument?: unknown): Promise<T> {
    const mainWindow = windowService.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('Desktop sync bridge is unavailable because the main window is not ready')
    }

    const bridgeKey = JSON.stringify(MOBILE_ONLINE_SYNC_BRIDGE_KEY)
    const methodName = JSON.stringify(method)
    const serializedArgument = argument === undefined ? 'undefined' : JSON.stringify(argument).replace(/</g, '\\u003c')
    const script = `
      (async () => {
        const bridge = window[${bridgeKey}]
        if (!bridge || typeof bridge[${methodName}] !== 'function') {
          return { ok: false, error: 'desktop sync bridge not ready' }
        }

        try {
          const result = await bridge[${methodName}](${serializedArgument})
          return { ok: true, result }
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          }
        }
      })()
    `

    const response = (await mainWindow.webContents.executeJavaScript(script)) as
      | { ok: true; result: T }
      | { ok: false; error: string }

    if (!response.ok) {
      throw new Error(response.error)
    }

    return response.result
  }

  private appendChanges(state: MobileOnlineSyncServerState, changes: MobileOnlineSyncChange[]) {
    let nextCursor = state.cursor
    const appendedEntries: MobileOnlineSyncLogEntry[] = []

    for (const change of changes) {
      nextCursor += 1
      appendedEntries.push({
        cursor: nextCursor,
        change
      })
    }

    return {
      cursor: nextCursor,
      changeLog: [...state.changeLog, ...appendedEntries]
    }
  }

  async refreshDesktopSnapshot() {
    const currentState = await this.readState()
    const desktopSnapshot = await this.evaluateRendererBridge<MobileOnlineSyncSnapshot>('collectSnapshot')
    const prepared = prepareMobileOnlineSyncState(desktopSnapshot, currentState.tracker)
    const desktopChanges = buildMobileOnlineSyncChanges(prepared.snapshot, prepared.state)
    const nextTracker = markMobileOnlineSyncChangesPublished(prepared.state, desktopChanges)
    const appended = this.appendChanges(currentState, desktopChanges)
    const nextState: MobileOnlineSyncServerState = {
      ...currentState,
      cursor: appended.cursor,
      changeLog: appended.changeLog,
      snapshot: prepared.snapshot,
      tracker: nextTracker
    }

    await this.writeState(nextState)

    logger.info('Refreshed desktop snapshot for mobile online sync', {
      cursorBefore: currentState.cursor,
      cursorAfter: nextState.cursor,
      publishedChangeCount: desktopChanges.length,
      assistantCount: prepared.snapshot.assistants.length,
      topicCount: prepared.snapshot.topics.length,
      messageCount: prepared.snapshot.messages.length,
      blockCount: prepared.snapshot.messageBlocks.length
    })

    return {
      state: nextState,
      publishedChanges: desktopChanges
    }
  }

  async pullChanges(cursor: number) {
    const { state } = await this.refreshDesktopSnapshot()
    const changes = state.changeLog.filter((entry) => entry.cursor > cursor).map((entry) => entry.change)

    logger.info('Pulled mobile online sync changes', {
      requestedCursor: cursor,
      returnedCursor: state.cursor,
      returnedChangeCount: changes.length
    })

    return {
      cursor: state.cursor,
      changes
    }
  }

  async pushChanges(changes: MobileOnlineSyncChange[]) {
    const { state: refreshedState } = await this.refreshDesktopSnapshot()
    const applyResult = applyMobileOnlineSyncChanges(refreshedState.snapshot, refreshedState.tracker, changes)
    const appended = this.appendChanges(refreshedState, applyResult.acceptedChanges)
    const nextState: MobileOnlineSyncServerState = {
      ...refreshedState,
      cursor: appended.cursor,
      changeLog: appended.changeLog,
      snapshot: applyResult.snapshot,
      tracker: applyResult.state
    }

    if (applyResult.acceptedChanges.length > 0) {
      await this.evaluateRendererBridge('applySnapshot', applyResult.snapshot)
    }

    await this.writeState(nextState)

    logger.info('Pushed mobile online sync changes', {
      incomingChangeCount: changes.length,
      acceptedChangeCount: applyResult.acceptedChanges.length,
      skippedChangeCount: applyResult.skippedChanges.length,
      cursorAfter: nextState.cursor,
      topicCount: applyResult.snapshot.topics.length,
      messageCount: applyResult.snapshot.messages.length,
      blockCount: applyResult.snapshot.messageBlocks.length
    })

    return {
      cursor: nextState.cursor,
      acceptedChanges: applyResult.acceptedChanges,
      skippedChanges: applyResult.skippedChanges
    }
  }

  async getDebugState() {
    const state = await this.readState()

    return {
      cursor: state.cursor,
      replicaId: state.tracker.replicaId,
      assistantCount: state.snapshot.assistants.length,
      topicCount: state.snapshot.topics.length,
      messageCount: state.snapshot.messages.length,
      blockCount: state.snapshot.messageBlocks.length,
      changeLogCount: state.changeLog.length
    }
  }
}

export type MobileOnlineSyncPushResult = {
  cursor: number
  acceptedChanges: MobileOnlineSyncChange[]
  skippedChanges: MobileOnlineSyncSkippedChange[]
}

export const mobileOnlineSyncServerService = new MobileOnlineSyncServerService()
