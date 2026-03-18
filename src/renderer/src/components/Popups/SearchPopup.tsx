import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import HistoryPage from '@renderer/pages/history/HistoryPage'
import { Modal } from 'antd'
import { useState } from 'react'

import { TopView } from '../TopView'

interface Props {
  resolve: (data: any) => void
  topViewKey: string
}

const TopViewKey = 'SearchPopup'

const PopupContainer: React.FC<Props> = ({ resolve, topViewKey }) => {
  const [open, setOpen] = useState(true)

  const onOk = () => {
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
    TopView.hide(topViewKey)
  }

  return (
    <Modal
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      title={null}
      width={700}
      transitionName="animation-move-down"
      styles={{
        content: {
          borderRadius: 20,
          padding: 0,
          overflow: 'hidden',
          paddingBottom: 16
        },
        body: {
          height: '80vh',
          maxHeight: 'inherit',
          padding: 0
        }
      }}
      centered
      closable={false}
      footer={null}>
      <ErrorBoundary>
        <HistoryPage />
      </ErrorBoundary>
    </Modal>
  )
}

export default class SearchPopup {
  static topviewId = 0
  static currentTopViewKey: string | null = null

  static hide() {
    if (this.currentTopViewKey) {
      TopView.hide(this.currentTopViewKey)
      this.currentTopViewKey = null
    }
    TopView.hide(TopViewKey)
  }
  static show() {
    const topViewKey = `${TopViewKey}:${++this.topviewId}`
    if (this.currentTopViewKey) {
      TopView.hide(this.currentTopViewKey)
    }
    TopView.hide(TopViewKey)
    this.currentTopViewKey = topViewKey

    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          topViewKey={topViewKey}
          resolve={(v) => {
            resolve(v)
            TopView.hide(topViewKey)
            if (this.currentTopViewKey === topViewKey) {
              this.currentTopViewKey = null
            }
          }}
        />,
        topViewKey
      )
    })
  }
}
