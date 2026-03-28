import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loggerMock = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn()
}

const fsMock = {
  access: vi.fn(),
  appendFile: vi.fn(),
  mkdir: vi.fn(),
  open: vi.fn(),
  readdir: vi.fn(),
  rm: vi.fn()
}

function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => loggerMock)
  }
}))

vi.mock('fs/promises', () => ({
  default: fsMock
}))

vi.mock('../ConfigManager', () => ({
  configManager: {
    getEnableDeveloperMode: vi.fn(() => true)
  }
}))

describe('SpanCacheService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsMock.access.mockResolvedValue(undefined)
    fsMock.appendFile.mockResolvedValue(undefined)
    fsMock.mkdir.mockResolvedValue(undefined)
    fsMock.open.mockResolvedValue(undefined)
    fsMock.readdir.mockResolvedValue([])
    fsMock.rm.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not log ENOENT when cleaning a trace file that is already gone', async () => {
    fsMock.access.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))

    const { cleanHistoryTrace } = await import('../SpanCacheService')

    await cleanHistoryTrace('topic-1', 'trace-1')

    expect(loggerMock.error).not.toHaveBeenCalled()
    expect(fsMock.rm).not.toHaveBeenCalled()
  })

  it('awaits history cleanup before saving spans when cleaning a model-specific topic trace', async () => {
    const { cleanTopic, spanCacheService } = await import('../SpanCacheService')

    let resolveCleanHistoryTrace: (() => void) | undefined
    const cleanHistoryTracePromise = new Promise<void>((resolve) => {
      resolveCleanHistoryTrace = resolve
    })

    const cleanHistoryTraceSpy = vi
      .spyOn(spanCacheService, 'cleanHistoryTrace')
      .mockImplementation(() => cleanHistoryTracePromise)
    const saveSpansSpy = vi.spyOn(spanCacheService, 'saveSpans').mockResolvedValue(undefined)

    const pendingCleanTopic = cleanTopic('topic-1', 'trace-1', 'kimi')

    await nextTick()

    expect(cleanHistoryTraceSpy).toHaveBeenCalledWith('topic-1', 'trace-1', 'kimi')
    expect(saveSpansSpy).not.toHaveBeenCalled()

    resolveCleanHistoryTrace?.()
    await pendingCleanTopic

    expect(saveSpansSpy).toHaveBeenCalledWith('topic-1')
    expect(cleanHistoryTraceSpy.mock.invocationCallOrder[0]).toBeLessThan(saveSpansSpy.mock.invocationCallOrder[0])
  })
})
