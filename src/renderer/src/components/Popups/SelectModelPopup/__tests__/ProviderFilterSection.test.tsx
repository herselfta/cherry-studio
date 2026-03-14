import type { Provider } from '@renderer/types'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import ProviderFilterSection from '../ProviderFilterSection'

const mocks = vi.hoisted(() => ({
  t: vi.fn((key: string) => key)
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.t })
}))

vi.mock('@renderer/components/ProviderAvatar', () => ({
  ProviderAvatar: ({ provider }: { provider: Provider }) => <span>{provider.name}</span>
}))

vi.mock('@renderer/utils', () => ({
  getFancyProviderName: (provider: Provider) => provider.name
}))

vi.mock('antd', () => ({
  Flex: ({ children }: { children: ReactNode }) => children
}))

function createProvider(id: string, name: string): Provider {
  return {
    id,
    type: 'openai',
    name,
    apiKey: '',
    apiHost: '',
    models: []
  }
}

describe('ProviderFilterSection', () => {
  it('should render all option and provider chips', () => {
    render(
      <ProviderFilterSection
        providers={[
          { provider: createProvider('openai', 'OpenAI'), count: 12 },
          { provider: createProvider('anthropic', 'Anthropic'), count: 5 }
        ]}
        selectedProviderIds={[]}
        onToggleProvider={vi.fn()}
        onResetProviders={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'models.all' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /OpenAI/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Anthropic/ })).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('should call onResetProviders when clicking all', () => {
    const handleReset = vi.fn()
    render(
      <ProviderFilterSection
        providers={[{ provider: createProvider('openai', 'OpenAI'), count: 12 }]}
        selectedProviderIds={['openai']}
        onToggleProvider={vi.fn()}
        onResetProviders={handleReset}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'models.all' }))

    expect(handleReset).toHaveBeenCalledTimes(1)
  })

  it('should call onToggleProvider when clicking a provider chip', () => {
    const handleToggle = vi.fn()
    render(
      <ProviderFilterSection
        providers={[{ provider: createProvider('openai', 'OpenAI'), count: 12 }]}
        selectedProviderIds={[]}
        onToggleProvider={handleToggle}
        onResetProviders={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /OpenAI/ }))

    expect(handleToggle).toHaveBeenCalledTimes(1)
    expect(handleToggle).toHaveBeenCalledWith('openai')
  })
})
