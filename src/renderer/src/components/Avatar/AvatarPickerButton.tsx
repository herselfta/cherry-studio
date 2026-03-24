import { PictureOutlined, UndoOutlined } from '@ant-design/icons'
import EmojiAvatar from '@renderer/components/Avatar/EmojiAvatar'
import EmojiPicker from '@renderer/components/EmojiPicker'
import { compressImage, convertToBase64, isEmoji } from '@renderer/utils'
import { Avatar, Button, Popover, Tooltip, Upload } from 'antd'
import type { UploadChangeParam } from 'antd/es/upload'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

type Props = {
  value?: string
  fallbackEmoji: string
  size?: number
  fontSize?: number
  onEmojiPick: (emoji: string) => void
  onImagePick: (avatar: string) => void
  onReset?: () => void
}

const AvatarPickerButton: FC<Props> = ({
  value,
  fallbackEmoji,
  size = 28,
  fontSize,
  onEmojiPick,
  onImagePick,
  onReset
}) => {
  const { t } = useTranslation()
  const displayValue = value || fallbackEmoji

  const handleUploadChange = async ({ file }: UploadChangeParam) => {
    try {
      const originalFile = file.originFileObj as File | undefined
      if (!originalFile) return

      const preparedFile = originalFile.type === 'image/gif' ? originalFile : await compressImage(originalFile)
      const base64Image = await convertToBase64(preparedFile)
      if (typeof base64Image === 'string') {
        onImagePick(base64Image)
      }
    } catch (error: any) {
      window.toast.error(error.message)
    }
  }

  const avatarNode =
    displayValue && !isEmoji(displayValue) ? (
      <StyledAvatar src={displayValue} size={size} shape="square" />
    ) : (
      <EmojiAvatar size={size} fontSize={fontSize ?? size * 0.5}>
        {displayValue}
      </EmojiAvatar>
    )

  return (
    <Container>
      <Popover content={<EmojiPicker onEmojiClick={onEmojiPick} />} trigger="click">
        <AvatarTrigger>{avatarNode}</AvatarTrigger>
      </Popover>
      <Upload
        customRequest={() => {}}
        accept="image/png, image/jpeg, image/gif"
        itemRender={() => null}
        maxCount={1}
        showUploadList={false}
        onChange={handleUploadChange}>
        <Tooltip title={t('common.upload')}>
          <Button type="text" icon={<PictureOutlined />} />
        </Tooltip>
      </Upload>
      {onReset && (
        <Tooltip title={t('settings.general.avatar.reset')}>
          <Button type="text" icon={<UndoOutlined />} onClick={onReset} />
        </Tooltip>
      )}
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

const AvatarTrigger = styled.div`
  display: flex;
  align-items: center;
  cursor: pointer;
`

const StyledAvatar = styled(Avatar)`
  border-radius: 20% !important;
`

export default AvatarPickerButton
