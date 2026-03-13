import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  getDisplayNearestPoint: vi.fn(() => ({
    workArea: {
      x: 0,
      y: 0,
      width: 800,
      height: 600
    }
  }))
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@main/configs/SelectionConfig', () => ({
  SELECTION_FINETUNED_LIST: {
    EXCLUDE_CLIPBOARD_CURSOR_DETECT: {
      MAC: [],
      WINDOWS: []
    },
    INCLUDE_CLIPBOARD_DELAY_READ: {
      MAC: [],
      WINDOWS: []
    }
  },
  SELECTION_PREDEFINED_BLACKLIST: {
    MAC: [],
    WINDOWS: []
  }
}))

vi.mock('@main/constant', () => ({
  isDev: false,
  isMac: false,
  isWin: false
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(),
    getVersion: vi.fn()
  },
  BrowserWindow: vi.fn(),
  ipcMain: {
    handle: vi.fn()
  },
  screen: {
    getDisplayNearestPoint: electronMocks.getDisplayNearestPoint
  },
  systemPreferences: {
    getMediaAccessStatus: vi.fn()
  }
}))

vi.mock('../ConfigManager', () => ({
  ConfigKeys: {},
  configManager: {
    subscribe: vi.fn(),
    getSelectionAssistantEnabled: vi.fn(() => false)
  }
}))

vi.mock('../StoreSyncService', () => ({
  default: {
    subscribe: vi.fn()
  }
}))

import { SelectionService } from '../SelectionService'

describe('SelectionService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resizes a live toolbar window immediately when the measured width changes', () => {
    const setBounds = vi.fn()
    const service = Object.create(SelectionService.prototype) as any

    service.zoomFactor = 1
    service.TOOLBAR_WIDTH = 350
    service.TOOLBAR_HEIGHT = 43
    service.toolbarWindow = {
      isDestroyed: () => false,
      getBounds: () => ({
        x: 620,
        y: 20,
        width: 350,
        height: 43
      }),
      setBounds
    }

    service.determineToolbarSize(500, 43)

    expect(service.TOOLBAR_WIDTH).toBe(500)
    expect(setBounds).toHaveBeenCalledWith({
      x: 300,
      y: 20,
      width: 500,
      height: 43
    })
  })

  it('ignores invalid sizes without touching the toolbar window', () => {
    const setBounds = vi.fn()
    const service = Object.create(SelectionService.prototype) as any

    service.zoomFactor = 1
    service.TOOLBAR_WIDTH = 350
    service.TOOLBAR_HEIGHT = 43
    service.toolbarWindow = {
      isDestroyed: () => false,
      setBounds
    }

    service.determineToolbarSize(0, 0)

    expect(service.TOOLBAR_WIDTH).toBe(350)
    expect(service.TOOLBAR_HEIGHT).toBe(43)
    expect(setBounds).not.toHaveBeenCalled()
  })
})
