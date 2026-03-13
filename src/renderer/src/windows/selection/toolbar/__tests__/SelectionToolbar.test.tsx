import { render } from '@testing-library/react'
import type * as ReactI18Next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SelectionToolbar from '../SelectionToolbar'

const selectionAssistantMocks = vi.hoisted(() => ({
  useSelectionAssistant: vi.fn()
}))

const settingsMocks = vi.hoisted(() => ({
  useSettings: vi.fn()
}))

vi.mock('@renderer/hooks/useSelectionAssistant', () => ({
  useSelectionAssistant: selectionAssistantMocks.useSelectionAssistant
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: settingsMocks.useSettings
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18Next>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) =>
        (
          {
            'selection.action.builtin.copy': 'Copy',
            'selection.action.builtin.quote': 'Quote Selected Text Into Current Conversation'
          } as Record<string, string>
        )[key] ?? key
    })
  }
})

describe('SelectionToolbar', () => {
  let animationFrameCallbacks: FrameRequestCallback[]

  beforeEach(() => {
    vi.clearAllMocks()
    animationFrameCallbacks = []

    window.matchMedia =
      window.matchMedia ||
      vi.fn().mockImplementation(() => ({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: false,
        media: '',
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn()
      }))

    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      animationFrameCallbacks.push(callback)
      return animationFrameCallbacks.length
    })
    window.cancelAnimationFrame = vi.fn()
    window.api.selection = {
      ...window.api.selection,
      determineToolbarSize: vi.fn()
    }
    window.electron.ipcRenderer.on = vi.fn(() => vi.fn())
    global.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      disconnect: vi.fn()
    }))
  })

  it('renders non-compact action titles without truncation styles', () => {
    selectionAssistantMocks.useSelectionAssistant.mockReturnValue({
      isCompact: false,
      actionItems: [
        {
          id: 'quote',
          name: 'selection.action.builtin.quote',
          enabled: true,
          isBuiltIn: true,
          icon: 'quote'
        },
        {
          id: 'copy',
          name: 'selection.action.builtin.copy',
          enabled: true,
          isBuiltIn: true,
          icon: 'clipboard-copy'
        }
      ]
    })

    settingsMocks.useSettings.mockReturnValue({
      language: 'en-US',
      customCss: ''
    })

    const { container } = render(<SelectionToolbar demo />)

    expect(container.firstChild).toHaveStyle({
      minWidth: 'max-content',
      width: 'max-content'
    })
    expect(container).toHaveTextContent('Quote Selected Text Into Current Conversation')
  })

  it('measures the rendered toolbar container when syncing width to the main process', () => {
    selectionAssistantMocks.useSelectionAssistant.mockReturnValue({
      isCompact: false,
      actionItems: [
        {
          id: 'quote',
          name: 'selection.action.builtin.quote',
          enabled: true,
          isBuiltIn: true,
          icon: 'quote'
        }
      ]
    })

    settingsMocks.useSettings.mockReturnValue({
      language: 'en-US',
      customCss: ''
    })

    const { container } = render(<SelectionToolbar />)
    const toolbarElement = container.firstChild as HTMLDivElement

    Object.defineProperties(toolbarElement, {
      scrollHeight: {
        configurable: true,
        value: 52
      },
      scrollWidth: {
        configurable: true,
        value: 480
      }
    })

    vi.spyOn(toolbarElement, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 480,
      height: 52,
      top: 0,
      right: 480,
      bottom: 52,
      left: 0,
      toJSON: () => ({})
    })

    while (animationFrameCallbacks.length > 0) {
      animationFrameCallbacks.shift()?.(0)
    }

    expect(window.api.selection.determineToolbarSize).toHaveBeenCalledWith(480, 52)
  })
})
