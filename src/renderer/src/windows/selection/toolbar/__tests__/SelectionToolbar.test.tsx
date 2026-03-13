import { render } from '@testing-library/react'
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
  const actual = await importOriginal<typeof import('react-i18next')>()

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
  beforeEach(() => {
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

    window.electron.ipcRenderer.on = vi.fn(() => vi.fn())
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

    expect(container.firstChild).toMatchSnapshot()
  })
})
