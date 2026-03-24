import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({
    assistantIconType: 'model'
  })
}))

vi.mock('@renderer/services/AssistantService', () => ({
  getDefaultModel: () => ({
    id: 'default-model',
    name: 'Default Model',
    provider: 'openai',
    group: 'default'
  }),
  getDefaultAssistant: () => ({
    id: 'default',
    name: 'Default Assistant',
    prompt: '',
    type: 'system',
    topics: []
  })
}))

vi.mock('../ModelAvatar', () => ({
  default: () => <div data-testid="model-avatar">model-avatar</div>
}))

import AssistantAvatar from '../AssistantAvatar'

describe('AssistantAvatar', () => {
  it('prefers a custom avatar over the global model icon mode', () => {
    render(
      <AssistantAvatar
        assistant={{
          id: 'assistant-1',
          name: 'Custom Assistant',
          prompt: '',
          topics: [],
          type: 'external',
          avatar: '🦊'
        }}
      />
    )

    expect(screen.getAllByText('🦊').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('model-avatar')).not.toBeInTheDocument()
  })
})
