import EmojiIcon from '@renderer/components/EmojiIcon'
import { useSettings } from '@renderer/hooks/useSettings'
import { getDefaultModel } from '@renderer/services/AssistantService'
import type { Assistant } from '@renderer/types'
import { getLeadingEmoji, isEmoji } from '@renderer/utils'
import { Avatar } from 'antd'
import type { FC } from 'react'
import { useMemo } from 'react'

import ModelAvatar from './ModelAvatar'

interface AssistantAvatarProps {
  assistant: Assistant
  size?: number
  className?: string
}

const AssistantAvatar: FC<AssistantAvatarProps> = ({ assistant, size = 24, className }) => {
  const { assistantIconType } = useSettings()
  const defaultModel = getDefaultModel()

  const assistantName = useMemo(() => assistant.name || '', [assistant.name])
  const customAvatar = assistant.avatar?.trim()

  // A user-selected avatar should always win over the global icon mode toggle.
  // Otherwise custom assistant avatars appear to "not work" when model icons are enabled.
  if (customAvatar) {
    if (!isEmoji(customAvatar)) {
      return <Avatar src={customAvatar} size={size} className={className} style={{ borderRadius: '20%' }} />
    }

    return <EmojiIcon emoji={customAvatar} size={size} className={className} />
  }

  if (assistantIconType === 'model') {
    return <ModelAvatar model={assistant.model || defaultModel} size={size} className={className} />
  }

  if (assistantIconType === 'emoji') {
    return <EmojiIcon emoji={assistant.emoji || getLeadingEmoji(assistantName)} size={size} className={className} />
  }

  return null
}

export default AssistantAvatar
