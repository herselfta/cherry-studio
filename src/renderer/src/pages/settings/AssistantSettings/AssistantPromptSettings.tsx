import 'emoji-picker-element'

import AvatarPickerButton from '@renderer/components/Avatar/AvatarPickerButton'
import CodeEditor from '@renderer/components/CodeEditor'
import { Box, HSpaceBetweenStack, HStack } from '@renderer/components/Layout'
import type { RichEditorRef } from '@renderer/components/RichEditor/types'
import { usePromptProcessor } from '@renderer/hooks/usePromptProcessor'
import { estimateTextTokens } from '@renderer/services/TokenService'
import type { Assistant, AssistantSettings } from '@renderer/types'
import { getLeadingEmoji } from '@renderer/utils'
import { Button, Input, Popover } from 'antd'
import { Edit, HelpCircle, Save } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import styled from 'styled-components'

import { SettingDivider } from '..'

interface Props {
  assistant: Assistant
  updateAssistant: (assistant: Assistant) => void
  updateAssistantSettings?: (settings: AssistantSettings) => void
  onOk?: () => void
}

const AssistantPromptSettings: React.FC<Props> = ({ assistant, updateAssistant }) => {
  const [emoji, setEmoji] = useState(getLeadingEmoji(assistant.name) || assistant.emoji)
  const [avatar, setAvatar] = useState(assistant.avatar)
  const [name, setName] = useState(assistant.name.replace(getLeadingEmoji(assistant.name) || '', '').trim())
  const [prompt, setPrompt] = useState(assistant.prompt)
  const [showPreview, setShowPreview] = useState(assistant.prompt.length > 0)
  const [tokenCount, setTokenCount] = useState(0)
  const { t } = useTranslation()
  const editorRef = useRef<RichEditorRef>(null)

  useEffect(() => {
    setTokenCount(estimateTextTokens(prompt))
  }, [prompt])

  const processedPrompt = usePromptProcessor({
    prompt,
    modelName: assistant.model?.name
  })

  const onUpdate = () => {
    const _assistant = { ...assistant, name: name.trim(), emoji, avatar, prompt }
    updateAssistant(_assistant)
    window.toast.success(t('common.saved'))
  }

  const handleEmojiSelect = (selectedEmoji: string) => {
    setEmoji(selectedEmoji)
    setAvatar('')
    const _assistant = { ...assistant, name: name.trim(), emoji: selectedEmoji, avatar: '', prompt }
    updateAssistant(_assistant)
  }

  const handleAvatarImageSelect = (selectedAvatar: string) => {
    setAvatar(selectedAvatar)
    const _assistant = { ...assistant, name: name.trim(), prompt, emoji, avatar: selectedAvatar }
    updateAssistant(_assistant)
  }

  const handleAvatarReset = () => {
    setAvatar('')
    const _assistant = { ...assistant, name: name.trim(), prompt, emoji, avatar: '' }
    updateAssistant(_assistant)
  }

  const promptVarsContent = <pre>{t('assistants.presets.add.prompt.variables.tip.content')}</pre>

  return (
    <Container>
      <Box mb={8} style={{ fontWeight: 'bold' }}>
        {t('common.name')}
      </Box>
      <HStack gap={8} alignItems="center">
        <AvatarPickerButton
          value={avatar}
          fallbackEmoji={emoji || '⭐️'}
          onEmojiPick={handleEmojiSelect}
          onImagePick={handleAvatarImageSelect}
          onReset={avatar ? handleAvatarReset : undefined}
        />
        <Input
          placeholder={t('common.assistant') + t('common.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={onUpdate}
          style={{ flex: 1 }}
        />
      </HStack>
      <SettingDivider />
      <HStack mb={8} alignItems="center" gap={4}>
        <Box style={{ fontWeight: 'bold' }}>{t('common.prompt')}</Box>
        <Popover title={t('assistants.presets.add.prompt.variables.tip.title')} content={promptVarsContent}>
          <HelpCircle size={14} color="var(--color-text-2)" />
        </Popover>
      </HStack>
      <TextAreaContainer>
        <RichEditorContainer>
          {showPreview ? (
            <MarkdownContainer
              onDoubleClick={() => {
                const currentScrollTop = editorRef.current?.getScrollTop?.() || 0
                setShowPreview(false)
                requestAnimationFrame(() => editorRef.current?.setScrollTop?.(currentScrollTop))
              }}>
              <ReactMarkdown>{processedPrompt || prompt}</ReactMarkdown>
            </MarkdownContainer>
          ) : (
            <CodeEditor
              value={prompt}
              language="markdown"
              onChange={setPrompt}
              height="100%"
              expanded={false}
              style={{
                height: '100%'
              }}
            />
          )}
        </RichEditorContainer>
      </TextAreaContainer>
      <HSpaceBetweenStack width="100%" justifyContent="flex-end" mt="10px">
        <TokenCount>Tokens: {tokenCount}</TokenCount>
        <Button
          type="primary"
          icon={showPreview ? <Edit size={14} /> : <Save size={14} />}
          onClick={() => {
            const currentScrollTop = editorRef.current?.getScrollTop?.() || 0
            if (showPreview) {
              setShowPreview(false)
              requestAnimationFrame(() => editorRef.current?.setScrollTop?.(currentScrollTop))
            } else {
              onUpdate()
              requestAnimationFrame(() => {
                setShowPreview(true)
                requestAnimationFrame(() => editorRef.current?.setScrollTop?.(currentScrollTop))
              })
            }
          }}>
          {showPreview ? t('common.edit') : t('common.save')}
        </Button>
      </HSpaceBetweenStack>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
`

const TextAreaContainer = styled.div`
  position: relative;
  width: 100%;
`

const TokenCount = styled.div`
  padding: 2px 2px;
  border-radius: 4px;
  font-size: 14px;
  color: var(--color-text-2);
  user-select: none;
`

const RichEditorContainer = styled.div`
  height: calc(80vh - 202px);
  border: 0.5px solid var(--color-border);
  border-radius: 5px;
  overflow: hidden;

  .prompt-rich-editor {
    border: none;
    height: 100%;

    .rich-editor-wrapper {
      height: 100%;
      display: flex;
      flex-direction: column;
    }

    .rich-editor-content {
      flex: 1;
      overflow: auto;
    }
  }
`

const MarkdownContainer = styled.div.attrs({ className: 'markdown' })`
  height: 100%;
  padding: 0.5em;
  overflow: auto;
`

export default AssistantPromptSettings
