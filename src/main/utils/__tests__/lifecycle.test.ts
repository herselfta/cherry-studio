import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn()
    })
  }
}))

vi.mock('../../services/agents/database/DatabaseManager', () => ({
  DatabaseManager: {
    close: vi.fn()
  }
}))

vi.mock('../../services/FileStorage', () => ({
  fileStorage: {
    stopFileWatcher: vi.fn()
  }
}))

vi.mock('../../services/KnowledgeService', () => ({
  default: {
    closeAll: vi.fn()
  }
}))

vi.mock('../../services/memory/MemoryService', () => ({
  default: {
    getInstance: vi.fn(() => ({
      close: vi.fn()
    }))
  }
}))

import { relaunchAppGracefully } from '../lifecycle'

describe('relaunchAppGracefully', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('closes data connections before relaunching and quitting', async () => {
    const closeDataConnections = vi.fn().mockResolvedValue(undefined)
    const app = {
      isQuitting: false,
      relaunch: vi.fn(),
      quit: vi.fn()
    } as unknown as Electron.App

    await relaunchAppGracefully(app, { args: ['--restored'] }, closeDataConnections)

    expect(app.isQuitting).toBe(true)
    expect(closeDataConnections).toHaveBeenCalledTimes(1)
    expect(app.relaunch).toHaveBeenCalledWith({ args: ['--restored'] })
    expect(app.quit).toHaveBeenCalledTimes(1)
  })

  it('still relaunches and quits when closing data connections fails', async () => {
    const closeDataConnections = vi.fn().mockRejectedValue(new Error('close failed'))
    const app = {
      isQuitting: false,
      relaunch: vi.fn(),
      quit: vi.fn()
    } as unknown as Electron.App

    await relaunchAppGracefully(app, undefined, closeDataConnections)

    expect(app.isQuitting).toBe(true)
    expect(closeDataConnections).toHaveBeenCalledTimes(1)
    expect(app.relaunch).toHaveBeenCalledWith(undefined)
    expect(app.quit).toHaveBeenCalledTimes(1)
  })
})
